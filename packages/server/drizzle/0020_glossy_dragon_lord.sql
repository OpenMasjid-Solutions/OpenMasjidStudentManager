-- Tuition/fee pivot, step 1 of 2: create the per-student fee table and BACKFILL it from the
-- old per-enrollment assignments BEFORE the SIS teardown (step 2, migration 0021) drops
-- enrollment_fees + enrollments. On a fresh install these are empty, so the backfill is a
-- no-op; on an upgrade it preserves every fee assignment (money side unchanged).
CREATE TABLE `student_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`fee_plan_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fee_plan_id`) REFERENCES `fee_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `student_fees_student_idx` ON `student_fees` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_fees_uq` ON `student_fees` (`student_id`,`fee_plan_id`);--> statement-breakpoint
-- Backfill: each old (enrollment → student) × fee plan becomes a (student × fee plan) assignment.
-- OR IGNORE dedupes when a student carried the same plan on two enrollments (UNIQUE student+plan).
INSERT OR IGNORE INTO `student_fees` (`id`, `student_id`, `fee_plan_id`, `created_at`)
	SELECT 'stf_' || ef.`id`, e.`student_id`, ef.`fee_plan_id`, ef.`created_at`
	FROM `enrollment_fees` ef
	JOIN `enrollments` e ON e.`id` = ef.`enrollment_id`;
