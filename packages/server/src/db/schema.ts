// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Drizzle schema (SQLite). Grows one vertical slice at a time (CLAUDE.md §9, §20).
 * Rules that apply as tables land: money in integer cents; balances derived, never
 * stored; payments/report-cards/transcripts immutable + versioned; FKs RESTRICT on
 * money paths; every table has id/created_at/updated_at. Migrations are forward-only
 * and generated into ./drizzle.
 *
 * Slice 1: `settings`.  Slice 2 (auth): `users`, `sessions`.
 * Slice 3 (People & SIS): `families`, `students`, `guardians`, `guardian_families`,
 *   `guardian_users`, `emergency_contacts`, `audit_log`.
 */
import { sqliteTable, text, integer, primaryKey, index, unique } from 'drizzle-orm/sqlite-core';

/** The four roles (CLAUDE.md §5). Student logins are 🔭 deferred. */
export type Role = 'admin' | 'teacher' | 'finance' | 'parent';

/** App-owned settings (SMTP, Stripe choice, policies, etc. — added over time).
 *  This is NOT a masjid profile; each app owns its own config (org rule). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Setting = typeof settings.$inferSelect;

/** Local accounts. Password is argon2id (auth/passwords.ts) — never plaintext, and
 *  never logged. Staff/parent creation comes in later slices; slice 2 is first-run
 *  admin + login + sessions. Soft-disable via `status`, never hard-delete money/grade
 *  references (CLAUDE.md §9). */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  displayName: text('display_name'),
  /** Staff contact + admin-only notes (§4 staff profiles). */
  phone: text('phone'),
  staffNotes: text('staff_notes'),
  /** Staff are forced to set a new password on first login (CLAUDE.md §12). */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type User = typeof users.$inferSelect;

/** Server-side sessions. The cookie holds an opaque random token; we store only its
 *  SHA-256 (`tokenHash`) so a leaked DB row can't be replayed as a cookie. `source`
 *  distinguishes a local password login from an OpenMasjidOS SSO-minted admin session
 *  (which has no local user row) — see trpc/auth.ts + fabric/platform.ts. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<Role>().notNull(),
  source: text('source').$type<'local' | 'sso'>().notNull(),
  /** Display-only username (untrusted for SSO — CLAUDE.md §12). */
  username: text('username'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Session = typeof sessions.$inferSelect;

// ── People & SIS (slice 3) ───────────────────────────────────────────────────

/** A family groups students and links to guardians. Archived, never hard-deleted
 *  (money/records reference it). `name` is the display label (e.g. "Ismail family"). */
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes'),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Family = typeof families.$inferSelect;

/** A student. The PIN is a low-entropy capability token (6-digit CSPRNG, UNIQUE per
 *  install) used for name+PIN lookup at the Donations site / Kiosk and one door into
 *  portal self-registration — it is RETRIEVABLE (printed on statements), so it is stored
 *  in the clear and the DB file itself is a secret (§9/§14). Never logged / never in URLs.
 *  Withdrawn via `status`, never hard-deleted. FK to family is RESTRICT (archive, don't
 *  delete, a family with students). */
export const students = sqliteTable(
  'students',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: text('dob'), // optional ISO date (YYYY-MM-DD); minimal by design (§14)
    status: text('status').$type<'active' | 'withdrawn'>().notNull().default('active'),
    notes: text('notes'),
    pin: text('pin').notNull(),
    pinUpdatedAt: integer('pin_updated_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pinUq: unique('students_pin_uq').on(t.pin), // the unique lookup index (§11.2)
    familyIdx: index('students_family_idx').on(t.familyId),
  }),
);
export type Student = typeof students.$inferSelect;

/** A guardian (name + contact). May span multiple families via guardian_families. */
export const guardians = sqliteTable('guardians', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Guardian = typeof guardians.$inferSelect;

/** guardian ↔ family link (many-to-many). `relation` is free text (father/mother/walī…).
 *  `isEmergencyContact` flags this guardian as an emergency contact for the family (§4). */
export const guardianFamilies = sqliteTable(
  'guardian_families',
  {
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    relation: text('relation'),
    isEmergencyContact: integer('is_emergency_contact', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guardianId, t.familyId] }) }),
);
export type GuardianFamily = typeof guardianFamilies.$inferSelect;

/** Links a guardian to a parent USER account — this is what gives a parent portal login
 *  its family scope (§9/§12). Populated when a parent accepts an invite / self-registers. */
