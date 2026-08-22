CREATE TABLE "studies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "studies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"communityId" integer NOT NULL,
	"collectionId" integer NOT NULL,
	"title" text NOT NULL,
	"welcome" text,
	"opensAt" timestamp with time zone,
	"closesAt" timestamp with time zone,
	"retiredAt" timestamp with time zone,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "studies_slug_shape" CHECK ("studies"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "studies_title_nonblank" CHECK (btrim("studies"."title") <> ''),
	CONSTRAINT "studies_window_ordered" CHECK ("studies"."opensAt" IS NULL OR "studies"."closesAt" IS NULL OR "studies"."closesAt" > "studies"."opensAt")
);
--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD COLUMN "studyId" integer;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_collectionId_collections_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studies_community_idx" ON "studies" USING btree ("communityId");--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD CONSTRAINT "communityInvitations_studyId_studies_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;