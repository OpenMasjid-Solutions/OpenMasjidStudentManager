// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Shared @react-pdf loader + storage helpers for the report-card and transcript pipelines.
 * @react-pdf is ESM, so it's dynamically imported once; the bundled Amiri font (Latin + Arabic)
 * is registered once. PDFs are written under /data/reports with randomized names and served only
 * through the authed routes (never a public mount).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export type Pdf = typeof import('@react-pdf/renderer');

let pdfMod: Pdf | null = null;
let fontRegistered = false;

/** The bundled Amiri font: at runtime it ships in PUBLIC_DIR/fonts; in dev it's in the web pkg. */
function fontPath(): string {
  if (config.publicDir) return path.join(config.publicDir, 'fonts', 'Amiri-Regular.ttf');
  return path.resolve(process.cwd(), '..', 'web', 'public', 'fonts', 'Amiri-Regular.ttf');
}

export async function getPdf(): Promise<Pdf> {
  if (!pdfMod) pdfMod = (await import('@react-pdf/renderer')) as Pdf;
  if (!fontRegistered) {
    pdfMod.Font.register({ family: 'Amiri', src: fontPath() });
    pdfMod.Font.registerHyphenationCallback((word) => [word]); // no hyphenation in tables
    fontRegistered = true;
  }
  return pdfMod;
}

export function reportsDir(): string {
  const dir = path.join(config.dataDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to a stored PDF (report card or transcript) for the authed serving routes. */
export function reportFilePath(filename: string): string {
  return path.join(reportsDir(), filename);
}
