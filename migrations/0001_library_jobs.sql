CREATE TABLE `repair_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`folder` text NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_findings_job_key_kind` ON `repair_findings` (`job_id`,`key`,`kind`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`phase` text DEFAULT 'files' NOT NULL,
	`cursor` text DEFAULT '0' NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `object_tombstones` (
	`key` text PRIMARY KEY NOT NULL,
	`pending` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `files` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `thumbnail_key` text;--> statement-breakpoint
ALTER TABLE `files` ADD `missing` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_files_folder_created_id` ON `files` (`folder`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_files_folder_size_id` ON `files` (`folder`,`size`,`id`);