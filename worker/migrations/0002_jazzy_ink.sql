CREATE TABLE `billing_events` (
	`stripe_event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`active` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscriptions_source_valid" CHECK("subscriptions"."source" IN ('marketing', 'bundle'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_unique` ON `subscriptions` (`stripe_subscription_id`);