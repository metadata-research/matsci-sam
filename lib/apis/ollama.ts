import {
  chatsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  refinementsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import {
  and,
  asc,
  eq,
  getTableColumns,
  isNull,
  lt,
  sql
} from "drizzle-orm"
import { createHash } from "node:crypto"
import { Message, Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import { UpsertAIDefinition } from "../crud"
import prompts from "@/lib/prompts.json"
import {
  buildRevisionMessages,
  needsReconstructedDefinitionContext
} from "./ollama-revision-context"

export type DefinitionOutput = z.infer<typeof DefinitionOutput>
export const DefinitionOutput = z.object({
  definition: z.string(),
  example: z.string()
})

const resolvePromptKey = (key: string) => {
  const entry = (prompts as Record<string, { prompt: string }>)[key]
  if (!entry)
    throw new Error(
      `Unknown prompt key "${key}" — available prompts: ${Object.keys(prompts).join(", ")}`
    )

  return entry.prompt
}

// System prompt selection: SYSTEM_PROMPT_KEY picks a named prompt from
// lib/prompts.json; SYSTEM_PROMPT (raw text) still works and takes precedence
// so existing deployments are unaffected.
const resolveSystemPrompt = () => {
  if (process.env.SYSTEM_PROMPT) return process.env.SYSTEM_PROMPT

  const key = process.env.SYSTEM_PROMPT_KEY
  if (!key)
    throw new Error("Set SYSTEM_PROMPT or SYSTEM_PROMPT_KEY in the environment")

  return resolvePromptKey(key)
}

export const LLMSystemPrompt = resolveSystemPrompt()

// Prompt for the interactive refine flow; REFINE_PROMPT_KEY overrides the
// default "refine" entry in lib/prompts.json.
export const RefinePromptKey = process.env.REFINE_PROMPT_KEY ?? "refine"
export const RefineSystemPrompt = resolvePromptKey(RefinePromptKey)

export const OllamaModel = "gemma4:26b"

// Provenance stamp written on every AI-generated row (chats, refinement
// rounds) so each generation stays attributable to the exact prompt and model
// that produced it. promptHash covers edits to prompts.json under an
// unchanged key and raw SYSTEM_PROMPT text (where promptKey is null).
export const makeGenerationStamp = (
  promptKey: string | null,
  promptText: string
) => ({
  promptKey,
  promptHash: createHash("sha256")
    .update(promptText)
    .digest("hex")
    .slice(0, 16),
  promptText,
  model: OllamaModel
})

export const generationStamp = makeGenerationStamp(
  process.env.SYSTEM_PROMPT ? null : (process.env.SYSTEM_PROMPT_KEY ?? null),
  LLMSystemPrompt
)

export const refineGenerationStamp = makeGenerationStamp(
  RefinePromptKey,
  RefineSystemPrompt
)

export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST
})

export const runLLM = async (
  messages: Message[],
  systemPrompt: string = LLMSystemPrompt
) => {
  const res = await ollama.chat({
    model: OllamaModel,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    format: zodToJsonSchema(DefinitionOutput),
    // Keep the model loaded between requests — reloading gemma4:26b (~18 GB)
    // costs ~22s, which users see as the AI definition hanging
    keep_alive: "10m",
    think: false
  })

  try {
    const raw = JSON.parse(res.message.content)
    const data = DefinitionOutput.parse(raw)

    return data
  } catch (err) {
    console.log(JSON.stringify(res, null, 2))
    console.error("Model returned an invalid response", err)
  }
}

