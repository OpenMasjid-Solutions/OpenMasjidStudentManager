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
 * Slice 3 (People & SIS): `families`, `students`, `guardians`, `guardian_families`,
 *   `guardian_users`, `emergency_contacts`, `audit_log`.
 */
import { sqliteTable, text, integer, primaryKey, index, unique } from 'drizzle-orm/sqlite-core';

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

// ── People & SIS (slice 3) ───────────────────────────────────────────────────

/** A family groups students and links to guardians. Archived, never hard-deleted
 *  (money/records reference it). `name` is the display label (e.g. "Ismail family"). */
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes'),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Family = typeof families.$inferSelect;

/** A student. The PIN is a low-entropy capability token (6-digit CSPRNG, UNIQUE per
 *  install) used for name+PIN lookup at the Donations site / Kiosk and one door into
 *  portal self-registration — it is RETRIEVABLE (printed on statements), so it is stored
 *  in the clear and the DB file itself is a secret (§9/§14). Never logged / never in URLs.
 *  Withdrawn via `status`, never hard-deleted. FK to family is RESTRICT (archive, don't
 *  delete, a family with students). */
export const students = sqliteTable(
  'students',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: text('dob'), // optional ISO date (YYYY-MM-DD); minimal by design (§14)
    status: text('status').$type<'active' | 'withdrawn'>().notNull().default('active'),
    notes: text('notes'),
    pin: text('pin').notNull(),
    pinUpdatedAt: integer('pin_updated_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pinUq: unique('students_pin_uq').on(t.pin), // the unique lookup index (§11.2)
    familyIdx: index('students_family_idx').on(t.familyId),
  }),
);
export type Student = typeof students.$inferSelect;

/** A guardian (name + contact). May span multiple families via guardian_families. */
export const guardians = sqliteTable('guardians', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Guardian = typeof guardians.$inferSelect;

/** guardian ↔ family link (many-to-many). `relation` is free text (father/mother/walī…).
 *  `isEmergencyContact` flags this guardian as an emergency contact for the family (§4). */
export const guardianFamilies = sqliteTable(
  'guardian_families',
  {
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    relation: text('relation'),
    isEmergencyContact: integer('is_emergency_contact', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guardianId, t.familyId] }) }),
);
export type GuardianFamily = typeof guardianFamilies.$inferSelect;

/** Links a guardian to a parent USER account — this is what gives a parent portal login
 *  its family scope (§9/§12). Populated when a parent accepts an invite / self-registers. */
export const guardianUsers = sqliteTable(
  'guardian_users',
  {
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guardianId, t.userId] }), userUq: unique('guardian_users_user_uq').on(t.userId) }),
);
export type GuardianUser = typeof guardianUsers.$inferSelect;

/** Extra emergency contacts per family (guardians can also be flagged, above). */
export const emergencyContacts = sqliteTable(
  'emergency_contacts',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    relation: text('relation'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ familyIdx: index('emergency_contacts_family_idx').on(t.familyId) }),
);
export type EmergencyContact = typeof emergencyContacts.$inferSelect;

/** Append-only audit trail for sensitive writes (§14). Actor is stored as plain fields
 *  (not an FK) so history survives user changes; SSO admins have no user row (id null). */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    actorName: text('actor_name'),
    action: text('action').notNull(), // e.g. 'student.pin.regenerate', 'family.create'
    entity: text('entity'), // e.g. 'student'
    entityId: text('entity_id'),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(), // small before/after; NEVER PINs/secrets
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ entityIdx: index('audit_entity_idx').on(t.entity, t.entityId), atIdx: index('audit_at_idx').on(t.createdAt) }),
);
export type AuditEntry = typeof auditLog.$inferSelect;
