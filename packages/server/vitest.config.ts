// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Vitest config. The only non-default is a generous testTimeout: report-card / transcript generation
 * runs @react-pdf/renderer, which is CPU-heavy (~1–4s per PDF) and slow enough that the 5s default
 * flakes under full-suite parallel load. 30s gives those tests headroom without masking real hangs.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
