<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Changelog

All notable changes to **OpenMasjid Students** are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). `1.0.0` is reserved for launch.

## [Unreleased]

## [0.5.0]

### Changed
- **UI now uses the OpenMasjid family shell** (§15 — continuity with Kiosk / OpenMasjidOS /
  Display): the admin app has a top bar (brand + glass clock + profile menu), a **bottom
  dock** for navigation, and records (a family, a student, a class) open as **draggable
  macOS-style windows** — traffic-light controls, minimize-to-dock, stacking. Ported the
  shell from OpenMasjidOS (AppShell / Dock / WindowManager / Windows / Clock / ErrorBoundary;
  ProfileMenu adapted). Replaces the earlier bespoke topbar-nav so a masjid admin can't tell
  they left the platform.

### Added
- **Classes & scheduling groundwork** (§4): academic **terms** (one marked current),
  **classes** with a type (maktab / hifz / nazrah / ʿālim / custom) + an ordered, free-text
  **subject** list, **teacher assignment**, and **student enrollments** per class
  (withdraw / re-enroll). A **Dashboard** with live counts. Admin-only; teacher views +
  scoping + the weekly timetable come next.
- **Staff accounts** (§12): admin creates teacher/finance users with a temporary password;
  a **forced password change** on first sign-in; enable/disable (a disabled account's live
  sessions are revoked on the next request, via the session user re-check). 8 new tests
  (60 total): terms/classes/enrollments, teacher assignment (finance rejected), staff
  role walls, and the change-password flow.

## [0.4.0]

### Added
- **Student record extras** (§4/§5/§9/§14):
  - **Custom fields** — admin defines typed fields once (text / number / date / choose-one)
    in Settings; values live on each student and are validated against the field type on
    every write. Defs are soft-deleted so old values keep their meaning.
  - **Staff notes** — a running, append-only, staff-eyes-only activity log per student.
  - **Incidents** — date, category, description, action taken, recorded-by, with a
    per-incident **"visible to parents" toggle that defaults OFF** (§4). Finance never sees them.
- Admin UI: a **Settings** page (custom-field definitions) and a per-student record view
  (custom fields, notes, incidents) reached from the family record. i18n en/ar/ur, RTL.
- Walls tested (52 tests total): finance may read custom-field values but never notes/incidents;
  teacher/parent are denied for now (scoped reads land with classes/portal); the PIN and
  note/incident bodies never enter the audit trail.

### Fixed
- **`414 URI Too Long`** on the student record: tRPC batches multiple queries into one GET
  whose path exceeded Fastify's default `maxParamLength` (100), silently failing the batch
  (notes/incidents rendered empty). Raised `maxParamLength`. Caught by driving the real
  browser — the `createCaller` tests bypass HTTP and never hit it.

## [0.3.0]

### Added
- **People & SIS — the record of record** (§4/§5/§9/§14): families, students, guardians,
  the guardian↔family and guardian↔user links, and emergency contacts.
  - **Student PINs**: a 6-digit, CSPRNG, install-unique PIN is generated automatically at
    registration (the name+PIN lookup index for payments + portal). Retrievable by admin/
    finance, regenerable (audited) — never logged, never in the audit trail.
  - **Audit log** (append-only): every family/student/guardian create, update, withdraw and
    PIN regeneration records who/when/what — with PIN values and secrets excluded.
  - **Admin directory UI**: families as cards → family record with a students table (PIN,
    New-PIN, withdraw/reinstate), guardians (with emergency flag), and emergency contacts —
    the first admin dashboard, over the family scene. i18n en/ar/ur, RTL, dark/light.
- **Role walls enforced + tested** (§5): writes are admin-only; the directory + student
  records are admin **or** finance; teachers and parents have no access yet (their scoped
  reads land with classes/portal); admin remains LAN-only. 8 new tests (46 total) cover PIN
  uniqueness/regeneration, the create/withdraw/link flows, the role×origin walls, and that
  the PIN never reaches the audit detail.

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
