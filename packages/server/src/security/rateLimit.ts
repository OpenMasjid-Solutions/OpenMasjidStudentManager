// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * In-process login brute-force limiter (CLAUDE.md §12, §14). Keyed on the REAL TCP
 * peer, never a client-supplied X-Forwarded-For (which could be spoofed to bypass
 * the limit). Fixed window of failures, then a temporary block. Success resets.
 */
export interface LimiterOpts {
  maxFailures?: number;
  windowMs?: number;
  blockMs?: number;
}

interface Entry {
  count: number;
  windowResetAt: number;
  blockedUntil: number;
}

export class LoginLimiter {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly hits = new Map<string, Entry>();

  constructor(opts: LimiterOpts = {}) {
    this.maxFailures = opts.maxFailures ?? 8;
    this.windowMs = opts.windowMs ?? 15 * 60_000;
    this.blockMs = opts.blockMs ?? 15 * 60_000;
  }

  /** Milliseconds the caller must wait, or 0 if allowed to try now. */
  retryAfterMs(key: string, now = Date.now()): number {
    const e = this.hits.get(key);
    if (!e) return 0;
    if (e.blockedUntil > now) return e.blockedUntil - now;
    return 0;
  }

  fail(key: string, now = Date.now()): void {
    // Opportunistic cleanup so the map can't grow unbounded.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.blockedUntil <= now && v.windowResetAt <= now) this.hits.delete(k);
    }
    let e = this.hits.get(key);
    if (!e || e.windowResetAt <= now) {
      e = { count: 0, windowResetAt: now + this.windowMs, blockedUntil: 0 };
      this.hits.set(key, e);
    }
    e.count += 1;
    if (e.count >= this.maxFailures) {
      e.blockedUntil = now + this.blockMs;
      e.count = 0;
      e.windowResetAt = now + this.blockMs;
    }
  }

  succeed(key: string): void {
    this.hits.delete(key);
  }
}

/** Shared instance used by the auth router. */
export const loginLimiter = new LoginLimiter();

/** Parent-portal invite acceptance — internet-facing, so per-IP throttled (§14). Tokens are
 *  256-bit and unguessable; this just caps abusive hammering of the accept endpoint. */
export const inviteAcceptLimiter = new LoginLimiter({ maxFailures: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 });
