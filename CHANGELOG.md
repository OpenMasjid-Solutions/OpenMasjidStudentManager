<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Changelog

All notable changes to **OpenMasjid Students** are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). `1.0.0` is reserved for launch.

## [Unreleased]

## [0.22.0]

### Added
- **Report Creator** (§4/§5/§14) — the office's own saved-report builder over **code-defined
  datasets, never raw SQL**. Pick a dataset (Student directory, Invoices, Payments, Admissions),
  choose columns, add filters and a sort, and **Run** → an on-screen table, **CSV export**
  (formula-injection-escaped), and print. Datasets are **role-scoped at the registry**: admin sees
  all; **finance sees billing + directory datasets only**; teachers/parents get no Report Creator.
  Every run re-checks the dataset's minimum role, and user picks (columns/filters/sort) are validated
  against the registry and applied in memory — unknown keys are dropped, never interpolated into SQL.
  Available to admin and finance in their docks. i18n en/ar/ur. 6 tests (170 total) incl. the
  no-injection guarantee and role walls; browser-verified build → run → table → CSV.

### Fixed (from an adversarial review of the slice)
- Report **filters are now type-aware**: a money column (stored in cents, shown as dollars) filtered
  with "50" / "50.00" now matches the $50.00 rows (equals parses dollars; contains matches the
  formatted value), instead of comparing against raw cents. 1 more test (171 total).

## [0.21.0]

### Added
- **Public admissions form** (§4/§14) — a families' **enquiry form served over the tunnel with no
  login** at `/apply`: guardian name + contact, child name + DOB, and program interest. It's the
  app's most hostile surface, so it's locked down: strict zod with hard length caps (oversized input
  rejected generically — no field or data leak), a **honeypot** field (bots that fill it get a
  success response but nothing is stored), **per-IP burst + daily rate limits** keyed on the real
  client IP, no file uploads, and submissions stored as **inert** data that can only ever create one
  `enquiry` row (never pre-enrolled). New public submissions land in the staff pipeline flagged
  "from website." i18n en/ar/ur. 5 hostile-input tests (162 total); browser-verified end to end.

### Fixed (from an adversarial review of the slice)
- The in-process rate-limiter maps are now **hard-bounded** (evict oldest-first) instead of only
  pruning expired entries above a soft threshold — so a distributed flood (or IPv6-prefix rotation)
  of distinct IPs can't grow the map unbounded or force an O(n) scan on every request. Removes the
  per-request full-scan hot path entirely; applied to both the login and submission limiters. 2 more
  tests (164 total).

## [0.20.0]

### Added
- **Admissions pipeline + one-click enroll** (§4/§5), staff-facing. Admin and finance run the
  pipeline — **enquiry → application → accepted / waitlisted / declined → enrolled** — add applicants,
  move stages, and keep per-applicant notes. **One-click enroll** creates the family + student (with
  an auto PIN) + guardian (linked) + class enrollment, optionally assigns a fee plan and generates
  the first invoice, and flips the applicant to *enrolled* — all in one atomic transaction. Admin
  gets an **Admissions** dock section; finance's app now has Billing **and** Admissions. `enrolled`
  is reachable only via enroll (never a manual stage move); applicant data is stored inert and
  rendered as text only (the anonymous public /apply form lands next). i18n en/ar/ur. 5 new tests
  (157 total); browser-verified the pipeline and enroll.

### Fixed (from an adversarial review of the slice)
- One-click enroll now **audits the enrollment before** the (post-transaction) first-invoice step,
  and treats an invoice failure as **non-fatal** — the enroll always succeeds and is recorded, and
  the UI says "generate the first invoice in Billing" instead of erroring and wedging a retry.
- Enroll **refuses an archived fee plan** up front (it would otherwise create an enrollment fee that
  silently never invoices).

## [0.19.0]

### Added
- **Each child's weekly schedule in the parent portal** (§4/§15) — the child page now opens with a
  week-at-a-glance timetable (day cards with time, class, type, and room) built from the class
  sessions across all the child's enrolled classes. New parent-scoped `portal.childSchedule` (gated
  by `assertStudentAccess` — own kids only), rendering through the shared `WeekGrid` so it matches
  the staff timetable and collapses cleanly to one column on a phone. i18n en/ar/ur. 1 new test
  (152 total); browser-verified. This completes the parent portal's read surface (schedule, grades,
  attendance, merit, report cards & transcripts, balance & payments). A clean adversarial review
  found nothing.

