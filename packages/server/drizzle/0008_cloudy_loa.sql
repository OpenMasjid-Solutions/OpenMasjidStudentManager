CREATE TABLE `merit_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`term_id` text NOT NULL,
	`category_id` text NOT NULL,
	`points` integer NOT NULL,
	`note` text,
	`awarded_by_user_id` text,
	`awarded_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `merit_categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `merit_awards_student_idx` ON `merit_awards` (`student_id`);--> statement-breakpoint
CREATE INDEX `merit_awards_class_idx` ON `merit_awards` (`class_id`);--> statement-breakpoint
CREATE INDEX `merit_awards_term_idx` ON `merit_awards` (`term_id`);--> statement-breakpoint
CREATE TABLE `merit_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_points` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
