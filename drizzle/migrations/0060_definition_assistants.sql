CREATE TABLE "definitionAssistantSettings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"agentOneEnabled" boolean DEFAULT false NOT NULL,
	"defaultProfile" text DEFAULT 'default' NOT NULL,
	"agentOneTestedAt" timestamp with time zone,
	"agentOneValidationHash" text,
	"agentOneValidatedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_assistant_settings_singleton" CHECK ("definitionAssistantSettings"."id" = 1),
	CONSTRAINT "definition_assistant_default_valid" CHECK ("definitionAssistantSettings"."defaultProfile" IN ('default', 'agent-one')),
	CONSTRAINT "definition_assistant_validation_pair" CHECK (("definitionAssistantSettings"."agentOneValidationHash" IS NULL) = ("definitionAssistantSettings"."agentOneValidatedAt" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferredDefinitionAssistant" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_definition_assistant_valid" CHECK ("users"."preferredDefinitionAssistant" IS NULL OR "users"."preferredDefinitionAssistant" IN ('default', 'agent-one'));