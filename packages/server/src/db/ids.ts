// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stable, URL-safe, prefixed record ids (e.g. `usr_...`, `ses_...`, `stu_...`).
 * CSPRNG-backed. Prefixes make ids self-describing in logs/URLs; the random part
 * is Crockford-ish base32 for readability. NOT for secrets — see auth/ for tokens.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // 32 chars, no i/l/o/u to avoid ambiguity

/** A random id like `usr_4h2k9p...` (default 20 random chars ≈ 100 bits). */
export function rid(prefix: string, len = 20): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] & 31];
  return `${prefix}_${out}`;
}
