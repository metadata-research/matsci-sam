CREATE TYPE "public"."community_role" AS ENUM('member', 'steward');--> statement-breakpoint
CREATE TABLE "communities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "communities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"retiredAt" timestamp with time zone,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "communities_slug_shape" CHECK ("communities"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "communities_title_nonblank" CHECK (btrim("communities"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "communityCollections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "communityCollections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"communityId" integer NOT NULL,
	"collectionId" integer NOT NULL,
	"addedById" integer NOT NULL,
	"addedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"removedAt" timestamp with time zone,
	"removedById" integer,
	CONSTRAINT "community_collections_removal_pair" CHECK (("communityCollections"."removedAt" IS NULL) = ("communityCollections"."removedById" IS NULL)),
	CONSTRAINT "community_collections_removed_after_added" CHECK ("communityCollections"."removedAt" IS NULL OR "communityCollections"."removedAt" >= "communityCollections"."addedAt")
);
--> statement-breakpoint
CREATE TABLE "communityMembers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "communityMembers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"communityId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "community_role" DEFAULT 'member' NOT NULL,
	"addedById" integer NOT NULL,
	"addedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"removedAt" timestamp with time zone,
	"removedById" integer,
	CONSTRAINT "community_members_removal_pair" CHECK (("communityMembers"."removedAt" IS NULL) = ("communityMembers"."removedById" IS NULL)),
	CONSTRAINT "community_members_removed_after_added" CHECK ("communityMembers"."removedAt" IS NULL OR "communityMembers"."removedAt" >= "communityMembers"."addedAt")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activeCommunityId" integer;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityCollections" ADD CONSTRAINT "communityCollections_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityCollections" ADD CONSTRAINT "communityCollections_collectionId_collections_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityCollections" ADD CONSTRAINT "communityCollections_addedById_users_id_fk" FOREIGN KEY ("addedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityCollections" ADD CONSTRAINT "communityCollections_removedById_users_id_fk" FOREIGN KEY ("removedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityMembers" ADD CONSTRAINT "communityMembers_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityMembers" ADD CONSTRAINT "communityMembers_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityMembers" ADD CONSTRAINT "communityMembers_addedById_users_id_fk" FOREIGN KEY ("addedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityMembers" ADD CONSTRAINT "communityMembers_removedById_users_id_fk" FOREIGN KEY ("removedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_collections_active_unique" ON "communityCollections" USING btree ("communityId","collectionId") WHERE "communityCollections"."removedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "community_collections_collection_idx" ON "communityCollections" USING btree ("collectionId");--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_active_unique" ON "communityMembers" USING btree ("communityId","userId") WHERE "communityMembers"."removedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "community_members_user_idx" ON "communityMembers" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_activeCommunityId_communities_id_fk" FOREIGN KEY ("activeCommunityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;