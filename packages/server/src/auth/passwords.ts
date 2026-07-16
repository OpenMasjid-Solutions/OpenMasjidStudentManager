// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Password hashing — argon2id (CLAUDE.md §7, §12). Uses @node-rs/argon2 (Rust, napi
 * prebuilt binaries — ABI-stable across Node versions, no node-gyp; works on the Pi
 * arm64 and on dev machines alike). Passwords and hashes are NEVER logged.
 */
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

/** Minimum staff/admin password length (matches the family — OpenMasjidOS). */
export const MIN_PASSWORD_LENGTH = 12;

// `Algorithm.Argon2id === 2`. We use the literal via a type-only cast because the
// enum is an ambient const enum, which `isolatedModules` (and the web typecheck that
// imports the AppRouter type transitively) forbids accessing as a value.
const ARGON2ID = 2 as unknown as Algorithm;

// OWASP-recommended argon2id parameters, kept modest so a login stays quick on a
// Raspberry Pi: 19 MiB memory, 2 iterations, 1 lane.
const OPTS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // KiB (= 19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

/** Constant-time verify (argon2 verify is constant-time internally). Never throws. */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// A valid argon2id hash of a throwaway value, computed once. Login verifies the
// submitted password against THIS when the username is unknown / inactive / not
// allowed here, so response timing doesn't reveal whether an account exists (defeats
// username enumeration by timing — §14). Lazy + cached (avoids top-level await).
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('constant-time-decoy-not-a-real-password');
  }
  return dummyHashPromise;
}
