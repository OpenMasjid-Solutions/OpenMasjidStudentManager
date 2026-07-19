// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
// Adapted from OpenMasjidDonations web/src/base.ts (same-org AGPL) — the shared family pattern for
// serving one build at the root (LAN) and under an OpenMasjidOS tunnel path (CLAUDE.md §12/§15).
/**
 * Runtime base path. When OpenMasjidOS exposes this app behind its Cloudflare tunnel it serves us
 * under an admin-chosen prefix (default "/students") and forwards that FULL prefix to us. The server
 * injects it into the page as `window.__OMOS_BASE__` (and a matching `<base href>`), so the client
 * builds API/nav URLs that keep the prefix. Empty when served at the root (direct LAN access / no
 * tunnel) — then everything behaves exactly as before. Read once per page load.
 */
declare global {
  interface Window {
    __OMOS_BASE__?: string;
  }
}

function read(): string {
  const raw = (typeof window !== 'undefined' && window.__OMOS_BASE__) || '';
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return '';
  return t.startsWith('/') ? t : '/' + t;
}

/** The base path, e.g. "/students" or "" (no trailing slash). */
export const BASE = read();

/** Prefix an absolute in-app path (e.g. "/trpc", "/reports/card/x") with the base path. */
export const withBase = (p: string): string => (BASE && p.startsWith('/') ? BASE + p : p);

/** Strip the base path off a `location.pathname` for client-side route matching, so the app sees
 *  "/apply" or "/family/invite" whether opened on the LAN (root) or under the tunnel ("/students"). */
export const stripBase = (pathname: string): string => {
  if (BASE && (pathname === BASE || pathname.startsWith(BASE + '/'))) return pathname.slice(BASE.length) || '/';
  return pathname;
};
