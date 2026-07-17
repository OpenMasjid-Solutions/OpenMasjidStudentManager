// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Timetable time helpers. Sessions store minutes-from-midnight (locale-agnostic); the UI
 *  formats them with Intl so Arabic/Urdu locales get their own numerals and AM/PM. */

/** Minutes-from-midnight → a locale-formatted clock label (e.g. "10:00 AM" / "١٠:٠٠ ص"). */
export function minToLabel(min: number, lang: string): string {
  const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return minToInputValue(min);
  }
}

/** Minutes → a `<input type="time">` value ("HH:MM", 24h). */
export function minToInputValue(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** An "HH:MM" time-input value → minutes-from-midnight. */
export function inputValueToMin(v: string): number {
  const [h, m] = v.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}