## [0.18.0]

### Added
- **Per-child academics in the parent portal** (§4/§5/§15) — tapping a child on the family home opens
  a phone-first page with their **grades** (gradebook items + the child's score, by class), an
  **attendance** summary (present / late / excused / absent tallies + recent records) and **merit
  points** (running total + award history). New parent-scoped `portal.childGrades` / `childAttendance`
  / `childMerit`, each gated by `assertStudentAccess` — a parent can read only their own kids, never
  another family's (enforced in the query, not the UI). i18n en/ar/ur. 1 new test (151 total) plus the
  scoping wall; browser-verified end to end.

### Fixed (from an adversarial review of the slice)
- The child page now distinguishes **loading and errors from a genuinely empty record** — a transient
  failure no longer tells a parent their child has "No grades yet." (mirrors the family-home guard).

## [0.17.0]

### Added
- **Report cards & transcripts in the parent portal** (§4/§5/§14) — the documents families keep,
  now in the portal. Parents see and **download their own kids' PUBLISHED report cards** (the latest
  published version per class) **and transcripts**, right on the My-Family home. The PDFs are served
  only through the authed route, which now also honors the **parent** role: a parent may fetch an
  artifact **only when it is published AND belongs to one of their kids** — never another family's,
  never an unpublished draft (admin/assigned-teacher access and the finance/staff walls are
  unchanged). New `portal.myReports` (published-only, own-kids-only, scoped in the query). i18n
  en/ar/ur. 2 new tests (150 total); browser-verified own published card → 200, unpublished → 403.

### Fixed (from an adversarial review of the slice)
- The report-card, transcript, and combined-class PDF responses now send **`Cache-Control:
  no-store`**, matching the family-statement route — so a minor's academic PDF opened over the
  tunnel on a shared device isn't left in the browser cache after the session ends.

## [0.16.0]

### Added
- **Parent portal — the door + My-Family home** (§4/§5/§12/§14), the read-only first slice of the
  headline feature. Finance/admin **invite a guardian to the portal** (one-time CSPRNG link, stored
  SHA-256-hashed, single-use, 7-day expiry — emailed once SMTP lands; for now the office copies the
  link). The guardian **accepts the invite** on an anonymous page (reachable over the Cloudflare
  tunnel), sets a password → a `parent` account + `guardian_users` link are created and they're
  signed in. The **phone-first portal** shows their **own family only** — kids (with PINs), the
  family balance, open invoices, and the unified payment history. Parents work LAN **and** tunnel;
  scoping is enforced in every query (via `guardian_users`), never the UI — a parent can't reach
  another family or any staff data. `parent`-role wall, per-IP rate-limit on invite acceptance, and
  an in-transaction single-use guard. i18n en/ar/ur. Grades / schedule / merit / attendance /
  report cards, and self-registration (needs SMTP), arrive in later slices. 11 new tests (148 total).

### Fixed (from an adversarial review of the slice)
- **Parent login is now case-insensitive.** Accounts store the guardian email lowercased, but the
  login lookup matched case-sensitively — so a parent whose email had any capital (or whose phone
  keyboard auto-capitalized) was locked out. Lookup now compares on `lower()`, existing mixed-case
  admin/staff logins still work, and the login field disables auto-capitalize/correct.
- **Long emails no longer break login** — the login username cap now fits a full email address.
- **The portal home distinguishes a load error from “no family”** — a transient failure no longer
  tells a parent to call the office.

## [0.15.0]

### Added
- **Printable family statements** (§4/§14) — a self-contained, print-CSS HTML sheet finance/admin
  hand to a family. It shows the family balance, open invoices (oldest-due-first), recent payments,
  **each child's PIN**, the "pay with your child's name + PIN at the donation site or kiosk" line,
  and a **QR code to the parent-portal signup** (points at the tunnel public URL when set, else the
  LAN address the request came in on). A "Print statement" button opens it from the family billing
  window; a Print button in the sheet is hidden in the print stylesheet, and the layout is neutral
  ink so it photocopies cleanly in black-and-white. Served by an authed route that re-checks the
  role × origin matrix on every fetch — **admin (LAN only) and finance (LAN + tunnel) only; teacher
  and parent never** — with `Cache-Control: no-store` and never on a public static mount (it embeds
  minors' PINs, §14). Every embedded value (school/family/student names, memos, labels) is
  HTML-escaped. Student PIN generate/regenerate/view already shipped (people router + Family detail);
  per-PIN lookup lockout lands with the Fabric lookup endpoint it protects. 6 new tests (137 total).

### Fixed (from an adversarial review of the slice)
- Open invoices on the statement now sort **oldest-due-first with undated invoices last**, matching
  the ledger's allocation order (SQLite sorts NULL first under a bare `ASC`, which would otherwise
  float an undated invoice to the top of the printed sheet).

