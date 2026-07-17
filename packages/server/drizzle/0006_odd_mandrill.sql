CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`marked_by_user_id` text,
	`marked_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `attendance_class_date_idx` ON `attendance` (`class_id`,`date`);--> statement-breakpoint
CREATE INDEX `attendance_student_idx` ON `attendance` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_uq` ON `attendance` (`student_id`,`class_id`,`date`);