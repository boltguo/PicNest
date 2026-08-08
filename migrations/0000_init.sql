CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`folder` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_folder_name` ON `files` (`folder`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_folder_key` ON `files` (`folder`,`key`);--> statement-breakpoint
CREATE INDEX `idx_files_folder` ON `files` (`folder`);--> statement-breakpoint
CREATE INDEX `idx_files_created_at` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_files_key` ON `files` (`key`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_path_unique` ON `folders` (`path`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`file_id` integer NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`visits` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
CREATE INDEX `idx_shares_file_id` ON `shares` (`file_id`);