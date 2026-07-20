// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Transactional email copy (CLAUDE.md §4/§15). English-only in v1 (there is no server-side i18n).
 * Voice: plain and warm for parents — no jargon, no sacred text as decoration. Receipts say
 * "payment", NEVER "donation" (§11.3 — tuition is generally not tax-deductible). Each builder returns
 * { subject, text, html }; the HTML is minimal + inline-styled (email clients ignore <style>) and the
 * text part is always a complete fallback.
 */

export interface Email {
  subject: string;
  text: string;
  html: string;
}

/** Escape for safe interpolation into the HTML part (names/labels are app data, but treat as text). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A shared, restrained HTML shell — a heading, body paragraphs, and an optional call-to-action
 *  button. No remote images, no web fonts (many clients block them); system font stack only. */
function shell(heading: string, paragraphs: string[], cta?: { label: string; url: string }, footer?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2d28;">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0;"><a href="${esc(cta.url)}" style="background:#1FA37A;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">${esc(cta.label)}</a></p>`
    : '';
  const foot = footer ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#8a978f;">${esc(footer)}</p>` : '';
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">',
    `<h1 style="font-size:19px;line-height:1.35;color:#0E1814;margin:0 0 16px;">${esc(heading)}</h1>`,
    body,
    button,
    foot,
    '</div>',
  ].join('');
}

/** Parent-portal invite (§12 door 1). */
export function inviteEmail(schoolName: string, guardianName: string, url: string): Email {
  const hi = guardianName ? `Assalāmu ʿalaykum ${guardianName},` : 'Assalāmu ʿalaykum,';
  const subject = `Set up your ${schoolName} parent account`;
  const text = [
    hi,
    '',
    `${schoolName} has invited you to the parent portal, where you can see your children's grades, attendance, schedule, report cards, and your family balance — and pay tuition by card.`,
    '',
    'Set your password to get started:',
    url,
    '',
    'This link works once and expires in 7 days. If it has expired, please ask the office for a new invite.',
  ].join('\n');
  const html = shell(
    hi,
    [
      `${esc(schoolName)} has invited you to the <strong>parent portal</strong> — see your children's grades, attendance, schedule, report cards and your family balance, and pay tuition by card.`,
      'Set your password to get started:',
    ],
    { label: 'Set up my account', url },
    'This link works once and expires in 7 days. If it has expired, ask the office for a new invite.',
  );
  return { subject, text, html };
}

/** Payment receipt (§13.2.5 — wording is "payment", never "donation"). */
export function receiptEmail(schoolName: string, amountFormatted: string, portalUrl: string): Email {
  const subject = `Your ${schoolName} payment of ${amountFormatted}`;
  const text = [
    'Assalāmu ʿalaykum,',
    '',
    `We've received your tuition payment of ${amountFormatted}. JazākumAllāhuKhayran.`,
    '',
    portalUrl ? `You can see your balance and payment history any time in the parent portal:\n${portalUrl}` : 'You can see your balance and payment history any time in the parent portal.',
    '',
    `— ${schoolName}`,
  ].join('\n');
  const html = shell(
    'Payment received',
    [
      `We've received your tuition <strong>payment of ${esc(amountFormatted)}</strong>. JazākumAllāhuKhayran.`,
      'You can see your balance and payment history any time in the parent portal.',
    ],
    portalUrl ? { label: 'Open the parent portal', url: portalUrl } : undefined,
    `— ${schoolName}`,
  );
  return { subject, text, html };
}

/** Autopay charge failed (§13.3). `final` = the third strike, after which autopay is turned off. */
export function autopayFailureEmail(schoolName: string, portalUrl: string, final: boolean): Email {
  if (final) {
    const subject = `Autopay turned off for your ${schoolName} account`;
    const text = [
      'Assalāmu ʿalaykum,',
      '',
      `We tried to charge your saved card for tuition a few times but it didn't go through, so we've turned autopay off for now.`,
      '',
      portalUrl ? `Please pay your balance and update your card in the parent portal — then you can switch autopay back on:\n${portalUrl}` : 'Please pay your balance and update your card in the parent portal — then you can switch autopay back on.',
      '',
      `— ${schoolName}`,
    ].join('\n');
    const html = shell(
      'Autopay has been turned off',
      [
        `We tried to charge your saved card for tuition a few times but it didn't go through, so we've turned autopay off for now.`,
        'Please pay your balance and update your card in the portal — then you can switch autopay back on.',
      ],
      portalUrl ? { label: 'Pay now & update card', url: portalUrl } : undefined,
      `— ${schoolName}`,
    );
    return { subject, text, html };
  }
  const subject = `We couldn't charge your card for ${schoolName} tuition`;
  const text = [
    'Assalāmu ʿalaykum,',
    '',
    `We tried to charge your saved card for tuition but it didn't go through. We'll try again automatically in a few days.`,
    '',
    portalUrl ? `You can also pay now or update your card in the parent portal:\n${portalUrl}` : 'You can also pay now or update your card in the parent portal.',
    '',
    `— ${schoolName}`,
  ].join('\n');
  const html = shell(
    "We couldn't charge your card",
    [
      `We tried to charge your saved card for tuition but it didn't go through. We'll try again automatically in a few days.`,
      'You can also pay now or update your card in the portal.',
    ],
    portalUrl ? { label: 'Pay now or update card', url: portalUrl } : undefined,
    `— ${schoolName}`,
  );
  return { subject, text, html };
}

/** Admin "send test" probe. */
export function testEmail(schoolName: string): Email {
  const subject = `${schoolName}: test email`;
  const text = `This is a test email from ${schoolName}. If you received it, your email settings are working.`;
  const html = shell('Email is working', [`This is a test email from <strong>${esc(schoolName)}</strong>. If you received it, your email settings are working.`]);
  return { subject, text, html };
}
