// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Lenient student-name matching for the name+PIN doors (CLAUDE.md §11.2) — the Fabric tuition lookup
 * (donations/kiosk) and parent self-registration both use THIS one implementation, so the rule can't
 * drift between them (§16). Diacritic/case-insensitive; every token the person typed must appear in
 * the registered full name (so "Yusuf" matches "Yusuf Ismail", but a wrong name never matches).
 */

/** Diacritic/case-insensitive normalization (NFD, strip combining marks, lowercase, trim). */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** True iff every token in `typed` appears in the registered `first last` name. */
export function nameMatches(typed: string, first: string, last: string): boolean {
  const full = normName(`${first} ${last}`);
  const tokens = normName(typed).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => full.includes(t));
}
