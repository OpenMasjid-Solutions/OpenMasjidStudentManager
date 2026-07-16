// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * SQLite (WAL) via better-sqlite3 + Drizzle. Migrations are committed under
 * ./drizzle and applied on boot (forward-only). The DB file lives on the /data
 * volume and — because student PINs are retrievable (printed on statements) — the
 * file itself is a secret (CLAUDE.md §9, §14). Never a hash-only PIN column.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config';
import { makeLog } from '../logger';
import * as schema from './schema';

const log = makeLog('db');

fs.mkdirSync(config.dataDir, { recursive: true });
const sqlite = new Database(path.join(config.dataDir, 'students.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;

/** Apply committed migrations. Idempotent — Drizzle tracks what has been applied.
 *  Works in dev (src/db → ../../drizzle) and prod (dist/db → ../../drizzle, where
 *  the Dockerfile copies the committed migrations alongside dist). */
export function runMigrations(): void {
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');
  migrate(db, { migrationsFolder });
  log.info('migrations applied');
}
