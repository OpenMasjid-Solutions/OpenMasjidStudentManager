// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The root tRPC AppRouter. The web app imports ONLY its TYPE (CLAUDE.md §6, §8),
 * so this is the end-to-end type-safety boundary. Slice 1 exposes a single health
 * query; routers for auth/people/classes/… are added per §8 as slices land.
 */
import { router, publicProcedure } from './trpc';
import { config, fabricConfigured } from '../config';

export const appRouter = router({
  /** Liveness + a little context the shell shows (never any secret). */
  health: publicProcedure.query(() => ({
    ok: true,
    app: 'students' as const,
    version: config.version,
    standalone: !fabricConfigured(),
  })),
});

export type AppRouter = typeof appRouter;
