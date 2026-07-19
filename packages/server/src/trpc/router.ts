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
import { staffRouter } from './staff';
import { classesRouter } from './classes';
import { scheduleRouter } from './schedule';
import { attendanceRouter } from './attendance';
import { gradesRouter } from './grades';
import { meritRouter } from './merit';
import { examsRouter } from './exams';
import { reportsRouter } from './reports';
import { settingsRouter } from './settings';
import { commentsRouter } from './comments';
import { billingRouter } from './billing';
import { portalRouter } from './portal';
import { admissionsRouter } from './admissions';
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
  staff: staffRouter,
  classes: classesRouter,
  schedule: scheduleRouter,
  attendance: attendanceRouter,
  grades: gradesRouter,
  merit: meritRouter,
  exams: examsRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  comments: commentsRouter,
  billing: billingRouter,
  portal: portalRouter,
  admissions: admissionsRouter,
});

export type AppRouter = typeof appRouter;
