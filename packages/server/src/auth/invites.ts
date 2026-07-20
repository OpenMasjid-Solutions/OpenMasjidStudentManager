// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Parent-portal invite minting (CLAUDE.md §12). Shared by the finance/admin "invite" action and the
 * admissions one-click enroll (which auto-invites). The RAW token rides only in the returned link
 * (never logged/stored — only its SHA-256 hash is persisted, like a session cookie); single-use,
 * 7-day expiry. Kept free of tRPC ctx so both callers can reuse it.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { guardians, guardianUsers, users, invites } from '../db/schema';
import { rid } from '../db/ids';
import { hashToken } from './sessions';
import { config } from '../config';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (§12)

/** The parent-portal invite/signup base — the tunnel public URL when set, else relative. */
export function portalBase(): string {
  return config.omosPublicUrl ? config.omosPublicUrl.replace(/\/+$/, '') : '';
}

export type MintResult =
  | { ok: true; token: string; url: string; email: string; guardianName: string }
  | { ok: false; reason: 'guardian_not_found' | 'no_email' | 'already_account' | 'email_taken' };

/** Create a single-use invite for a guardian, or explain why it can't be created. Does NOT send the
 *  email or write an audit entry — the caller owns those (they have the actor + i18n/friendly errors). */
export function mintInvite(guardianId: string, createdByUserId: string | null): MintResult {
  const g = db.select().from(guardians).where(eq(guardians.id, guardianId)).get();
  if (!g) return { ok: false, reason: 'guardian_not_found' };
  const email = (g.email ?? '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no_email' };
  if (db.select({ userId: guardianUsers.userId }).from(guardianUsers).where(eq(guardianUsers.guardianId, g.id)).get()) return { ok: false, reason: 'already_account' };
  if (db.select({ id: users.id }).from(users).where(eq(users.username, email)).get()) return { ok: false, reason: 'email_taken' };
  const token = randomBytes(32).toString('base64url');
  const ts = new Date();
  db.insert(invites).values({ id: rid('inv'), tokenHash: hashToken(token), guardianId: g.id, createdByUserId, createdAt: ts, expiresAt: new Date(ts.getTime() + INVITE_TTL_MS) }).run();
  return { ok: true, token, url: `${portalBase()}/family/invite?token=${token}`, email, guardianName: g.name };
}
