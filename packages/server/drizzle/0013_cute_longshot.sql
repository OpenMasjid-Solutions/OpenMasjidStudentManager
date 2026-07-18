CREATE TABLE `comment_snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`owner_user_id` text,
	`text` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_snippets_owner_idx` ON `comment_snippets` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `comment_snippets_scope_idx` ON `comment_snippets` (`scope`);