export const guardianUsers = sqliteTable(
  'guardian_users',
  {
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guardianId, t.userId] }), userUq: unique('guardian_users_user_uq').on(t.userId) }),
);
export type GuardianUser = typeof guardianUsers.$inferSelect;

/** Extra emergency contacts per family (guardians can also be flagged, above). */
export const emergencyContacts = sqliteTable(
  'emergency_contacts',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    relation: text('relation'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ familyIdx: index('emergency_contacts_family_idx').on(t.familyId) }),
);
export type EmergencyContact = typeof emergencyContacts.$inferSelect;

/** Append-only audit trail for sensitive writes (§14). Actor is stored as plain fields
 *  (not an FK) so history survives user changes; SSO admins have no user row (id null). */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    actorName: text('actor_name'),
    action: text('action').notNull(), // e.g. 'student.pin.regenerate', 'family.create'
    entity: text('entity'), // e.g. 'student'
    entityId: text('entity_id'),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(), // small before/after; NEVER PINs/secrets
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ entityIdx: index('audit_entity_idx').on(t.entity, t.entityId), atIdx: index('audit_at_idx').on(t.createdAt) }),
);
export type AuditEntry = typeof auditLog.$inferSelect;

// ── Record extras (slice 4): custom fields, notes, incidents ─────────────────

export type CustomFieldType = 'text' | 'number' | 'date' | 'select';

/** Admin-defined custom field definitions applied to every student (§4). Soft-deleted
 *  (archivedAt) so historical values keep their meaning (§9). `options` is used by `select`. */
export const studentFieldDefs = sqliteTable('student_field_defs', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  type: text('type').$type<CustomFieldType>().notNull(),
  options: text('options', { mode: 'json' }).$type<string[]>(), // for `select`
  position: integer('position').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type StudentFieldDef = typeof studentFieldDefs.$inferSelect;

/** A custom-field value on one student. Stored as text; validated against the def's type
 *  on every write (§9). One value per (student, def). */
export const studentFieldValues = sqliteTable(
  'student_field_values',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    defId: text('def_id')
      .notNull()
      .references(() => studentFieldDefs.id, { onDelete: 'restrict' }),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ uq: unique('student_field_values_uq').on(t.studentId, t.defId), studentIdx: index('sfv_student_idx').on(t.studentId) }),
);
export type StudentFieldValue = typeof studentFieldValues.$inferSelect;

/** Running staff-only notes on a student (activity log) — append-only. Never visible to
 *  parents or finance (§5/§14). Author stored as plain fields (SSO admins have no row). */
export const studentNotes = sqliteTable(
  'student_notes',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    authorUserId: text('author_user_id'),
    authorName: text('author_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ studentIdx: index('student_notes_student_idx').on(t.studentId) }),
);
export type StudentNote = typeof studentNotes.$inferSelect;

/** Incident / disciplinary records. Staff-eyes-only by default: `visibleToParents`
 *  defaults OFF and only a per-incident opt-in ever reaches a parent (§4/§14). Finance
 *  never sees these. */
export const incidents = sqliteTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    date: text('date').notNull(), // ISO date (YYYY-MM-DD)
    category: text('category').notNull(),
    description: text('description').notNull(),
    actionTaken: text('action_taken'),
    visibleToParents: integer('visible_to_parents', { mode: 'boolean' }).notNull().default(false),
    recordedByUserId: text('recorded_by_user_id'),
    recordedByName: text('recorded_by_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ studentIdx: index('incidents_student_idx').on(t.studentId) }),
);
export type Incident = typeof incidents.$inferSelect;

// ── Classes & scheduling (slice 5) ───────────────────────────────────────────

export type ClassType = 'maktab' | 'hifz' | 'nazrah' | 'alim' | 'custom';

/** An academic term. `isCurrent` marks the one the admin is working in. `closedAt` freezes the
 *  term: closing computes per-class final grades into `term_finals`; reopening clears it so a fix
 *  can be made and the term re-closed (both audited — §4). */
export const terms = sqliteTable('terms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date'), // ISO date (optional)
  endDate: text('end_date'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type Term = typeof terms.$inferSelect;

/** A class the madrasa runs — free-text name + a `type` that drives filtering and
 *  report/transcript headers (custom carries its own label). Archived, not deleted. */
export const classes = sqliteTable(
  'classes',
  {
    id: text('id').primaryKey(),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: text('type').$type<ClassType>().notNull(),
    customLabel: text('custom_label'), // when type = custom
    scheduleLabel: text('schedule_label'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ termIdx: index('classes_term_idx').on(t.termId) }),
);
export type Class = typeof classes.$inferSelect;

/** Ordered, free-text subjects for a class (e.g. hifz: Sabaq / Sabqī / Manzil / Tajwīd). */
export const classSubjects = sqliteTable(
  'class_subjects',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ classIdx: index('class_subjects_class_idx').on(t.classId) }),
);
export type ClassSubject = typeof classSubjects.$inferSelect;

