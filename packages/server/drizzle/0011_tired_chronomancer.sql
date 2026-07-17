ALTER TABLE `report_cards` ADD `data_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `report_cards_version_uq` ON `report_cards` (`student_id`,`class_id`,`version`);