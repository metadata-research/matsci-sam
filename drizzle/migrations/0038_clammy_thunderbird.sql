CREATE TABLE "communityInvitations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "communityInvitations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"communityId" integer NOT NULL,
	"email" varchar(254) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"invitedById" integer NOT NULL,
	"sentAt" timestamp with time zone,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"revokedById" integer,
	"redeemedAt" timestamp with time zone,
	"redeemedById" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communityInvitations_tokenHash_unique" UNIQUE("tokenHash"),
	CONSTRAINT "community_invitations_revocation_pair" CHECK (("communityInvitations"."revokedAt" IS NULL) = ("communityInvitations"."revokedById" IS NULL)),
	CONSTRAINT "community_invitations_redemption_pair" CHECK (("communityInvitations"."redeemedAt" IS NULL) = ("communityInvitations"."redeemedById" IS NULL)),
	CONSTRAINT "community_invitations_one_outcome" CHECK ("communityInvitations"."revokedAt" IS NULL OR "communityInvitations"."redeemedAt" IS NULL),
	CONSTRAINT "community_invitations_expires_after_created" CHECK ("communityInvitations"."expiresAt" > "communityInvitations"."createdAt")
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "joinToken" text;--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD CONSTRAINT "communityInvitations_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD CONSTRAINT "communityInvitations_invitedById_users_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD CONSTRAINT "communityInvitations_revokedById_users_id_fk" FOREIGN KEY ("revokedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityInvitations" ADD CONSTRAINT "communityInvitations_redeemedById_users_id_fk" FOREIGN KEY ("redeemedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_invitations_community_idx" ON "communityInvitations" USING btree ("communityId");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_joinToken_unique" UNIQUE("joinToken");