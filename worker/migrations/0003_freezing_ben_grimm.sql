CREATE TABLE `advert_videos` (
	`advert_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lease_id` text NOT NULL,
	`interaction_id` text,
	`start_key` text NOT NULL,
	`r2_key` text,
	`motion` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`advert_id`) REFERENCES `adverts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "advert_videos_status_valid" CHECK("advert_videos"."status" IN ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE `adverts` ADD `format` text DEFAULT 'images' NOT NULL;--> statement-breakpoint
ALTER TABLE `adverts` ADD `slides` text;--> statement-breakpoint
ALTER TABLE `adverts` ADD `background_key` text;