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
import { stripBasePath } from './http/basePath';

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

  // The tunnel mount prefix (e.g. "/students"); "" when standalone / served at the root.
  const BASE = config.basePath;

  const app = Fastify({
    logger: false, // we log ourselves and never log secrets (CLAUDE.md §14)
    bodyLimit: 1_048_576, // 1 MiB JSON cap (uploads get their own limit later)
    // tRPC httpBatchLink batches queries into ONE GET whose path is the comma-joined
    // procedure list (e.g. records.fieldDefsList,records.notesForStudent,…). Fastify's
    // default maxParamLength (100) truncates that to a 414, silently failing the batch —
    // so raise it. (Caught by driving the student detail in a browser; createCaller tests
    // bypass HTTP and never hit this.)
    maxParamLength: 5000,
    // Base-path awareness (manifest tunnel: true): when OpenMasjidOS exposes us behind its
    // Cloudflare tunnel it forwards the FULL admin-chosen path prefix (e.g. /students)
    // WITHOUT stripping it, so requests arrive as /students/trpc, /students/assets/x,
    // /students/api/stripe/webhook, etc. We strip it here, before routing, so every route
    // below stays written at the root and works identically on the LAN (no prefix) and
    // behind the tunnel. Empty prefix = nothing to strip (standalone). (Mirrors the family
    // pattern in OpenMasjidDonations.)
    rewriteUrl: (req) => stripBasePath(req.url ?? '/', BASE),
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

  // Same-origin appearance relay (CLAUDE.md §15). The parent portal + staff surfaces INHERIT the OS
  // dashboard's wallpaper + light/dark. The OS exposes GET /api/public/appearance (theme/wallpaper/
  // accent), but a browser can't fetch it directly: on the LAN it's a different origin + plain HTTP
  // (mixed content from our HTTPS page), and it isn't our origin over the tunnel. So the browser polls
  // US (same origin) and we fetch the platform server-to-server. No secrets; open (no auth), like /apply.
  // A tiny cache so many portal tabs polling every 45s don't each trigger an outbound hop, and a
  // slow OS response can't pile up. Only successful responses are cached; errors return {} and retry.
  let appearanceCache: { at: number; body: Record<string, unknown> } | null = null;
  const APPEARANCE_TTL_MS = 10_000;
  app.get('/api/public/appearance', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!config.omosBaseUrl) return {}; // standalone — nothing to inherit
    const now = Date.now();
    if (appearanceCache && now - appearanceCache.at < APPEARANCE_TTL_MS) return appearanceCache.body;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${config.omosBaseUrl}/api/public/appearance`, { signal: ctrl.signal, redirect: 'error' });
      if (!res.ok) return {};
      const body = (await res.json()) as Record<string, unknown>;
      appearanceCache = { at: now, body };
      return body;
    } catch {
      return {}; // platform offline / slow — the #omos fragment (if any) already themed us
    } finally {
      clearTimeout(t); // clear AFTER the body read so the 4s deadline bounds the whole exchange
    }
  });

  // Production: serve the built web UI + SPA fallback. In dev, Vite serves the UI
  // (config.publicDir is empty), so this whole block is skipped.
  if (config.publicDir && fs.existsSync(path.join(config.publicDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.publicDir, index: false });
    // Inject the base path so the relative-built Vite assets (base: './') resolve under the tunnel
    // prefix, and the client can build prefix-aware API/nav URLs (window.__OMOS_BASE__). Fixed per
    // deployment (BASE is constant), so we inject once. `<base href="/">` when served at the root.
    const rawIndex = fs
      .readFileSync(path.join(config.publicDir, 'index.html'), 'utf8')
      .replace('<head>', `<head>\n    <base href="${BASE}/">\n    <script>window.__OMOS_BASE__=${JSON.stringify(BASE)}</script>`);
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
