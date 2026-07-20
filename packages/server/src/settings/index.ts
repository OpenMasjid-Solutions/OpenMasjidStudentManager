// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * App-owned settings (CLAUDE.md §6 — NOT a masjid profile injected by the platform; this app
 * collects and owns its own config). Simple typed key/value over the `settings` table. School
 * name and the report-card merit toggle are the first entries; SMTP/Stripe join later.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';

export const SETTING_KEYS = {
  schoolName: 'school_name',
  currency: 'currency',
  meritOnReportCard: 'merit_on_report_card',
  externalPayments: 'external_payments', // Donations/Kiosk tuition campaign on/off (§11.2 info.enabled)
  reconcileCursor: 'stripe_reconcile_cursor', // unix seconds — last reconciled PI created-time (§11.4)
  reconcileLast: 'stripe_reconcile_last', // JSON summary of the last reconcile run (for the finance UI)
  smtp: 'smtp_config', // JSON blob: transactional email config (§4/§10). The password lives here in the
  // DB (the DB file is already a secret, §9) — never logged, never returned to the client.
  stripeWebhookSecret: 'stripe_webhook_secret', // §13.4 — the signing secret for OUR webhook endpoint,
  // auto-created on boot or pasted by the admin. Secret: never logged / never returned to the client.
} as const;

export function getSetting(key: string): string | null {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const ts = new Date();
  const existing = db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get();
  if (existing) db.update(settings).set({ value, updatedAt: ts }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value, updatedAt: ts }).run();
}

export function getSchoolName(): string {
  return getSetting(SETTING_KEYS.schoolName) || 'Our Madrasa';
}
export function getCurrency(): string {
  return getSetting(SETTING_KEYS.currency) || 'usd';
}
export function getMeritOnReportCard(): boolean {
  return getSetting(SETTING_KEYS.meritOnReportCard) === '1';
}
/** External (Donations/Kiosk) tuition payments — on unless the admin turned them off. */
export function getExternalPaymentsEnabled(): boolean {
  return getSetting(SETTING_KEYS.externalPayments) !== '0';
}

/** Transactional email (SMTP) config — app-owned, in the DB (§4/§10). `pass` is a secret: never log
 *  it, never return it to the client. */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465); false = STARTTLS (587)
  user: string;
  pass: string;
  from: string; // e.g. "An-Noor School <office@example.org>"
}

/** The stored SMTP config, or null when unconfigured (host + from are the minimum to send). */
export function getSmtp(): SmtpConfig | null {
  const raw = getSetting(SETTING_KEYS.smtp);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<SmtpConfig>;
    if (!c.host || !c.from) return null;
    return { host: c.host, port: typeof c.port === 'number' ? c.port : 587, secure: !!c.secure, user: c.user ?? '', pass: c.pass ?? '', from: c.from };
  } catch {
    return null;
  }
}

export function setSmtp(c: SmtpConfig): void {
  setSetting(SETTING_KEYS.smtp, JSON.stringify(c));
}

/** The Stripe webhook signing secret for OUR endpoint (§13.4) — auto-created on boot or pasted by the
 *  admin; null when neither. A secret: never logged / never returned to the client. */
export function getStripeWebhookSecret(): string | null {
  return getSetting(SETTING_KEYS.stripeWebhookSecret) || null;
}
export function setStripeWebhookSecret(secret: string): void {
  setSetting(SETTING_KEYS.stripeWebhookSecret, secret);
}
