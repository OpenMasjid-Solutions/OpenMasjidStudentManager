CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`room` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `class_sessions_class_idx` ON `class_sessions` (`class_id`);--> statement-breakpoint
CREATE INDEX `class_sessions_day_idx` ON `class_sessions` (`day_of_week`);