export const reviseDefinition = async (termId: number) => {
  const chats = await db.query.chatsTable.findMany({
    where: eq(chatsTable.termId, termId),
    orderBy: asc(chatsTable.createdAt)
  })

  const lastChat = chats[chats.length - 1]
  if (!lastChat) throw new Error("No user request is waiting for AI generation")
  if (lastChat.role !== "user")
    throw new Error("The latest user request already has an AI response")

  // EGO_SEED_CHAT_FALLBACK: the one-time public seed deliberately removes
  // private term chat transcripts, so a later public feedback thread may
  // begin without the original term context.
  let reconstructedContext
  if (needsReconstructedDefinitionContext(chats)) {
    const [currentAI] = await db
      .select({
        term: termsTable.term,
        definition: definitionsTable.definition,
        example: definitionsTable.example
      })
      .from(termsTable)
      .innerJoin(
        definitionsTable,
        eq(definitionsTable.termId, termsTable.id)
      )
      .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .where(
        and(
          eq(termsTable.id, termId),
          eq(usersTable.isAi, true),
          isNull(usersTable.name),
          isNull(definitionsTable.refinedFromId)
        )
      )
      .orderBy(asc(definitionsTable.id))
      .limit(1)

    reconstructedContext = currentAI
  }

  const result = await runLLM(
    buildRevisionMessages(chats, reconstructedContext)
  )
  if (!result) throw new Error("Something went wrong")

  await UpsertAIDefinition(termId, result, {
    model: OllamaModel,
    prompt: LLMSystemPrompt
  })

  const [insertedChat] = await db
    .insert(chatsTable)
    .values({
      role: "system",
      message: `<definition>\n${result?.definition}\n\n<example>\n${result.example}`,
      termId,
      ...generationStamp
    })
    .returning()

  return { result, insertedChat }
}

// Drives one interactive refinement round from "pending" to "suggested" (or
// "failed"). Context is rebuilt per call from the round's definition and the
// prior rounds of that definition — deliberately NOT from chatsTable, which
// belongs to the term-level AI definition thread.
export const runRefinementRound = async (refinementId: number) => {
  const [round] = await db
    .select({
      ...getTableColumns(refinementsTable),
      term: termsTable.term,
      currentDefinition: definitionsTable.definition,
      currentExample: definitionsTable.example,
      sourceDefinition: definitionRevisionsTable.definition,
      sourceExample: definitionRevisionsTable.example
    })
    .from(refinementsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, refinementsTable.definitionId)
    )
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .leftJoin(
      definitionRevisionsTable,
      eq(definitionRevisionsTable.id, refinementsTable.sourceRevisionId)
    )
    .where(eq(refinementsTable.id, refinementId))

  if (!round) throw new Error(`Refinement ${refinementId} doesn't exist`)
  if (round.status !== "pending")
    throw new Error(
      `Refinement ${refinementId} is "${round.status}", expected "pending"`
    )

  try {
    const priorRounds = await db.query.refinementsTable.findMany({
      where: and(
        eq(refinementsTable.definitionId, round.definitionId),
        lt(refinementsTable.round, round.round)
      ),
      orderBy: asc(refinementsTable.round)
    })

    const messages: Message[] = [
      {
        role: "user",
        content: `<term>\n${round.term}\n\n<definition>\n${round.sourceDefinition ?? round.currentDefinition}\n\n<example>\n${round.sourceExample ?? round.currentExample}`
      }
    ]

    // Replay the negotiation in order: each round's feedback comment came
    // before its suggestion, and failed rounds contribute their feedback but
    // no assistant turn.
    for (const r of [...priorRounds, round]) {
      if (r.userComment)
        messages.push({ role: "user", content: `<feedback>\n${r.userComment}` })

      if (r.id !== round.id && r.suggestedDefinition)
        messages.push({
          role: "assistant",
          content: `<definition>\n${r.suggestedDefinition}\n\n<example>\n${r.suggestedExample}`
        })
    }

    const result = await runLLM(messages, RefineSystemPrompt)
    if (!result) throw new Error("Model returned an invalid response")

    const [updated] = await db
      .update(refinementsTable)
      .set({
        status: "suggested",
        suggestedDefinition: result.definition,
        suggestedExample: result.example,
        suggestedAt: sql`now()`,
        ...refineGenerationStamp
      })
      .where(eq(refinementsTable.id, refinementId))
      .returning()

    return updated
  } catch (err) {
    // Persist the failure so the UI can show it explicitly (no silent
    // fallback), then rethrow for the server log.
    await db
      .update(refinementsTable)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        suggestedAt: sql`now()`
      })
      .where(eq(refinementsTable.id, refinementId))

    throw err
  }
}
