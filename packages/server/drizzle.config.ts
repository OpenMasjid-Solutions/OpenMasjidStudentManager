// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Drizzle Kit config. Migrations are GENERATED from src/db/schema.ts into
 * ./drizzle (committed, forward-only) and APPLIED on boot (see src/db/index.ts).
 */
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config;
