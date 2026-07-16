// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './passwords';

describe('passwords (argon2id)', () => {
  it('hashes to an argon2id string and verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true); // proves the variant is argon2id
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('the-right-one-123');
    expect(await verifyPassword(hash, 'the-wrong-one-123')).toBe(false);
  });

  it('never throws on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });

  it('produces distinct hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same-password-value');
    const b = await hashPassword('same-password-value');
    expect(a).not.toEqual(b);
  });

  it('keeps the family minimum length', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });
});
