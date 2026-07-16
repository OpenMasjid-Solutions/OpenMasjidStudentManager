// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Fixed top-corner theme + language switch, shown on the auth screens. */
import { ThemeLangControls } from './ThemeLangControls';

export function ShellControls() {
  return (
    <div className="shell-controls">
      <ThemeLangControls />
    </div>
  );
}
