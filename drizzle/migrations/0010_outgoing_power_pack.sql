ALTER TABLE "chats" ADD COLUMN "userId" integer;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "createdAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Placeholder timestamps for votes cast before tracking existed: the
-- definition's creation time is the best known lower bound. Everything in
-- the table at migration time is by definition untracked.
UPDATE "votes" SET "createdAt" = d."createdAt"
FROM "definitions" d
WHERE "votes"."definitionId" = d."id";--> statement-breakpoint
-- Attribute historical feedback chats via their mirrored comment: comments
-- on AI definitions were copied into the chat thread verbatim as
-- "<feedback>\n<comment text>".
UPDATE "chats" SET "userId" = c."userId"
FROM "comments" c
JOIN "definitions" d ON c."definitionId" = d."id"
WHERE "chats"."role" = 'user'
  AND "chats"."userId" IS NULL
  AND d."termId" = "chats"."termId"
  AND "chats"."message" = '<feedback>' || E'\n' || c."message";
