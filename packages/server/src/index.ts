// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Entry point: a Fastify server that serves the tRPC API and (in production) the
 * built web app. Plain routes for /fabric, /api/stripe/webhook and /apply are
 * registered before the SPA fallback in later slices — each excluded from session
 * middleware but gated by its own checks (CLAUDE.md §16). Slice 1 boots the DB
 * (migrate-on-boot), mounts tRPC, and serves a health check.
 */
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { config } from './config';
import { makeLog } from './logger';
import { runMigrations } from './db';
import { purgeExpiredSessions } from './auth/sessions';
import { seedGradingDefaults } from './grades/scales';
import { seedMeritDefaults } from './merit/categories';
import { appRouter, type AppRouter } from './trpc/router';
import { createContext } from './trpc/trpc';
import { registerReportRoutes } from './reports/routes';
import { registerStatementRoutes } from './billing/statementRoutes';
import { registerApplyRoute } from './admissions/apply';
import { registerFabricProvider } from './fabric/provider';
import { registerStripeWebhook } from './payments/webhook';
import { loadStripeKeys } from './payments/stripe';
import { startSchedulers } from './payments/scheduler';

const log = makeLog('main');

// Paths served/handled outside the SPA (the web app is a client-side router). NOTE: /apply is
// deliberately NOT here — POST /apply is the public form's Fastify route, but GET /apply must fall
// through to the SPA (the anonymous enquiry page); the POST route is matched before the fallback.
const NON_SPA_PREFIXES = ['/trpc', '/api', '/fabric', '/reports', '/statements', '/healthz'];

async function main(): Promise<void> {
  // Apply committed migrations before accepting traffic, then clear stale sessions.
  runMigrations();
  seedGradingDefaults(); // the three shipped grading scales (idempotent)
  seedMeritDefaults(); // the shipped merit categories (idempotent)
  purgeExpiredSessions();
  void loadStripeKeys(); // best-effort: fetch Stripe keys from the Fabric (no-op standalone / not configured)
  startSchedulers(); // daily autopay run (no-op standalone)

  const app = Fastify({
    logger: false, // we log ourselves and never log secrets (CLAUDE.md §14)
    bodyLimit: 1_048_576, // 1 MiB JSON cap (uploads get their own limit later)
    // tRPC httpBatchLink batches queries into ONE GET whose path is the comma-joined
    // procedure list (e.g. records.fieldDefsList,records.notesForStudent,…). Fastify's
    // default maxParamLength (100) truncates that to a 414, silently failing the batch —
    // so raise it. (Caught by driving the student detail in a browser; createCaller tests
    // bypass HTTP and never hit this.)
    maxParamLength: 5000,
  });

  await app.register(fastifyCookie);

  // Keep the raw JSON body so a future Stripe webhook route can verify signatures
  // over the exact bytes; all other JSON routes still get the parsed object.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext } as FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });

  // Authed report-card PDF serving (its own role × origin checks; §14). Before the SPA fallback.
  registerReportRoutes(app);

  // Authed printable family statements (admin LAN-only / finance LAN+tunnel; §5, §14).
  registerStatementRoutes(app);

  // Anonymous public admissions form (§4, §14): its own zod + honeypot + rate-limit gates.
  registerApplyRoute(app);

  // Fabric provider /fabric/billing/* (§11): secret-gated, tunnel-blocked; the students/billing capability.
  registerFabricProvider(app);

  // Stripe webhook intake (§13.4): signature-verified, event-deduped → the ledger. Reachable at the
  // app's public URL (a path outside /fabric/, so the tunnel lets it through).
  registerStripeWebhook(app);

  // Production: serve the built web UI + SPA fallback. In dev, Vite serves the UI
  // (config.publicDir is empty), so this whole block is skipped.
  if (config.publicDir && fs.existsSync(path.join(config.publicDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.publicDir, index: false });
    const rawIndex = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
    const sendIndex = (_req: unknown, reply: import('fastify').FastifyReply) =>
      reply.type('text/html').send(rawIndex);
    // Serve the SPA index at the root explicitly — @fastify/static with index:false
    // returns 403 for a bare directory request, so it never reaches the fallback below.
    app.get('/', sendIndex);
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      const isAsset = path.extname(url) !== '';
      const isApi = NON_SPA_PREFIXES.some((p) => url === p || url.startsWith(p + '/'));
      if (req.method === 'GET' && !isAsset && !isApi) {
        reply.type('text/html').send(rawIndex);
        return;
      }
      reply.code(404).send({ error: 'Not found.' });
    });
  }

  await app.listen({ host: '0.0.0.0', port: config.port });
  log.info(
    `OpenMasjid Students on :${config.port} — ${config.publicDir ? 'serving UI' : 'API only (Vite serves the UI in dev)'}, ` +
      `${config.omosBaseUrl ? 'Fabric linked' : 'standalone'}`,
  );
}

main().catch((err) => {
  log.error('failed to start', err);
  process.exit(1);
});