## [0.14.0]

### Added
- **Billing core** (§4/§5/§9/§16) — the money side, ours end to end. **Fee plans** (amount in
  integer cents, cadence monthly/per-term/one-time) assignable per enrollment; a per-family
  **discount** (fixed or percent). **Invoice generation** — per family or per period, idempotent on
  family+period, one negative line for the discount, skips families with no fees. The **ledger** is
  the single money-write path (`billing/ledger.ts`): derived balances (never stored), payments are
  immutable (corrections are reversal rows), allocation is oldest-due-first with surplus → family
  credit, and every write is idempotent on its key. **Manual payments** (cash/Zelle/check/other)
  with reverse; **void** an unpaid invoice. Admin + finance only — finance works LAN **and** over
  the tunnel; admin stays LAN-only (origin policy). New **finance role app** (Billing-only shell), a
  **Billing** section in admin (fee plans, period generation, families-with-balances overview), and
  a per-family billing window (balance, fee assignment, invoices, payment entry, ledger, discount).
  i18n en/ar/ur. 10 new tests (131 total).

### Fixed (from an adversarial review of the money layer)
- **Oldest-due-first no longer skips dated invoices.** SQLite sorts `NULL` before any value, so an
  undated invoice would jump ahead of a genuinely-due one and absorb a payment first — leaving the
  real bill open. Undated invoices now sort **last** in auto-allocation.
- **Explicit allocations can't overpay a bill.** The Fabric/webhook allocation path now rejects an
  allocation that exceeds an invoice's remaining balance, one whose total exceeds the payment
  amount, or one against a voided invoice — no more negative credit or `paid > total`.
- **Voiding a paid invoice is refused server-side.** Voiding dropped the invoice from the invoiced
  total while its payment stayed counted, understating the family balance; the server now returns a
  friendly conflict and asks you to reverse the payment first (the UI already discouraged it).
- **The family-discount form now shows the current discount** instead of silently defaulting to
  "None" (which could overwrite a saved discount on an unrelated save).

## [0.13.0]

### Added
- **Comment bank** (§4/§5) — reusable remark snippets to speed up term-end writing. A **shared**
  bank the office manages (admin) plus each teacher's **personal** bank; both are **inserted into
  the term-remark field** from an "Insert snippet…" picker in the exam panel. Teachers read shared
  + their own and manage only their own; admin manages the shared bank in **Settings → Comment
  bank**; finance/parent never see it. 4 new tests (113 total).

### Fixed (from an adversarial review of the slice)
- The term-remark field now only saves on blur when it was actually **edited**, so blurring an
  untouched field can't overwrite a co-teacher's meanwhile-saved remark (a last-write-wins
  regression the controlled-draft change would otherwise have introduced).

## [0.12.0]

### Added
- **Term close → finals → transcripts** (§4/§9/§16) — the term-end machine. Closing a term
  **freezes** each active enrollment's final grade into `term_finals` (recomputed on every close,
  UNIQUE per student+class); reopening lets the office fix something and re-close. The final-grade
  math now lives in ONE place (`grades/final.ts` `computeFinal`) shared by term close **and** the
  report card's overall, so they can never diverge. **Transcripts** — a student's cumulative,
  multi-year record built ONLY from the frozen finals (every term, every class with type, the
  final % + scale band) — render on the same @react-pdf pipeline as report cards: immutable,
  versioned, with a frozen data snapshot, served through the authed route (admin-LAN-only for now).
  Admin UI: **Close/Reopen term** in Classes and a **Transcript** panel (generate/download/publish)
  on the student record. 7 new tests (109 total).

### Fixed (from an adversarial review of the slice)
- **A closed term now locks its exam marks** — edits are refused until the term is reopened, so a
  frozen final can never silently diverge from the marks.
- **Re-closing a term reconciles its finals** — a since-withdrawn or mistaken enrollment's stale
  final is dropped (no orphan rows on the transcript), and classes archived after they finished
  still get their finals.
