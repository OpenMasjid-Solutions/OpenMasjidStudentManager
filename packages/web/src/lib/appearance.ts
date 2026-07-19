// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
// Adapted from OpenMasjidDonations web/src/prefs.ts appearance-sync (same-org AGPL, CLAUDE.md §15) —
// the CONSUMER side of the OS Fabric appearance layer. Kept SEPARATE from the verbatim-ported
// lib/prefs.ts so that file stays structurally identical to OpenMasjidOS upstream and re-syncable.
/**
 * Inherit the OpenMasjidOS dashboard's appearance (wallpaper + light/dark + accent). Two hand-offs:
 *   1. the `#omos=…` base64url fragment the OS adds when an admin opens us from the LAN dashboard
 *      (one-shot, applied before first paint, then cleared from the URL);
 *   2. live sync: poll our own same-origin relay (GET /api/public/appearance → the server fetches the
 *      platform) every 45s + on window focus, so a theme change in the OS reaches an open portal tab.
 * A manual theme change in-app turns following OFF (stopFollowing) so we stop overriding the user's
 * choice; opening again from the dashboard re-adopts. Presentation only — the `#omos` fragment is
 * attacker-craftable, so we read theme/wallpaper/accent and NOTHING security-relevant.
 */
import { useEffect } from 'react';
import { prefsStore } from './prefs';
import type { Prefs } from './prefs';
import { withBase } from './base';

const FOLLOW_KEY = 'omos-follow-appearance';

function following(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== '0'; // default: follow the OS
  } catch {
    return true;
  }
}
function setFollowing(v: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, v ? '1' : '0');
  } catch {
    /* private mode — the in-memory default is already "follow" */
  }
}

/** A manual appearance change in-app: stop letting the OS override the user's choice. */
export function stopFollowing(): void {
  setFollowing(false);
}

const THEME_VALUES: readonly string[] = ['system', 'dark', 'light'];
function normTheme(v: unknown): Prefs['theme'] {
  return THEME_VALUES.includes(String(v)) ? (v as Prefs['theme']) : 'system';
}

interface OmosAppearance {
  theme?: string;
  wallpaper?: string;
  wallpaperImage?: string;
  accent?: string;
}

/** Map the OS appearance payload to a prefs patch — theme/wallpaper/accent only (NOT language: this
 *  app owns its own i18n). SceneBackground sanitises wallpaperImage before rendering it. */
function appearancePatch(p: OmosAppearance): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (p.theme != null) out.theme = normTheme(p.theme);
  if (typeof p.wallpaper === 'string') out.wallpaper = p.wallpaper;
  if (typeof p.wallpaperImage === 'string') out.wallpaperImage = p.wallpaperImage;
  if (typeof p.accent === 'string') out.accent = p.accent;
  return out;
}

/** Read + clear the `#omos=…` fragment (base64url JSON). Returns null when absent/invalid. */
function readOmosFragment(): OmosAppearance | null {
  const m = typeof location !== 'undefined' ? location.hash.match(/omos=([^&]+)/) : null;
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes)) as OmosAppearance;
    history.replaceState(null, '', location.pathname + location.search);
    return p;
  } catch {
    return null;
  }
}

/** Apply the one-shot OS hand-off fragment (if present) on first load, before paint. Call right
 *  after prefsStore.hydrate(). A fragment means the app was opened from the dashboard → adopt its
 *  look and (re)enable following. */
export function hydrateAppearance(): void {
  const omos = readOmosFragment();
  if (!omos) return;
  setFollowing(true);
  prefsStore.patch(appearancePatch(omos));
}

/** One-shot pull of the OS's current appearance via our same-origin relay. No-op when not following. */
export async function fetchOmosAppearance(): Promise<void> {
  if (!following()) return;
  try {
    const res = await fetch(withBase('/api/public/appearance'), { credentials: 'omit' });
    if (!res.ok || !following()) return;
    prefsStore.patch(appearancePatch((await res.json()) as OmosAppearance));
  } catch {
    /* platform offline — keep the current look (the #omos fragment, if any, already themed us) */
  }
}

/** Live-sync the OS appearance while embedded + following: poll every 45s and on window focus. Each
 *  poll is a no-op when following is off (a manual override), so the effect need not re-run on that. */
export function useOmosAppearanceSync(embedded: boolean): void {
  useEffect(() => {
    if (!embedded) return;
    void fetchOmosAppearance();
    const iv = window.setInterval(() => void fetchOmosAppearance(), 45_000);
    const onFocus = () => void fetchOmosAppearance();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('focus', onFocus);
    };
  }, [embedded]);
}
