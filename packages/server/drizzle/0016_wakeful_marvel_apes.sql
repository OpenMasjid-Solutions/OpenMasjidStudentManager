CREATE TABLE `admission_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_id` text NOT NULL,
	`note` text NOT NULL,
	`by_user_id` text,
	`by_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'enquiry' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`guardian_name` text NOT NULL,
	`guardian_phone` text,
	`guardian_email` text,
	`child_first_name` text NOT NULL,
	`child_last_name` text NOT NULL,
	`child_dob` text,
	`program_interest` text,
	`fields_json` text,
	`created_family_id` text,
	`created_student_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admissions_status_idx` ON `admissions` (`status`);--> statement-breakpoint
CREATE INDEX `admissions_at_idx` ON `admissions` (`created_at`);