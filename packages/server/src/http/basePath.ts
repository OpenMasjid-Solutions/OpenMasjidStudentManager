// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Tunnel base-path helpers (CLAUDE.md §12/§15). When OpenMasjidOS exposes the app behind its
 * Cloudflare tunnel it serves us under an admin-chosen prefix (default "/students") and forwards the
 * FULL prefix WITHOUT stripping it. We derive the prefix from our injected public URL and strip it
 * before routing, so every route stays written at the root and behaves identically on the LAN (no
 * prefix) and behind the tunnel. Pure functions — unit-tested.
 */

/** The path prefix of a public URL, without a trailing slash (e.g. "/students"); "" for a bare host,
 *  an unset URL, or anything unparseable. This is the app's tunnel mount path. */
export function basePathFrom(publicUrl: string): string {
  if (!publicUrl) return '';
  try {
    const p = new URL(publicUrl).pathname.replace(/\/+$/, '');
    return p === '/' ? '' : p;
  } catch {
    return '';
  }
}

/** Strip the mount prefix from an incoming request URL. Empty base = passthrough. Handles the exact
 *  path, sub-paths, and a bare-prefix-with-query (e.g. "/students?x" → "/?x"). */
export function stripBasePath(url: string, base: string): string {
  if (!base) return url;
  if (url === base) return '/';
  if (url.startsWith(base + '/')) return url.slice(base.length);
  if (url.startsWith(base + '?')) return '/' + url.slice(base.length);
  return url;
}
