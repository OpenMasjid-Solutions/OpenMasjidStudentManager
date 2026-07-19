// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The anonymous public admissions form (CLAUDE.md §4, §14) — the app's MOST hostile surface:
 * unauthenticated and internet-reachable over the Cloudflare tunnel. A plain Fastify route,
 * registered before the SPA and excluded from auth, gated by its OWN checks:
 *   • strict zod + hard length caps (oversized input rejected)
 *   • a honeypot field (bots fill it → we return success but store NOTHING)
 *   • per-IP burst + daily rate limits (§14)
 *   • no file uploads; submissions stored as INERT text; the response leaks nothing about
 *     existing students/families — it only ever creates one `enquiry` row.
 * A Fabric "new admission" notification is wired when the OS broker lands; for now we audit.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { admissions } from '../db/schema';
import { rid } from '../db/ids';
import { audit } from '../audit';
import { makeLog } from '../logger';
import { clientIp } from '../security/origin';
import { applyBurstLimiter, applyDailyLimiter } from '../security/rateLimit';

const log = makeLog('apply');

/** Strict, hard-capped shape. Extra keys are ignored; `website` is the honeypot (must be empty). */
const ApplySchema = z
  .object({
    guardianName: z.string().trim().min(1).max(120),
    guardianPhone: z.string().trim().max(40).optional(),
    guardianEmail: z.string().trim().max(200).optional(),
    childFirstName: z.string().trim().min(1).max(120),
    childLastName: z.string().trim().min(1).max(120),
    childDob: z.string().trim().max(20).optional(),
    programInterest: z.string().trim().max(200).optional(),
    website: z.string().max(200).optional(), // honeypot — humans never fill this
  })
  .strip();

const blank = (v?: string) => (v && v.trim() !== '' ? v.trim() : null);

export function registerApplyRoute(app: FastifyInstance): void {
  app.post('/apply', async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = clientIp(req);
    // Rate limit first — daily cap, then short burst (each per real client IP).
    if (!applyDailyLimiter.allow(ip) || !applyBurstLimiter.allow(ip)) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many submissions. Please try again later.' } });
    }

    const parsed = ApplySchema.safeParse((req as FastifyRequest<{ Body: unknown }>).body ?? {});
    if (!parsed.success) {
      // Generic — never echo which field or reveal anything about the data store.
      return reply.code(400).send({ error: { code: 'invalid', message: 'Please check the form and try again.' } });
    }
    const d = parsed.data;

    // Honeypot: a bot filled the hidden field. Pretend success; store nothing.
    if (d.website && d.website.trim() !== '') {
      log.info('apply: honeypot triggered — dropped');
      return reply.code(200).send({ ok: true });
    }

    const id = rid('adm');
    const ts = new Date();
    db.insert(admissions).values({
      id, status: 'enquiry', source: 'public',
      guardianName: d.guardianName, guardianPhone: blank(d.guardianPhone), guardianEmail: blank(d.guardianEmail),
      childFirstName: d.childFirstName, childLastName: d.childLastName, childDob: blank(d.childDob), programInterest: blank(d.programInterest),
      fieldsJson: null, createdFamilyId: null, createdStudentId: null, createdAt: ts, updatedAt: ts,
    }).run();
    // Inert data + an audit trail; NEVER log the applicant's PII (§14).
    audit({ userId: null, role: 'public', name: null }, 'admission.publicSubmit', { entity: 'admission', entityId: id, detail: { source: 'public' } });
    return reply.code(200).send({ ok: true });
  });
}
