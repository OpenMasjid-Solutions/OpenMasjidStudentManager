-- Tuition/fee pivot, step 2 of 2: remove all SIS/academic tables (this app is now tuition/fee
-- management only). Ordered children-before-parents so the drops are safe with foreign_keys=ON
-- even on a populated database (a RESTRICT child must be dropped before the table it references).
-- The per-student fees were already created + backfilled in 0020, before enrollment_fees/enrollments
-- go here.
DROP TABLE `admission_notes`;--> statement-breakpoint
DROP TABLE `exam_scores`;--> statement-breakpoint
DROP TABLE `exam_class_subjects`;--> statement-breakpoint
DROP TABLE `exam_classes`;--> statement-breakpoint
DROP TABLE `grades`;--> statement-breakpoint
DROP TABLE `grade_items`;--> statement-breakpoint
DROP TABLE `scale_bands`;--> statement-breakpoint
DROP TABLE `class_grade_config`;--> statement-breakpoint
DROP TABLE `merit_awards`;--> statement-breakpoint
DROP TABLE `term_finals`;--> statement-breakpoint
DROP TABLE `term_remarks`;--> statement-breakpoint
DROP TABLE `report_cards`;--> statement-breakpoint
DROP TABLE `attendance`;--> statement-breakpoint
DROP TABLE `enrollment_fees`;--> statement-breakpoint
DROP TABLE `enrollments`;--> statement-breakpoint
DROP TABLE `class_sessions`;--> statement-breakpoint
DROP TABLE `class_subjects`;--> statement-breakpoint
DROP TABLE `class_teachers`;--> statement-breakpoint
DROP TABLE `comment_snippets`;--> statement-breakpoint
DROP TABLE `student_field_values`;--> statement-breakpoint
DROP TABLE `student_notes`;--> statement-breakpoint
DROP TABLE `incidents`;--> statement-breakpoint
DROP TABLE `transcripts`;--> statement-breakpoint
DROP TABLE `exams`;--> statement-breakpoint
DROP TABLE `grading_scales`;--> statement-breakpoint
DROP TABLE `merit_categories`;--> statement-breakpoint
DROP TABLE `student_field_defs`;--> statement-breakpoint
DROP TABLE `classes`;--> statement-breakpoint
DROP TABLE `admissions`;--> statement-breakpoint
DROP TABLE `terms`;--> statement-breakpoint
-- The 'teacher' role was removed with the SIS. Kill any leftover teacher sessions and disable
-- any leftover teacher accounts so they can no longer authenticate (the Role type no longer
-- includes 'teacher', but the DB column is free text — scrub it here). admin/finance/parent kept.
DELETE FROM `sessions` WHERE `role` NOT IN ('admin', 'finance', 'parent');--> statement-breakpoint
UPDATE `users` SET `status` = 'disabled' WHERE `role` NOT IN ('admin', 'finance', 'parent');
