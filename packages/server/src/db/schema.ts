// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Drizzle schema (SQLite). Grows one vertical slice at a time (CLAUDE.md §9, §20).
 * Rules that apply as tables land: money in integer cents; balances derived, never
 * stored; payments/report-cards/transcripts immutable + versioned; FKs RESTRICT on
 * money paths; every table has id/created_at/updated_at. Migrations are forward-only
 * and generated into ./drizzle.
 *
 * Slice 1 ships only the key-value `settings` store so migrate-on-boot has a table
 * to create and the app has somewhere to keep its own (non-masjid) config.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** App-owned settings (SMTP, Stripe choice, policies, etc. — added over time).
 *  This is NOT a masjid profile; each app owns its own config (org rule). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Setting = typeof settings.$inferSelect;
