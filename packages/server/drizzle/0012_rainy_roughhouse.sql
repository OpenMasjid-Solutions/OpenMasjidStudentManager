CREATE TABLE `term_finals` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`term_id` text NOT NULL,
	`obtained` integer NOT NULL,
	`max` integer NOT NULL,
	`percent_tenths` integer,
	`band` text,
	`scale_name` text,
	`computed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `term_finals_student_idx` ON `term_finals` (`student_id`);--> statement-breakpoint
CREATE INDEX `term_finals_term_idx` ON `term_finals` (`term_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `term_finals_uq` ON `term_finals` (`student_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`version` integer NOT NULL,
	`pdf_path` text NOT NULL,
	`data_json` text,
	`generated_by_user_id` text,
	`generated_by_name` text,
	`generated_at` integer NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `transcripts_student_idx` ON `transcripts` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcripts_version_uq` ON `transcripts` (`student_id`,`version`);--> statement-breakpoint
ALTER TABLE `terms` ADD `closed_at` integer;