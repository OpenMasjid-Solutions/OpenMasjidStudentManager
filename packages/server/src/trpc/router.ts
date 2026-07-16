// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The root tRPC AppRouter. The web app imports ONLY its TYPE (CLAUDE.md §6, §8).
 * Routers for people/classes/… are added per §8 as slices land. Slice 2 adds `auth`.
 */
import { router, publicProcedure } from './trpc';
import { authRouter } from './auth';
import { peopleRouter } from './people';
import { recordsRouter } from './records';
import { config, fabricConfigured } from '../config';

export const appRouter = router({
  /** Liveness + a little context the shell shows (never any secret). */
  health: publicProcedure.query(() => ({
    ok: true,
    app: 'students' as const,
    version: config.version,
    standalone: !fabricConfigured(),
  })),

  auth: authRouter,
  people: peopleRouter,
  records: recordsRouter,
});

export type AppRouter = typeof appRouter;
