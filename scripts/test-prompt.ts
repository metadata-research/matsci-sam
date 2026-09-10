// Compare system prompts from lib/prompts.json against the live Ollama model,
// without touching the database or requiring a login.
//
// Usage:
//   pnpm exec tsx scripts/test-prompt.ts <term> [example] [feedback...]
//
// Examples:
//   pnpm exec tsx scripts/test-prompt.ts "austenite"
//   pnpm exec tsx scripts/test-prompt.ts "creep" "The turbine blade failed by creep."
//   pnpm exec tsx scripts/test-prompt.ts "creep" "..." "Too vague, mention temperature."

import { DefinitionOutput, runLLM } from "@/lib/llm/client"
import { getInferenceConfig } from "@/lib/llm/config"
import prompts from "@/lib/prompts.json"
import type { InferenceMessage as Message } from "@/lib/llm/types"

const [term, example, ...feedback] = process.argv.slice(2)
if (!term) {
  console.error(
    "Usage: pnpm exec tsx scripts/test-prompt.ts <term> [example] [feedback...]"
  )
  process.exit(1)
}

// Mirror the message shapes the app writes to the chats table
const messages: Message[] = [
  { role: "user", content: `<term>\n${term}\n<example>\n${example ?? ""}` },
  ...feedback.map((f) => ({
    role: "user" as const,
    content: `<feedback>\n${f}`
  }))
]

const main = async () => {
  const config = getInferenceConfig()
  console.log(
    `profile: ${config.profile}\nmodel: ${config.model}\nterm: ${term}\n`
  )

  for (const [key, { prompt }] of Object.entries(prompts)) {
    console.log(`=== ${key} ===`)

    const start = Date.now()
    const res = await runLLM(messages, prompt, DefinitionOutput, config)
    if (!res) throw new Error("The model returned an invalid response")
    const data = res.output
    console.log(`definition: ${data.definition}`)
    console.log(`example:    ${data.example}`)
    console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s)\n`)
  }
}

main()
