CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`action_taken` text,
	`visible_to_parents` integer DEFAULT false NOT NULL,
	`recorded_by_user_id` text,
	`recorded_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `incidents_student_idx` ON `incidents` (`student_id`);--> statement-breakpoint
CREATE TABLE `student_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`options` text,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `student_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`def_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`def_id`) REFERENCES `student_field_defs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sfv_student_idx` ON `student_field_values` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_field_values_uq` ON `student_field_values` (`student_id`,`def_id`);--> statement-breakpoint
CREATE TABLE `student_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `student_notes_student_idx` ON `student_notes` (`student_id`);