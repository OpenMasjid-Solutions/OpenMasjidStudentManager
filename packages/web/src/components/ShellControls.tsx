// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Top-corner theme + language switch, shown on every auth screen. Language switch
 *  flips the whole layout to RTL for ar/ur (CLAUDE.md §15). */
import { useTranslation } from 'react-i18next';
import { usePrefs, prefsStore } from '../lib/prefs';

const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
  { id: 'ur', label: 'اردو' },
];
const THEMES = ['dark', 'light', 'system'] as const;

export function ShellControls() {
  const { t } = useTranslation();
  const prefs = usePrefs();

  function cycleTheme() {
    const i = THEMES.indexOf(prefs.theme);
    prefsStore.patch({ theme: THEMES[(i + 1) % THEMES.length] });
  }

  return (
    <div className="shell-controls">
      <button type="button" className="btn btn--ghost fx-glint" onClick={cycleTheme} title={t('controls.theme')}>
        {t(`theme.${prefs.theme}`)}
      </button>
      <select
        className="input glass-inset shell-lang"
        value={prefs.language}
        onChange={(e) => prefsStore.patch({ language: e.target.value })}
        aria-label={t('controls.language')}
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
