CREATE TABLE `enrollment_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`enrollment_id` text NOT NULL,
	`fee_plan_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fee_plan_id`) REFERENCES `fee_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `enrollment_fees_enroll_idx` ON `enrollment_fees` (`enrollment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_fees_uq` ON `enrollment_fees` (`enrollment_id`,`fee_plan_id`);--> statement-breakpoint
CREATE TABLE `fee_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`cadence` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`student_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`label` text NOT NULL,
	`period_key` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoices_family_idx` ON `invoices` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_family_period_uq` ON `invoices` (`family_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payment_allocations_payment_idx` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_invoice_idx` ON `payment_allocations` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`channel` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`memo` text,
	`idempotency_key` text NOT NULL,
	`external_ref` text,
	`reversal_of` text,
	`recorded_by_user_id` text,
	`recorded_by_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payments_family_idx` ON `payments` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idempotency_uq` ON `payments` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `families` ADD `discount_kind` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `families` ADD `discount_value` integer DEFAULT 0 NOT NULL;