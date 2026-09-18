PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_advert_images` (
	`advert_id` text NOT NULL,
	`platform` text NOT NULL,
	`r2_key` text NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`advert_id`, `platform`),
	FOREIGN KEY (`advert_id`) REFERENCES `adverts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_advert_images`("advert_id", "platform", "r2_key", "generated_at") SELECT "advert_id", "platform", "r2_key", "generated_at" FROM `advert_images`;--> statement-breakpoint
DROP TABLE `advert_images`;--> statement-breakpoint
ALTER TABLE `__new_advert_images` RENAME TO `advert_images`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `adverts` ADD `story_words` text;