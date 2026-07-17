// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The floating bottom dock — primary nav + open/minimized windows (the family shell,
 * matching OpenMasjidOS/Kiosk/Display). Adapted from OpenMasjidOS packages/ui/Dock:
 * our nav is a small fixed set of sections (state-driven, no router / no app-pinning),
 * and open windows restore from the dock. Uses the ported .dock/.dock-item styles (§15).
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Users, GraduationCap, UserCog, Settings as SettingsIcon, AppWindow } from 'lucide-react';
import { cn } from '../lib/cn';
import { useWindows } from './Windows';

export type Section = 'dashboard' | 'directory' | 'classes' | 'staff' | 'settings';

const ITEMS: { id: Section; icon: ReactNode; key: string }[] = [
  { id: 'dashboard', icon: <LayoutGrid size={20} />, key: 'nav.dashboard' },
  { id: 'directory', icon: <Users size={20} />, key: 'nav.directory' },
  { id: 'classes', icon: <GraduationCap size={20} />, key: 'nav.classes' },
  { id: 'staff', icon: <UserCog size={20} />, key: 'nav.staff' },
  { id: 'settings', icon: <SettingsIcon size={20} />, key: 'nav.settings' },
];

export function Dock({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }) {
  const { t } = useTranslation();
  const { windows, restore } = useWindows();

  return (
    <nav className="dock glass-dock" aria-label={t('nav.primary')}>
      {ITEMS.map((it) => (
        <button key={it.id} type="button" className={cn('dock-item', active === it.id && 'is-active')} aria-label={t(it.key)} onClick={() => onNavigate(it.id)}>
          {it.icon}
          <span className="dock-pop"><span className="dock-tip glass-raised">{t(it.key)}</span></span>
        </button>
      ))}

      {windows.length > 0 && <span className="dock-divider" aria-hidden="true" />}

      {windows.map((w) => (
        <button key={w.id} type="button" className="dock-item dock-item--window" aria-label={w.title} onClick={() => restore(w.id)}>
          <AppWindow size={20} />
          {w.minimized && <span className="dock-dot" aria-hidden="true" />}
          <span className="dock-pop"><span className="dock-tip glass-raised">{w.title}</span></span>
        </button>
      ))}
    </nav>
  );
}
