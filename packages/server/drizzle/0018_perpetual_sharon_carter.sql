CREATE TABLE `autopay_enrollments` (
	`family_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`default_pm_id` text,
	`consent_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `autopay_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`run_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_intent_id` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `autopay_runs_pi_idx` ON `autopay_runs` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `autopay_runs_family_date_uq` ON `autopay_runs` (`family_id`,`run_date`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`brand` text,
	`last4` text,
	`exp_month` integer,
	`exp_year` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_methods_family_idx` ON `payment_methods` (`family_id`);