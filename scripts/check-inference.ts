// Deliberate, bounded diagnostic. Uses synthetic text and writes no app records.
import "dotenv/config"
import { z } from "zod"
import { getInferenceConfig } from "../lib/llm/config"
import { generateStructured } from "../lib/llm/generate"
import { getInferenceHealth } from "../lib/llm/health"
import { InferenceError } from "../lib/llm/types"
import prompts from "../lib/prompts.json"

const registry = prompts as Record<string, { prompt: string }>
const prompt = (key: string) => {
  if (!registry[key])
    throw new Error("A diagnostic prompt is missing from the registry.")
  return registry[key].prompt
}
async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--")
  if (args.some((arg) => arg !== "--live"))
    throw new Error("Usage: pnpm inference:check [--live]")
  const health = await getInferenceHealth(15000)
  console.log(JSON.stringify(health))
  if (health.status !== "ready") {
    process.exitCode = 1
    return
  }
  if (!args.includes("--live")) return
  const config = getInferenceConfig()
  const cases = [
    {
      name: "new-term",
      system: prompt(process.env.NEW_TERM_PROMPT_KEY ?? "new-term-suggestion"),
      input: "<term>\naustenite",
      schema: z.object({ definition: z.string().min(1) })
    },
    {
      name: "revision",
      system: prompt(
        process.env.REVISION_SUGGESTION_PROMPT_KEY ?? "revision-suggestion"
      ),
      input:
        "<term>\ncreep\n\n<definition>\nCreep is deformation.\n\n<critique>\nMention time and sustained stress.",
      schema: z.object({ definition: z.string().min(1) })
    },
    {
      name: "definition-example",
      system:
        process.env.SYSTEM_PROMPT ||
        prompt(process.env.SYSTEM_PROMPT_KEY ?? "materials-reference"),
      input:
        "<term>\nfatigue\n<example>\nA turbine blade experiences repeated loading.",
      schema: z.object({
        definition: z.string().min(1),
        example: z.string().min(1)
      })
    },
    {
      name: "pilot-position",
      system: prompt("pilot-persona-position"),
      input:
        "Evaluate this definition: Austenite is a face-centered cubic phase of iron. Choose accept or amend and explain.",
      schema: z
        .object({
          position: z.enum(["accept", "amend"]),
          reason: z.string().min(1)
        })
        .strict()
    },
    {
      name: "pilot-comment",
      system: prompt("pilot-persona-comment"),
      input:
        "Review this definition: Creep is time-dependent deformation under sustained stress.",
      schema: z.object({ comment: z.string().min(1) })
    },
    {
      name: "pilot-answer",
      system: prompt("pilot-persona-survey"),
      input: "What makes a materials-science definition useful?",
      schema: z.object({ answer: z.string().min(1) })
    }
  ]
  for (const test of cases) {
    const started = performance.now()
    const result = await generateStructured(
      config,
      [{ role: "user", content: test.input }],
      test.system,
      test.schema
    )
    console.log(
      JSON.stringify({
        case: test.name,
        valid: Boolean(result),
        elapsedMs: Math.round(performance.now() - started),
        inference: result?.inference
      })
    )
    if (!result) {
      process.exitCode = 1
      return
    }
  }
}
main().catch((error) => {
  console.error(
    error instanceof InferenceError
      ? error.message
      : "Inference diagnostic failed; response details withheld."
  )
  process.exitCode = 1
})
