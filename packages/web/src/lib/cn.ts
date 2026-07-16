// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
// Ported verbatim from OpenMasjidOS packages/ui/src/lib/cn.ts @ c4d309f (v0.40.0) — keep structurally identical for re-sync (CLAUDE.md §15). See packages/web/PORTED_FROM_OPENMASJIDOS.md
import clsx, { type ClassValue } from 'clsx';

/** Tiny className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
