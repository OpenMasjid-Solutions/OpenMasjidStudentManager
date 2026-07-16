// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * i18next setup. English is the primary locale; Arabic + Urdu ship so RTL is real
 * from day one (CLAUDE.md §15 — Arabic/Urdu-ready, RTL-correct). Every user-facing
 * string goes through here — no hardcoded English in components. Translations for
 * ar/ur are provisional and expand per slice.
 *
 * (Adapted from OpenMasjidOS packages/ui/src/lib/i18n — upstream ships `en` only.
 *  i18n content is app-specific and not part of the re-syncable design system.)
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ar from './ar.json';
import ur from './ur.json';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
    ur: { translation: ur },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
