CREATE TABLE `stripe_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `families` ADD `stripe_customer_id` text;