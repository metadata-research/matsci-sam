ALTER TABLE "users" ADD COLUMN "orcidId" varchar(19);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firstName" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastName" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "affiliation" varchar(255);--> statement-breakpoint
UPDATE "users"
SET
	"firstName" = NULLIF(split_part(btrim("name"), ' ', 1), ''),
	"lastName" = CASE
		WHEN position(' ' in btrim("name")) > 0
			THEN NULLIF(substring(btrim("name") from position(' ' in btrim("name")) + 1), '')
		ELSE NULL
	END
WHERE NOT "isAi" AND "name" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "definitions_author_idx" ON "definitions" USING btree ("authorId");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_orcidId_unique" UNIQUE("orcidId");
