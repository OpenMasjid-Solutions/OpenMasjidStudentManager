CREATE TABLE `report_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`term_id` text NOT NULL,
	`version` integer NOT NULL,
	`pdf_path` text NOT NULL,
	`generated_by_user_id` text,
	`generated_by_name` text,
	`generated_at` integer NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `report_cards_student_class_idx` ON `report_cards` (`student_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `report_cards_class_idx` ON `report_cards` (`class_id`);