/** Teacher assignment: a class can have several teachers; a teacher several classes.
 *  References a user with role `teacher` (or admin). This is what scopes a teacher to
 *  "their" classes/students (§5) once teacher reads land. */
export const classTeachers = sqliteTable(
  'class_teachers',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.classId, t.userId] }), userIdx: index('class_teachers_user_idx').on(t.userId) }),
);
export type ClassTeacher = typeof classTeachers.$inferSelect;

/** A weekly, recurring timetable session for a class (§4). `dayOfWeek` is 0=Sunday…6=Saturday;
 *  `startMin`/`endMin` are minutes from midnight (0–1439) so overlaps are plain integer math and
 *  the grid is locale-agnostic (formatting happens in the UI). `room` is a free-text label.
 *  Manual only in v1 — no auto-scheduler; double-bookings warn (soft), never block. */
export const classSessions = sqliteTable(
  'class_sessions',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sun … 6=Sat
    startMin: integer('start_min').notNull(), // minutes from midnight
    endMin: integer('end_min').notNull(),
    room: text('room'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ classIdx: index('class_sessions_class_idx').on(t.classId), dayIdx: index('class_sessions_day_idx').on(t.dayOfWeek) }),
);
export type ClassSession = typeof classSessions.$inferSelect;

/** Student ↔ class enrollment (per term, via the class's term). One row per pair. */
export const enrollments = sqliteTable(
  'enrollments',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    status: text('status').$type<'active' | 'withdrawn'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    uq: unique('enrollments_uq').on(t.classId, t.studentId),
    classIdx: index('enrollments_class_idx').on(t.classId),
    studentIdx: index('enrollments_student_idx').on(t.studentId),
  }),
);
export type Enrollment = typeof enrollments.$inferSelect;

// ── Attendance (slice: teacher tools) ────────────────────────────────────────

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

/** Daily attendance per (student, class, date) — UNIQUE, so marking is an upsert (§9).
 *  `status` is an explicit state (never a blank). Same-day marking is normal; later edits are
 *  allowed but AUDITED (§4) — the handler records who last marked and audits edits/backfills.
 *  `note` is an optional short reason (e.g. for `excused`). FKs RESTRICT: classes/students are
 *  archived/withdrawn, never hard-deleted, so attendance history is never orphaned. */
export const attendance = sqliteTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    date: text('date').notNull(), // ISO date (YYYY-MM-DD)
    status: text('status').$type<AttendanceStatus>().notNull(),
    note: text('note'),
    markedByUserId: text('marked_by_user_id'),
    markedByName: text('marked_by_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    uq: unique('attendance_uq').on(t.studentId, t.classId, t.date),
    classDateIdx: index('attendance_class_date_idx').on(t.classId, t.date),
    studentIdx: index('attendance_student_idx').on(t.studentId),
  }),
);
export type Attendance = typeof attendance.$inferSelect;

// ── Gradebook (slice: teacher tools) ─────────────────────────────────────────

/** An admin-defined grading scale (§4): a set of bands (label + min %). Ships with three
 *  editable defaults — Percentage, A–F, and a madrasa scale (Mumtāz … Rāsib) — seeded on
 *  first boot. Soft-archived so a class that still points at it keeps meaning. */