- **Transcripts order terms by start date** (then creation), so backfilled historical terms sit in
  the right place. Closed terms are now marked in the term list.

## [0.11.0]

### Added
- **Report cards** (§4/§9/§14) — the artifact families keep. The admin generates a dignified
  **PDF report card** per student (or the whole class), rendered server-side with @react-pdf
  (Pi-friendly, no headless browser) using a bundled Amiri font so Arabic names/subjects shape
  correctly. Each card carries the school name, term, class + type, a **per-subject marks matrix
  across the term's exams**, totals + percentage + the class's **scale band**, an attendance
  summary, an optional **merit total** (admin toggle), and the teacher's remark. Cards are
  **immutable, versioned artifacts** filed on the record — regenerating after a fix creates
  version N+1; a **combined class PDF** (a page per student) prints the filed versions.
  A **publish** flag (per class) is set now for the parent portal that follows. PDFs are served
  ONLY through an **authed route** that re-checks the role × origin matrix on every fetch (admin
  LAN-only, the assigned teacher for their class; finance never; parents with the portal) — never
  a guessable URL, never a public mount. New admin **School** settings (name, currency, merit
  toggle). 7 new tests (103 total).

### Fixed (from an adversarial review of the slice)
- **Concurrent regeneration can no longer collide on a version** — the next version is reserved
  in a synchronous transaction, backed by a UNIQUE(student, class, version) constraint.
- The **combined class PDF now reproduces the filed versions exactly** (a frozen data snapshot on
  each card) instead of re-aggregating live data, and skips students with no generated card.
- The **scale band is computed from the exact ratio**, so a score just under a cutoff isn't
  promoted a band by display rounding.
- Duplicate subject names in a class are rejected (they would collide on the report card);
  generating for a non-enrolled student returns a friendly error; the School settings form no
  longer risks saving stale defaults before it loads.

## [0.10.0]

### Added
- **Exams** (§4/§5/§9) — the first half of the term-end machine. The admin defines a term's
  exams (e.g. Mid-Term, Final) and **assigns each to classes**; assigning **snapshots** the
  class's subjects into the exam with an editable per-subject **max mark** (default 100), so
  later edits to the class's subjects never corrupt a past exam. Teachers (and admin) fill a
  students × subjects **score grid** — a mark, or an explicit **absent** / **exempt** (a blank
  means "not entered", which blocks completion) — plus an optional per-student **term remark**,
  with a live **progress bar**. The admin gets a **completion dashboard** (scored-vs-enrolled
  per class). Definitions/assignment are admin-only; score entry is admin or the assigned
  teacher (scoped via `classAccess`); finance/parent are refused; admin stays LAN-only. Lowering
  a subject's max below an already-entered mark is rejected; score writes are audited without
  per-student PII. New **Exams** admin section + an **Exams** panel in every class window.
  5 new tests (96 total).

### Notes
- Report-card PDFs, term close/finals, transcripts and the comment bank build on this in the
  next slices. Reviewed solo this release (the shared session limit was active); the access
  walls reuse the pattern already hardened by the 0.7.0/0.8.0 adversarial reviews.

## [0.9.0]

### Added
- **Merit points** (§4/§5) — very madrasa: teachers (and admin) **award or deduct** points to
  students in their own classes against **admin-defined categories with default point values**.
  Ships four editable defaults — **Ādāb, Sunnah practice, Hifz milestone, Helping others** —
  seeded on first boot. A `MeritPanel` in the class window has the award form (category picks a
  default, adjustable, negative allowed), a staff-side **leaderboard** of term totals, and the
  recent awards with a one-tap **undo**; admin manages categories in **Settings → Merit categories**.
  Teacher access is scoped to their own classes (via `classAccess`); finance never sees merit;
  parents see their own kids in the portal (later). Awards are audited with no per-student PII.
  5 new tests (91 total).

## [0.8.0]

### Added
- **Gradebook** (§4/§5/§9): assignments (grade items — title, out-of, optional category) and
  student scores per class, from the class window. A spreadsheet-style grid (assignments ×
  students) with per-cell save, a per-student **overall %** (total-points weighted) and its
  **scale band**, plus a per-assignment class average. Only enrolled students can be scored;
  scores are stored as integer hundredths of a point (no float drift). Admin **or** the assigned
  teacher can grade (scoped via `classAccess`); finance/parent are refused; admin stays LAN-only.
  Sensitive writes are audited with no per-student PII.
