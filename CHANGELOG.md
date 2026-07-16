<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Changelog

All notable changes to **OpenMasjid Students** are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). `1.0.0` is reserved for launch.

## [Unreleased]

## [0.2.0]

### Added
- **Authentication + access-origin policy** (the security foundation — §5, §12, §12.4, §14):
  - Local accounts with **argon2id** password hashing (`@node-rs/argon2`), server-side
    sessions (opaque token; only its SHA-256 is stored), first-run admin setup, login,
    logout. Login is brute-force rate-limited on the real TCP peer with generic errors.
  - **Origin policy: `admin` is LAN-only** — admin login AND existing admin sessions are
    refused over the Cloudflare tunnel; teacher/finance/parent work from both origins.
    Enforced in one tRPC middleware consulted by every procedure. Admin-over-tunnel is
    refused *before* password verification, so the tunnel is never a password oracle.
  - **SSO fast-path** (LAN only, env-gated): a valid OpenMasjidOS dashboard session mints
    a short-lived (1 h) local admin session; `username` treated as untrusted display text.
  - 32 tests: argon2id, origin classification + the full role × origin matrix, rate
    limiting, first-run, login, admin@tunnel → 403 at login and session-use, role walls, SSO.
- Auth UI: first-run **Setup**, **Login** (with the friendly admin-only-on-LAN note),
  signed-in **Home** placeholder + sign out; all strings in i18n (en/ar/ur), RTL-correct.

### Changed
- **One-click install** — removed the manifest `settings:` block; school name, currency and
  the Stripe account are configured inside the app (matches OpenMasjid Donations).

### Note
- Origin classification keys on `cf-ray` only (not `x-forwarded-proto`) — a deliberate,
  documented deviation from §12.4's literal wording, required because this `https: true`
  app's LAN TLS proxy also sets `x-forwarded-proto: https`. See `docs/DATA_MODEL.md`.

## [0.1.0]
Initial scaffolding, published to the OpenMasjidAPPS catalog: monorepo skeleton (npm
workspaces), Fastify + tRPC + SQLite (WAL) via Drizzle with migrations-on-boot, the
OpenMasjidOS "liquid glass" design system ported verbatim (i18n/RTL, dark/light, Amiri
Naskh), the `students/billing` contract + docs, and the multi-arch → GHCR CI.
