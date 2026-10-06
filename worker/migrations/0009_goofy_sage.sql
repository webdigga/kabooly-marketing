CREATE TABLE `google_connections` (
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`refresh_token` text NOT NULL,
	`account` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `service`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
