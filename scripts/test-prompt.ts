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

import { DefinitionOutput, ollama, OllamaModel } from "@/lib/apis/ollama"
import prompts from "@/lib/prompts.json"
import { Message } from "ollama"
import zodToJsonSchema from "zod-to-json-schema"

const [term, example, ...feedback] = process.argv.slice(2)
if (!term) {
  console.error("Usage: pnpm exec tsx scripts/test-prompt.ts <term> [example] [feedback...]")
  process.exit(1)
}

// Mirror the message shapes the app writes to the chats table
const messages: Message[] = [
  { role: "user", content: `<term>\n${term}\n<example>\n${example ?? ""}` },
  ...feedback.map((f) => ({ role: "user", content: `<feedback>\n${f}` }))
]

const main = async () => {
  console.log(`model: ${OllamaModel}\nterm: ${term}\n`)

  for (const [key, { prompt }] of Object.entries(prompts)) {
    console.log(`=== ${key} ===`)

    const start = Date.now()
    const res = await ollama.chat({
      model: OllamaModel,
      messages: [{ role: "system", content: prompt }, ...messages],
      format: zodToJsonSchema(DefinitionOutput),
      keep_alive: 60,
      think: false
    })

    const data = DefinitionOutput.parse(JSON.parse(res.message.content))
    console.log(`definition: ${data.definition}`)
    console.log(`example:    ${data.example}`)
    console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s)\n`)
  }
}

main()
