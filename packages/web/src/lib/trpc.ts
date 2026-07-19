// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Typed tRPC client. We import ONLY the server's AppRouter TYPE (CLAUDE.md §6, §8),
 * so the UI is end-to-end type-safe with zero runtime coupling to the server bundle.
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@openmasjid/students-server';
import { withBase } from './base';

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types for a procedure, e.g. RouterOutputs['admissions']['list'][number]. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// Same-origin in production; Vite proxies /trpc → the server (:8080) in dev. withBase keeps the
// tunnel prefix (e.g. /students/trpc) when the OS serves us behind its Cloudflare tunnel.
export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: withBase('/trpc') })],
});
