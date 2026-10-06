CREATE TABLE `review_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`target` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_links_slug_unique` ON `review_links` (`slug`);