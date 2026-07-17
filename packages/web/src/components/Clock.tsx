// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Top-bar clock. Matches the sibling APPS' chrome (OpenMasjidKiosk/Donations/Display:
 * a plain `.topclock` — time over a muted date, NO glass box) rather than the OS
 * dashboard's boxed `.clock-widget` (§15 — copy the apps, not the platform). Keeps our
 * prefs (12/24h + time zone) + the quiet tap-to-ambient extra.
 */
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { ambient } from '../lib/ambient';

function format(now: Date, clock24h: boolean, tz: string): { time: string; date: string } {
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: !clock24h };
  const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  try {
    const zone = tz || undefined;
    return {
      time: new Intl.DateTimeFormat(undefined, { ...timeOpts, timeZone: zone }).format(now),
      date: new Intl.DateTimeFormat(undefined, { ...dateOpts, timeZone: zone }).format(now),
    };
  } catch {
    return {
      time: new Intl.DateTimeFormat(undefined, timeOpts).format(now),
      date: new Intl.DateTimeFormat(undefined, dateOpts).format(now),
    };
  }
}

export function Clock() {
  const prefs = usePrefs();
  const [now, setNow] = useState(() => new Date());
  const taps = useRef<number[]>([]);

  useEffect(() => {
    if (!prefs.showClock) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [prefs.showClock]);

  if (!prefs.showClock) return null;
  const { time, date } = format(now, prefs.clock24h, prefs.timezone);

  function onTap() {
    const t = Date.now();
    taps.current = taps.current.filter((p) => t - p < 3000).concat(t);
    if (taps.current.length >= 15) {
      taps.current = [];
      ambient.toggle();
    }
  }

  return (
    <div className="topclock" role="group" aria-label={`${time}, ${date}`} onClick={onTap}>
      <span className="topclock-time">{time}</span>
      <span className="topclock-date">{date}</span>
    </div>
  );
}
