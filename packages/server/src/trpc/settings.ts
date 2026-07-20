// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** App settings (admin-only): school name, currency, the report-card merit toggle, and email (SMTP). */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, auditActor } from './trpc';
import { SETTING_KEYS, getSchoolName, getCurrency, getMeritOnReportCard, setSetting, getSmtp, setSmtp, getStripeWebhookSecret, setStripeWebhookSecret } from '../settings';
import { audit } from '../audit';
import { verifySmtp, sendMail } from '../mail/smtp';
import { testEmail } from '../mail/templates';
import { webhookSecret as fabricWebhookSecret } from '../payments/stripe';
import { ourWebhookUrl } from '../payments/webhookEndpoint';

export const settingsRouter = router({
  get: adminProcedure.query(() => ({
    schoolName: getSchoolName(),
    currency: getCurrency(),
    meritOnReportCard: getMeritOnReportCard(),
  })),

  set: adminProcedure
    .input(z.object({ schoolName: z.string().trim().max(160).optional(), currency: z.enum(['usd', 'cad', 'gbp', 'eur']).optional(), meritOnReportCard: z.boolean().optional() }))
    .mutation(({ ctx, input }) => {
      if (input.schoolName !== undefined) setSetting(SETTING_KEYS.schoolName, input.schoolName);
      if (input.currency !== undefined) setSetting(SETTING_KEYS.currency, input.currency);
      if (input.meritOnReportCard !== undefined) setSetting(SETTING_KEYS.meritOnReportCard, input.meritOnReportCard ? '1' : '0');
      audit(auditActor(ctx), 'settings.update', { entity: 'settings', detail: { keys: Object.keys(input) } });
      return { ok: true as const };
    }),

  // ── Email (SMTP) — the password is WRITE-ONLY: never returned to the client, never audited (§10/§14).
  smtpGet: adminProcedure.query(() => {
    const c = getSmtp();
    return {
      configured: !!c,
      host: c?.host ?? '',
      port: c?.port ?? 587,
      secure: c?.secure ?? false,
      user: c?.user ?? '',
      from: c?.from ?? '',
      hasPassword: !!c?.pass, // so the UI can show "•••• (unchanged)" instead of asking every time
    };
  }),

  smtpSet: adminProcedure
    .input(
      z.object({
        host: z.string().trim().max(255),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().trim().max(255),
        from: z.string().trim().min(1).max(320),
        // Omitted/empty → keep the stored password (write-only field; the admin only re-types to change it).
        password: z.string().max(255).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const existing = getSmtp();
      const pass = input.password && input.password.length > 0 ? input.password : (existing?.pass ?? '');
      setSmtp({ host: input.host, port: input.port, secure: input.secure, user: input.user, pass, from: input.from });
      // Audit keys only — NEVER the password (mirror settings.update).
      audit(auditActor(ctx), 'settings.smtp.update', { entity: 'settings', detail: { host: input.host, port: input.port, secure: input.secure, passwordChanged: !!input.password } });
      return { ok: true as const };
    }),

  /** Verify the connection, then send a probe to `to`. Friendly error on failure. */
  smtpTest: adminProcedure.input(z.object({ to: z.string().trim().email().max(320) })).mutation(async ({ input }) => {
    const v = await verifySmtp();
    if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.error ? `Couldn't connect: ${v.error}` : "Couldn't connect to the mail server." });
    const m = testEmail(getSchoolName());
    const sent = await sendMail({ to: input.to, subject: m.subject, text: m.text, html: m.html });
    if (!sent) throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Connected, but the test email could not be sent.' });
    return { ok: true as const };
  }),

  // ── Payments: Stripe webhook signing secret (§13.4). Auto-registered on boot when possible; this is
  // the status + manual-paste fallback. The secret is WRITE-ONLY (never returned).
  stripeWebhookGet: adminProcedure.query(() => {
    const stored = !!getStripeWebhookSecret();
    return {
      configured: stored || !!fabricWebhookSecret(),
      source: stored ? ('stored' as const) : fabricWebhookSecret() ? ('platform' as const) : ('none' as const),
      url: ourWebhookUrl(), // where Stripe should send events (for manual setup); '' when no public URL
    };
  }),
  stripeWebhookSet: adminProcedure.input(z.object({ secret: z.string().trim().min(1).max(255) })).mutation(({ ctx, input }) => {
    if (!input.secret.startsWith('whsec_')) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A Stripe webhook signing secret starts with "whsec_".' });
    setStripeWebhookSecret(input.secret);
    audit(auditActor(ctx), 'settings.stripe.webhook', { entity: 'settings', detail: { source: 'manual' } });
    return { ok: true as const };
  }),
});
