// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** App settings (admin-only): school name, currency, and the report-card merit toggle. */
import { z } from 'zod';
import { router, adminProcedure, auditActor } from './trpc';
import { SETTING_KEYS, getSchoolName, getCurrency, getMeritOnReportCard, setSetting } from '../settings';
import { audit } from '../audit';

export const settingsRouter = router({
  get: adminProcedure.query(() => ({
    schoolName: getSchoolName(),
    currency: getCurrency(),
    meritOnReportCard: getMeritOnReportCard(),
  })),

  set: adminProcedure
    .input(z.object({ schoolName: z.string().trim().max(160).optional(), currency: z.enum(['usd', 'cad', 'gbp', 'eur']).optional(), meritOnReportCard: z.boolean().optional() }))
    .mutation(({ ctx, input }) => {
      if (input.schoolName !== undefined) setSetting(SETTING_KEYS.schoolName, input.schoolName);
      if (input.currency !== undefined) setSetting(SETTING_KEYS.currency, input.currency);
      if (input.meritOnReportCard !== undefined) setSetting(SETTING_KEYS.meritOnReportCard, input.meritOnReportCard ? '1' : '0');
      audit(auditActor(ctx), 'settings.update', { entity: 'settings', detail: { keys: Object.keys(input) } });
      return { ok: true as const };
    }),
});
