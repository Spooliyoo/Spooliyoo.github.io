ALTER TABLE "settings" ALTER COLUMN "theme" SET DEFAULT 'light';--> statement-breakpoint
UPDATE "settings" SET "theme" = 'light' WHERE "theme" = 'system';
