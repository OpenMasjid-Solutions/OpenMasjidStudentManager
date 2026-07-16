// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import { describe, it, expect } from 'vitest';
import { LoginLimiter } from './rateLimit';

describe('LoginLimiter', () => {
  it('allows attempts until the failure threshold, then blocks', () => {
    const l = new LoginLimiter({ maxFailures: 3, windowMs: 60_000, blockMs: 60_000 });
    const now = 1_000_000; // fixed clock (Date.now would break determinism)
    const key = '10.0.0.5';
    expect(l.retryAfterMs(key, now)).toBe(0);
    l.fail(key, now);
    l.fail(key, now);
    expect(l.retryAfterMs(key, now)).toBe(0); // 2 failures — still allowed
    l.fail(key, now); // 3rd → blocked
    expect(l.retryAfterMs(key, now)).toBeGreaterThan(0);
  });

  it('clears the block after it expires', () => {
    const l = new LoginLimiter({ maxFailures: 1, windowMs: 60_000, blockMs: 30_000 });
    const now = 5_000_000;
    l.fail('k', now);
    expect(l.retryAfterMs('k', now)).toBe(30_000);
    expect(l.retryAfterMs('k', now + 30_001)).toBe(0);
  });

  it('a success resets the counter', () => {
    const l = new LoginLimiter({ maxFailures: 2, windowMs: 60_000, blockMs: 60_000 });
    const now = 9_000_000;
    l.fail('peer', now);
    l.succeed('peer');
    l.fail('peer', now); // back to 1 failure, not blocked
    expect(l.retryAfterMs('peer', now)).toBe(0);
  });

  it('keys are independent (one peer cannot block another)', () => {
    const l = new LoginLimiter({ maxFailures: 1, windowMs: 60_000, blockMs: 60_000 });
    const now = 2_000_000;
    l.fail('attacker', now);
    expect(l.retryAfterMs('attacker', now)).toBeGreaterThan(0);
    expect(l.retryAfterMs('victim', now)).toBe(0);
  });
});
