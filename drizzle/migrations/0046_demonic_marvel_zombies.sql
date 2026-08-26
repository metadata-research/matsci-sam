CREATE TABLE "vocabularies" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdById" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"retiredAt" timestamp with time zone,
	CONSTRAINT "vocabularies_slug_shape" CHECK ("vocabularies"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "vocabularies_title_nonblank" CHECK (btrim("vocabularies"."title") <> '')
);
--> statement-breakpoint
ALTER TABLE "vocabularies" ADD CONSTRAINT "vocabularies_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vocabularies_one_default_unique" ON "vocabularies" USING btree ("isDefault") WHERE "vocabularies"."isDefault";--> statement-breakpoint

-- Existing public identifiers stay in the root MatSci-SAM concept scheme.
-- Community schemes begin empty: the existing worklist memberships are
-- references to these terms, not evidence that a community authored them.
INSERT INTO "vocabularies" ("slug", "title", "description", "isDefault")
VALUES (
	'matsci-sam',
	'MatSci-SAM',
	'The original MatSci-SAM vocabulary.',
	true
);--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "communities" WHERE "slug" = 'matsci-sam') THEN
		RAISE EXCEPTION 'community slug matsci-sam collides with the default vocabulary route';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "communities" c
		JOIN "terms" t ON t."slug" = c."slug"
	) THEN
		RAISE EXCEPTION 'an existing community slug collides with a default term route';
	END IF;
END
$$;--> statement-breakpoint

INSERT INTO "vocabularies" ("slug", "title", "createdById", "createdAt", "retiredAt")
SELECT "slug", "title", "createdById", "createdAt", "retiredAt"
FROM "communities";--> statement-breakpoint

ALTER TABLE "communities" ADD COLUMN "vocabularySlug" text;--> statement-breakpoint
UPDATE "communities" SET "vocabularySlug" = "slug";--> statement-breakpoint
ALTER TABLE "communities" ALTER COLUMN "vocabularySlug" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "terms" ADD COLUMN "vocabularySlug" text;--> statement-breakpoint
UPDATE "terms" SET "vocabularySlug" = 'matsci-sam';--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "vocabularySlug" SET NOT NULL;--> statement-breakpoint

-- Historical installations created these global uniqueness rules through
-- both constraint and index migrations. Remove whichever representation is
-- present before replacing it with vocabulary-scoped indexes.
ALTER TABLE "terms" DROP CONSTRAINT IF EXISTS "terms_term_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "terms_term_unique";--> statement-breakpoint
ALTER TABLE "terms" DROP CONSTRAINT IF EXISTS "terms_slug_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "terms_slug_unique";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_vocabulary_term_unique" ON "terms" USING btree ("vocabularySlug",lower(btrim("term")));--> statement-breakpoint
CREATE UNIQUE INDEX "terms_vocabulary_slug_unique" ON "terms" USING btree ("vocabularySlug","slug");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_vocabularySlug_unique" UNIQUE("vocabularySlug");--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_term_nonblank" CHECK (btrim("terms"."term") <> '');--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_slug_shape" CHECK ("terms"."slug" ~ '^[a-z0-9][a-z0-9_-]*$');
