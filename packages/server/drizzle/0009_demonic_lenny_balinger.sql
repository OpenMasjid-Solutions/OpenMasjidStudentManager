CREATE TABLE `exam_class_subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_class_id` text NOT NULL,
	`name` text NOT NULL,
	`max_marks` integer DEFAULT 100 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exam_class_id`) REFERENCES `exam_classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exam_class_subjects_idx` ON `exam_class_subjects` (`exam_class_id`);--> statement-breakpoint
CREATE TABLE `exam_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`class_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `exam_classes_exam_idx` ON `exam_classes` (`exam_id`);--> statement-breakpoint
CREATE INDEX `exam_classes_class_idx` ON `exam_classes` (`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_classes_uq` ON `exam_classes` (`exam_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `exam_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text NOT NULL,
	`value` integer,
	`marked_by_user_id` text,
	`marked_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`exam_class_id`) REFERENCES `exam_classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_id`) REFERENCES `exam_class_subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exam_scores_ec_idx` ON `exam_scores` (`exam_class_id`);--> statement-breakpoint
CREATE INDEX `exam_scores_student_idx` ON `exam_scores` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_scores_uq` ON `exam_scores` (`exam_class_id`,`student_id`,`subject_id`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `exams_term_idx` ON `exams` (`term_id`);--> statement-breakpoint
CREATE TABLE `term_remarks` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`term_id` text NOT NULL,
	`student_id` text NOT NULL,
	`remark` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `term_remarks_class_idx` ON `term_remarks` (`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `term_remarks_uq` ON `term_remarks` (`class_id`,`student_id`);