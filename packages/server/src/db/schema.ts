// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Drizzle schema (SQLite). Grows one vertical slice at a time (CLAUDE.md §9, §20).
 * Rules that apply as tables land: money in integer cents; balances derived, never
 * stored; payments/report-cards/transcripts immutable + versioned; FKs RESTRICT on
 * money paths; every table has id/created_at/updated_at. Migrations are forward-only
 * and generated into ./drizzle.
 *
 * Slice 1: `settings`.  Slice 2 (auth): `users`, `sessions`.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** The four roles (CLAUDE.md §5). Student logins are 🔭 deferred. */
export type Role = 'admin' | 'teacher' | 'finance' | 'parent';

/** App-owned settings (SMTP, Stripe choice, policies, etc. — added over time).
 *  This is NOT a masjid profile; each app owns its own config (org rule). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Setting = typeof settings.$inferSelect;

/** Local accounts. Password is argon2id (auth/passwords.ts) — never plaintext, and
 *  never logged. Staff/parent creation comes in later slices; slice 2 is first-run
 *  admin + login + sessions. Soft-disable via `status`, never hard-delete money/grade
 *  references (CLAUDE.md §9). */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  displayName: text('display_name'),
  /** Staff are forced to set a new password on first login (CLAUDE.md §12). */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type User = typeof users.$inferSelect;

/** Server-side sessions. The cookie holds an opaque random token; we store only its
 *  SHA-256 (`tokenHash`) so a leaked DB row can't be replayed as a cookie. `source`
 *  distinguishes a local password login from an OpenMasjidOS SSO-minted admin session
 *  (which has no local user row) — see trpc/auth.ts + fabric/platform.ts. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<Role>().notNull(),
  source: text('source').$type<'local' | 'sso'>().notNull(),
  /** Display-only username (untrusted for SSO — CLAUDE.md §12). */
  username: text('username'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Session = typeof sessions.$inferSelect;
