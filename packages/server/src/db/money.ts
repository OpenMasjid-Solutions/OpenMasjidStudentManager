// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The ONE money-formatting helper (CLAUDE.md §9, §16). All money is stored and
 * moved as integer cents; no floats anywhere in the ledger. Later slices add the
 * ledger/allocation engine (billing/ledger.ts) which is the single write path.
 */

/** Convert major units (e.g. dollars) to integer cents. */
export function toCents(major: number): number {
  return Math.round(major * 100);
}

/** Convert integer cents to major units. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Friendly localized money string for an integer-cents amount, e.g. "$350.00". */
export function formatMoney(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() }).format(fromCents(cents));
  } catch {
    return `${fromCents(cents).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