export const gradingScales = sqliteTable('grading_scales', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Marks a shipped default (still fully editable). */
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type GradingScale = typeof gradingScales.$inferSelect;

/** A band within a scale: a label shown for any percentage >= minPercent (§4). */
export const scaleBands = sqliteTable(
  'scale_bands',
  {
    id: text('id').primaryKey(),
    scaleId: text('scale_id')
      .notNull()
      .references(() => gradingScales.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    minPercent: integer('min_percent').notNull(), // 0–100
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ scaleIdx: index('scale_bands_scale_idx').on(t.scaleId) }),
);
export type ScaleBand = typeof scaleBands.$inferSelect;

/** Per-class grading config. v1: which scale the class uses (final-grade formula weights
 *  land in a later slice — this row already owns the class↔scale link). One row per class. */
export const classGradeConfig = sqliteTable(
  'class_grade_config',
  {
    classId: text('class_id')
      .primaryKey()
      .references(() => classes.id, { onDelete: 'cascade' }),
    scaleId: text('scale_id').references(() => gradingScales.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
);
export type ClassGradeConfig = typeof classGradeConfig.$inferSelect;

/** A gradebook assignment/assessment for a class (§4): title, date, max points, optional
 *  category. Scores live in `grades`. Deleting an item cascades its scores (a unit); an
 *  append-only snapshot history arrives in a later slice. FK to class is RESTRICT. */
export const gradeItems = sqliteTable(
  'grade_items',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    date: text('date'), // ISO date (optional)
    maxPoints: integer('max_points').notNull(), // > 0
    category: text('category'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ classIdx: index('grade_items_class_idx').on(t.classId) }),
);
export type GradeItem = typeof gradeItems.$inferSelect;

/** A student's score on one grade item. `points` is a number (decimals allowed, e.g. 8.5/10);
 *  no row = not yet graded. UNIQUE per (item, student) so a save is an upsert. Scores cascade
 *  if the item is deleted; student FK is RESTRICT (students are withdrawn, never hard-deleted). */
export const grades = sqliteTable(
  'grades',
  {
    id: text('id').primaryKey(),
    gradeItemId: text('grade_item_id')
      .notNull()
      .references(() => gradeItems.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(), // stored ×100 (two decimals) to avoid float drift
    markedByUserId: text('marked_by_user_id'),
    markedByName: text('marked_by_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    uq: unique('grades_uq').on(t.gradeItemId, t.studentId),
    itemIdx: index('grades_item_idx').on(t.gradeItemId),
    studentIdx: index('grades_student_idx').on(t.studentId),
  }),
);
export type Grade = typeof grades.$inferSelect;

// ── Merit points (slice: teacher tools) ──────────────────────────────────────

/** Admin-defined merit categories with a default point value (§4). Ships with editable
 *  defaults (Ādāb, Sunnah practice, Hifz milestone, Helping others). Soft-archived so past
 *  awards keep their meaning. */
export const meritCategories = sqliteTable('merit_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The default points suggested when awarding (may be adjusted per award). */
  defaultPoints: integer('default_points').notNull().default(0),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type MeritCategory = typeof meritCategories.$inferSelect;

/** A merit award (or deduction) to a student in a class context (§4/§5). `points` is signed
 *  (a deduction is negative). Append-only: corrections are a new award, never an edit. `termId`
 *  is denormalized from the class at award time so term totals are a simple sum. All FKs are
 *  RESTRICT (students/classes/categories are archived, never hard-deleted). */
export const meritAwards = sqliteTable(
  'merit_awards',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => meritCategories.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    note: text('note'),
    awardedByUserId: text('awarded_by_user_id'),
    awardedByName: text('awarded_by_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    studentIdx: index('merit_awards_student_idx').on(t.studentId),
    classIdx: index('merit_awards_class_idx').on(t.classId),
    termIdx: index('merit_awards_term_idx').on(t.termId),
  }),
);
export type MeritAward = typeof meritAwards.$inferSelect;

// ── Exams & report cards (slice: the term-end machine) ────────────────────────

export type ExamScoreStatus = 'scored' | 'absent' | 'exempt';

/** An exam the admin defines for a term (e.g. "Mid-Term", "Final"), then assigns to classes. */
export const exams = sqliteTable(
  'exams',
  {
    id: text('id').primaryKey(),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ termIdx: index('exams_term_idx').on(t.termId) }),
);
export type Exam = typeof exams.$inferSelect;

/** An exam assigned to a class. Creating this row SNAPSHOTS the class's subjects into
 *  exam_class_subjects (below) — so later edits to the class never corrupt a past exam (§9). */
export const examClasses = sqliteTable(
  'exam_classes',
  {
    id: text('id').primaryKey(),
    examId: text('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ uq: unique('exam_classes_uq').on(t.examId, t.classId), examIdx: index('exam_classes_exam_idx').on(t.examId), classIdx: index('exam_classes_class_idx').on(t.classId) }),
);
export type ExamClass = typeof examClasses.$inferSelect;

/** The frozen subject list for an exam-class: copied from class_subjects at assignment time,
 *  each with an editable per-subject max mark (default 100). Editing a class's live subjects
 *  never touches this (§9). */
export const examClassSubjects = sqliteTable(
  'exam_class_subjects',
  {
    id: text('id').primaryKey(),
    examClassId: text('exam_class_id')
      .notNull()
      .references(() => examClasses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    maxMarks: integer('max_marks').notNull().default(100),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ examClassIdx: index('exam_class_subjects_idx').on(t.examClassId) }),
);
export type ExamClassSubject = typeof examClassSubjects.$inferSelect;

/** One student's mark for one exam-class subject. `status` is explicit — `scored` (with a
 *  numeric `value`), `absent`, or `exempt`; NO row means "not yet entered" (a blank, which
 *  blocks completion — §9). UNIQUE per (exam-class, student, subject). */
export const examScores = sqliteTable(
  'exam_scores',
  {
    id: text('id').primaryKey(),
    examClassId: text('exam_class_id')
      .notNull()
      .references(() => examClasses.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => examClassSubjects.id, { onDelete: 'cascade' }),
    status: text('status').$type<ExamScoreStatus>().notNull(),
    value: integer('value'), // set only when status = 'scored'
    markedByUserId: text('marked_by_user_id'),
    markedByName: text('marked_by_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    uq: unique('exam_scores_uq').on(t.examClassId, t.studentId, t.subjectId),
    ecIdx: index('exam_scores_ec_idx').on(t.examClassId),
    studentIdx: index('exam_scores_student_idx').on(t.studentId),
  }),
);
export type ExamScore = typeof examScores.$inferSelect;

/** A teacher's per-student remark for a class's term (entered during exam score entry, shown on
 *  the report card). One per (class, student). */
export const termRemarks = sqliteTable(
  'term_remarks',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    remark: text('remark').notNull(),
    authorUserId: text('author_user_id'),
    authorName: text('author_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({ uq: unique('term_remarks_uq').on(t.classId, t.studentId), classIdx: index('term_remarks_class_idx').on(t.classId) }),
);
export type TermRemark = typeof termRemarks.$inferSelect;

/** An immutable, versioned report-card PDF for a student in a class+term (§4/§9). A row is
 *  never edited or deleted — regenerating after a fix inserts version N+1; publishing flips
 *  `publishedAt` only. The PDF lives under /data/reports with a randomized filename; it is
 *  served ONLY through the authed route that re-checks the role matrix (§14). */
export const reportCards = sqliteTable(
  'report_cards',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    pdfPath: text('pdf_path').notNull(), // filename under /data/reports (never a guessable URL)
    /** A frozen snapshot of the rendered data (ReportCardData) — so the combined class PDF
     *  reproduces the filed versions exactly instead of re-aggregating live data. */
    dataJson: text('data_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    generatedByUserId: text('generated_by_user_id'),
    generatedByName: text('generated_by_name'),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    scIdx: index('report_cards_student_class_idx').on(t.studentId, t.classId),
    classIdx: index('report_cards_class_idx').on(t.classId),
    // Immutable N+1 versioning: the DB rejects a duplicate version even under a concurrent race.
    versionUq: unique('report_cards_version_uq').on(t.studentId, t.classId, t.version),
  }),
);
export type ReportCard = typeof reportCards.$inferSelect;

/** A frozen final grade for a student in a class+term, computed at term close from the class's
 *  config (CLAUDE.md §4/§9). Transcripts read ONLY this — never live gradebooks. Recomputed
 *  (upserted) each time the term is closed; the value is stable while the term stays closed.
 *  `percentTenths` is percent×10 (integer — no float); null when there were no marks. */
export const termFinals = sqliteTable(
  'term_finals',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    termId: text('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    obtained: integer('obtained').notNull(),
    max: integer('max').notNull(),
    percentTenths: integer('percent_tenths'), // percent × 10; null when max = 0
    band: text('band'),
    scaleName: text('scale_name'),
    computedAt: integer('computed_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    uq: unique('term_finals_uq').on(t.studentId, t.classId),
    studentIdx: index('term_finals_student_idx').on(t.studentId),
    termIdx: index('term_finals_term_idx').on(t.termId),
  }),
);
export type TermFinal = typeof termFinals.$inferSelect;

/** A student's cumulative transcript — an immutable, versioned PDF built from `term_finals`
 *  across every term/class (§4/§9). Same pipeline + rules as report cards: regenerate → N+1,
 *  never edited/deleted; publish flips `publishedAt`; served only through the authed route. */
export const transcripts = sqliteTable(
  'transcripts',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    pdfPath: text('pdf_path').notNull(),
    dataJson: text('data_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    generatedByUserId: text('generated_by_user_id'),
    generatedByName: text('generated_by_name'),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    studentIdx: index('transcripts_student_idx').on(t.studentId),
    versionUq: unique('transcripts_version_uq').on(t.studentId, t.version),
  }),
);
export type Transcript = typeof transcripts.$inferSelect;
