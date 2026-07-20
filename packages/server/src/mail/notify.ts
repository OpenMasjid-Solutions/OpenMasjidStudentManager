// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * High-level transactional senders (CLAUDE.md §4/§13). One place that composes the school name + the
 * right template + the transport, so routers stay thin. Every function is BEST-EFFORT and no-ops when
 * SMTP is unconfigured (returns false / 0) — callers degrade gracefully. Nothing here throws or logs
 * PII. The parent-portal link uses OPENMASJID_PUBLIC_URL when set (empty → no button, still valid).
 */
import { getSchoolName } from '../settings';
import { sendMail, sendMailTo, smtpConfigured } from './smtp';
import { guardianEmailsForFamily } from './recipients';
import { inviteEmail, receiptEmail, autopayFailureEmail, resetEmail } from './templates';
import { portalBase } from '../auth/invites';

function portalHome(): string {
  const b = portalBase();
  return b ? `${b}/family` : '';
}

/** Email a parent-portal invite to one guardian. Returns true if actually sent. Requires an ABSOLUTE
 *  base (the tunnel public URL): without it the invite link would be relative and dead in a mail
 *  client, so we DON'T email — the caller falls back to the copy/print link (which the web UI
 *  absolute-izes against the current LAN origin). Receipts/autopay notices still send without a base
 *  (they just drop the portal button), but an invite with no working link is useless. */
export async function sendInvite(email: string, url: string, guardianName: string): Promise<boolean> {
  if (!smtpConfigured() || !portalBase()) return false;
  const m = inviteEmail(getSchoolName(), guardianName, url);
  return sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
}

/** Email a password-reset link to a user. Requires an absolute base (like invites) so the link is
 *  clickable; returns true if actually sent. */
export async function sendReset(email: string, url: string): Promise<boolean> {
  if (!smtpConfigured() || !portalBase()) return false;
  const m = resetEmail(getSchoolName(), url);
  return sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
}

/** Email a payment receipt to a family's guardians (§13.2.5 — "payment", never "donation"). Returns
 *  how many were sent. `amountFormatted` is a display string like "$350.00". */
export async function sendReceipt(familyId: string, amountFormatted: string): Promise<number> {
  if (!smtpConfigured()) return 0;
  const emails = guardianEmailsForFamily(familyId);
  if (!emails.length) return 0;
  const m = receiptEmail(getSchoolName(), amountFormatted, portalHome());
  return sendMailTo(emails, m.subject, m.text, m.html);
}

/** Email an autopay-failure notice to a family's guardians (§13.3). `final` = the third strike (autopay
 *  now off). Returns how many were sent. */
export async function sendAutopayFailure(familyId: string, final: boolean): Promise<number> {
  if (!smtpConfigured()) return 0;
  const emails = guardianEmailsForFamily(familyId);
  if (!emails.length) return 0;
  const m = autopayFailureEmail(getSchoolName(), portalHome(), final);
  return sendMailTo(emails, m.subject, m.text, m.html);
}