- **Grading scales** (§4): admin-defined scales (band label + min %). Ships three editable
  defaults — **Percentage**, **A–F**, and a madrasa scale **Mumtāz / Jayyid Jiddan / Jayyid /
  Maqbūl / Rāsib** — seeded on first boot. Each class picks its scale (admin sets it; teachers
  see it read-only). 8 new tests (86 total).

### Fixed (from an adversarial review of the slice)
- **`itemUpdate` can no longer lower an assignment's maximum below an already-entered score**
  (which would push a student over 100% and skew the band) — it's rejected with a friendly message.
- **Score-save errors are surfaced** to the teacher (over-max, etc.) instead of being silently
  swallowed, with an instant client-side over-max hint.
- **`scaleArchive`** now returns a clean *not found* (and writes no phantom audit entry) for a
  missing scale, matching its sibling mutations.
- A failed gradebook load now shows a friendly error with **Try again** instead of a stuck
  "Loading…"; deleting an assignment (which removes its scores) now **asks for confirmation**.

## [0.7.0]

### Added
- **Attendance** (§4/§5/§9): a teacher (or admin) marks a class's roster for a day —
  **present / late / absent / excused** with a bulk **All present** — from the class window.
  One row per (student, class, date), UNIQUE, so a save is an upsert. Only actively-enrolled
  students can be marked. **Same-day marking is routine; later edits and past-date (backfill)
  marks are audited** (who last marked is always stored), with **no PII in the audit detail**
  (counts + date only). Teacher access is scoped to their own classes (the wall is in the
  `classAccess` guard, not the UI); finance/parent are refused; admin stays LAN-only. A shared
  `AttendancePanel` (phone-friendly, semantic status colours, RTL-safe) serves both the teacher
  and admin class windows. 9 new tests (78 total).

### Fixed (from an adversarial review of the slice)
- **Timezone-safe backfill detection**: the client sends its local day so a routine evening
  mark isn't mislabelled a backfill across a UTC-container midnight (previously the audit could
  wrongly log `lateMark`, or miss a genuine backfill).
- **Duplicate student in one submission** is now rejected at the input boundary with a friendly
  error instead of surfacing a raw SQLite UNIQUE-constraint error.
- **AttendancePanel**: the "Saved" confirmation no longer gets wiped by the post-save refetch,
  and changing the date with unsaved marks now asks before discarding them.

## [0.6.0]

### Added
- **Weekly timetable** (§4): recurring class sessions (day + start/end + room), edited per class
  from the class window. **Soft double-booking warnings** — a shared teacher or a shared room at
  an overlapping time (same term + weekday) — that surface inline but **never block** (a madrasa
  reality is one ustādh covering two rooms). A new **Timetable** section views the week **by class,
  by teacher, or by student**, with a print-clean handout (black-on-white for a masjid photocopier).
- **Teacher app** (§5/§15): teachers now sign in to their own desktop shell (same dock + windows
  as admin) with **My week** (their scheduled sessions) and **My classes** (open a class read-only:
  schedule, subjects, co-teachers, roster). **Teacher scoping is enforced server-side** — a teacher
  sees only their assigned classes/students and cannot open another teacher's class (403), tested;
  teachers never see PINs, notes, incidents or money. Teachers work on the LAN **and** over the
  Cloudflare tunnel; admin stays LAN-only.
- 9 new tests (69 total): session CRUD + end-before-start guard, conflict detection (teacher/room,
  cross-term isolation), by-teacher/by-student views, and the teacher wall (mine/mineGet scoping,
  `mySchedule` isolation over the tunnel, non-admin/tunnel-admin refusals).

### Fixed
- **Light-theme legibility on the shell**: the desktop wallpaper is dark in *both* themes, so
  on-scene chrome (brand, clock, page titles, empty states) now uses a dedicated light on-scene
  token in both themes instead of the theme's ink — glass panels re-assert adaptive ink so their
  content stays readable in light mode. (Dark theme is visually unchanged.)

## [0.5.1]

### Fixed
- Top-bar chrome now matches the sibling **apps** (Kiosk / Donations / Display), not the
  OpenMasjidOS platform dashboard: a plain `.topclock` (time over a muted date, no glass
  box) and a subtle cyan-ring profile button, replacing the OS's boxed `.clock-widget` +
  filled avatar (§15 — copy the apps, not the platform). Added on-scene text legibility.

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
