// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Transactional email (CLAUDE.md §4/§7). One nodemailer transport, built on demand from the app-owned
 * SMTP settings in the DB (§10). Every send is BEST-EFFORT: it never throws — a failed email must not
 * break the operation that triggered it (an invite still returns its copy/print link, a payment is
 * still recorded). Secrets (the SMTP password) are never logged; message bodies/addresses are never
 * logged either (§14). Without SMTP configured, `smtpConfigured()` is false and callers degrade
 * gracefully (copy/print links, office-handled resets).
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { getSmtp } from '../settings';
import { makeLog } from '../logger';

const log = makeLog('mail');

/** True when enough SMTP config exists to attempt a send (host + from). */
export function smtpConfigured(): boolean {
  return getSmtp() !== null;
}

/** A fresh transport from the current DB settings, or null when unconfigured. Cheap to build; we do
 *  not cache it so a settings change takes effect immediately (no restart). */
function transport(): Transporter | null {
  const c = getSmtp();
  if (!c) return null;
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  });
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Send one email. Returns true on success, false when unconfigured or the send failed. Never throws.
 *  Logs only an error class/message on failure — never the recipient, subject, or body. */
export async function sendMail(m: Mail): Promise<boolean> {
  const c = getSmtp();
  const t = transport();
  if (!c || !t) return false;
  try {
    await t.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return true;
  } catch (e) {
    log.warn('email send failed', { error: (e as Error).message });
    return false;
  } finally {
    t.close();
  }
}

/** Send the same email to several recipients (e.g. all a family's guardians). Returns how many sent. */
export async function sendMailTo(recipients: string[], subject: string, text: string, html?: string): Promise<number> {
  let sent = 0;
  for (const to of recipients) {
    if (await sendMail({ to, subject, text, html })) sent++;
  }
  return sent;
}

/** Verify the SMTP connection + credentials (for the admin "test" button). Never throws. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const t = transport();
  if (!t) return { ok: false, error: 'SMTP is not configured.' };
  try {
    await t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    t.close();
  }
}
