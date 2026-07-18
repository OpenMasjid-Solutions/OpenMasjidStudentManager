// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Client money helpers. All amounts cross the wire as integer cents (server is the source of
 *  truth); these are for display + parsing the finance forms. */

export function formatMoney(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Parse a dollars-and-cents input string to integer cents; null if not a valid positive amount. */
export function parseCents(input: string): number | null {
  const n = Number(input.trim());
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}
