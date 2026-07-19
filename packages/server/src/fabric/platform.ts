// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Talking TO the OpenMasjidOS platform (CLAUDE.md §12 SSO fast-path). Server-to-server
 * only. The env (base URL + our per-app secret) is read from config, which reads it
 * every process start and never persists it (restore-resilient). All calls fail soft:
 * if the platform is unreachable, the app falls back to local login.
 */
import { config, fabricConfigured } from '../config';

export interface PlatformProbe {
  /** false only if we tried to reach the platform and could not. */
  reachable: boolean;
  /** Present iff the platform confirms an authenticated dashboard session. */
  username?: string;
}

/**
 * SSO fast-path: forward the visitor's `omos_session` cookie to the platform's
 * session endpoint with our app secret. On {authenticated:true} the caller mints a
 * short-lived local admin session. `username` is an identity signal only — treated as
 * untrusted display text by the caller (§12). ~4s timeout; no redirects.
 */
export async function probePlatformSession(cookieHeader: string | undefined): Promise<PlatformProbe> {
  if (!fabricConfigured()) return { reachable: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${config.omosBaseUrl}/api/auth/session`, {
      method: 'GET',
      headers: {
        'X-OpenMasjid-App-Secret': config.omosAppSecret,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      signal: ctrl.signal,
      redirect: 'error',
    });
    clearTimeout(timer);
    if (!res.ok) return { reachable: true };
    const body = (await res.json()) as { authenticated?: boolean; username?: unknown };
    if (body.authenticated === true) {
      return { reachable: true, username: typeof body.username === 'string' ? body.username : undefined };
    }
    return { reachable: true };
  } catch {
    return { reachable: false };
  }
}

/**
 * Fire a notification to the masjid webhook via the OS core (CLAUDE.md §4 — payments, autopay
 * failures, new admissions, per-PIN lockouts). Best-effort: no-op when the platform isn't wired in,
 * never throws, and NEVER carries PII (event name + ids only, §14).
 */
export async function notifyPlatform(event: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (!fabricConfigured()) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`${config.omosBaseUrl}/api/fabric/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-OpenMasjid-App-Secret': config.omosAppSecret },
      body: JSON.stringify({ event, ...detail }),
      signal: ctrl.signal,
      redirect: 'error',
    });
    clearTimeout(timer);
  } catch {
    /* best-effort — a missed notification is never a failure of the operation that triggered it */
  }
}
