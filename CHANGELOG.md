<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Changelog

All notable changes to **OpenMasjid Students** are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). `1.0.0` is reserved for launch.

## [Unreleased]

### Added
- Monorepo skeleton (npm workspaces: `packages/server` + `packages/web`), TypeScript
  `strict`, SPDX headers, AGPL-3.0-only licensing, CLA + CONTRIBUTING, `VERSION`.
- Server boot: Fastify + tRPC + SQLite (WAL) via Drizzle, migrations-on-boot, static
  UI serving with SPA fallback, `/healthz`.
- Web app shell: React + Vite, the OpenMasjidOS "liquid glass" design system ported
  verbatim (tokens/glass/app CSS + Motion presets + cursor glint + masjid glyphs),
  i18n (en/ar/ur) with full RTL, dark/light/system theme flip, and a login screen in
  the family look. Bundled OFL Amiri (Naskh) face for Arabic.
- `docs/FABRIC_BILLING_CONTRACT.md` (the `students/billing` cross-repo contract, §11
  verbatim); `docs/PAYMENTS.md` and `docs/DATA_MODEL.md` (with the open-questions log).
- Catalog/CI scaffolding: `manifest.yaml`, `docker-compose.yml`, multi-stage `Dockerfile`,
  `.github/workflows/build-image.yml` (multi-arch → GHCR) + `cla.yml`.

## [0.1.0] — unreleased
Initial scaffolding. Not yet published to the OpenMasjidAPPS catalog.
