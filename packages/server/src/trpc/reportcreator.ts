// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report Creator (CLAUDE.md §4, §5, §14) — saved reports over CODE-DEFINED datasets, never raw SQL.
 * Admin sees all datasets; finance sees billing + directory datasets only (enforced by the registry's
 * per-dataset minRole, re-checked on every run). Teachers/parents get no Report Creator (the
 * procedure gates to admin|finance). The `run` output is projected/filtered/sorted in memory over a
 * fixed per-dataset query — user picks never reach SQL.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminOrFinanceProcedure } from './trpc';
import { DATASETS, roleCanSee, runReport } from '../reporting/registry';
import { getCurrency } from '../settings';

const COL = z.string().min(1).max(64);

export const reportCreatorRouter = router({
  /** Datasets this caller may use (key, label, columns) — role-scoped at the registry. */
  datasets: adminOrFinanceProcedure.query(({ ctx }) => {
    const role = ctx.session?.role ?? '';
    return DATASETS.filter((d) => roleCanSee(role, d.minRole)).map((d) => ({ key: d.key, label: d.label, columns: d.columns }));
  }),

  /** Run a report: pick columns / filters / sort over one dataset. All picks validated in the runner. */
  run: adminOrFinanceProcedure
    .input(
      z.object({
        datasetKey: z.string().min(1).max(64),
        columns: z.array(COL).max(64).optional(),
        filters: z.array(z.object({ col: COL, op: z.enum(['contains', 'equals']), value: z.string().max(200) })).max(20).optional(),
        sort: z.object({ col: COL, dir: z.enum(['asc', 'desc']) }).optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      try {
        const result = runReport(ctx.session?.role ?? '', input);
        return { ...result, currency: getCurrency() };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'dataset_forbidden') throw new TRPCError({ code: 'FORBIDDEN', message: 'You don’t have access to that dataset.' });
        if (msg === 'dataset_not_found') throw new TRPCError({ code: 'NOT_FOUND', message: 'Report dataset not found.' });
        throw e;
      }
    }),
});
