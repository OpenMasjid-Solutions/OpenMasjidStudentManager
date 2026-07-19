// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * App-owned settings (CLAUDE.md §6 — NOT a masjid profile injected by the platform; this app
 * collects and owns its own config). Simple typed key/value over the `settings` table. School
 * name and the report-card merit toggle are the first entries; SMTP/Stripe join later.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';

export const SETTING_KEYS = {
  schoolName: 'school_name',
  currency: 'currency',
  meritOnReportCard: 'merit_on_report_card',
  externalPayments: 'external_payments', // Donations/Kiosk tuition campaign on/off (§11.2 info.enabled)
} as const;

export function getSetting(key: string): string | null {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const ts = new Date();
  const existing = db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get();
  if (existing) db.update(settings).set({ value, updatedAt: ts }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value, updatedAt: ts }).run();
}

export function getSchoolName(): string {
  return getSetting(SETTING_KEYS.schoolName) || 'Our Madrasa';
}
export function getCurrency(): string {
  return getSetting(SETTING_KEYS.currency) || 'usd';
}
export function getMeritOnReportCard(): boolean {
  return getSetting(SETTING_KEYS.meritOnReportCard) === '1';
}
/** External (Donations/Kiosk) tuition payments — on unless the admin turned them off. */
export function getExternalPaymentsEnabled(): boolean {
  return getSetting(SETTING_KEYS.externalPayments) !== '0';
}
