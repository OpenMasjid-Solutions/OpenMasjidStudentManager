CREATE TABLE `class_grade_config` (
	`class_id` text PRIMARY KEY NOT NULL,
	`scale_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scale_id`) REFERENCES `grading_scales`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `grade_items` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`max_points` integer NOT NULL,
	`category` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `grade_items_class_idx` ON `grade_items` (`class_id`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`grade_item_id` text NOT NULL,
	`student_id` text NOT NULL,
	`points` integer NOT NULL,
	`marked_by_user_id` text,
	`marked_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`grade_item_id`) REFERENCES `grade_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `grades_item_idx` ON `grades` (`grade_item_id`);--> statement-breakpoint
CREATE INDEX `grades_student_idx` ON `grades` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grades_uq` ON `grades` (`grade_item_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `grading_scales` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scale_bands` (
	`id` text PRIMARY KEY NOT NULL,
	`scale_id` text NOT NULL,
	`label` text NOT NULL,
	`min_percent` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scale_id`) REFERENCES `grading_scales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scale_bands_scale_idx` ON `scale_bands` (`scale_id`);