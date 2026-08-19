/*
 * How a model tag becomes an identity.
 *
 * The tag is what the runtime was asked for, so it is the identity: a
 * generation is only reproducible against the exact tag. Everything else here
 * is presentation, derived from the tag so a model that first appears at
 * runtime still gets a sensible name and profile without anyone editing a
 * table.
 *
 * Pure module: no database, no environment. scripts and client code may read
 * it.
 */

export type ModelIdentity = {
  tag: string
  slug: string
  displayName: string
  vendor: string
  family: string | null
  parameterSize: string | null
}

// Vendors are recognised by the family name the tag starts with. An
// unrecognised tag still gets an identity; only the vendor is unknown.
const VENDORS: readonly { match: RegExp; vendor: string; family: string }[] = [
  { match: /^gemma/i, vendor: "Google", family: "Gemma" },
  { match: /^gemini/i, vendor: "Google", family: "Gemini" },
  { match: /^claude/i, vendor: "Anthropic", family: "Claude" },
  { match: /^gpt|^o[1-9]/i, vendor: "OpenAI", family: "GPT" },
  { match: /^llama/i, vendor: "Meta", family: "Llama" },
  { match: /^mistral|^mixtral/i, vendor: "Mistral", family: "Mistral" },
  { match: /^qwen/i, vendor: "Alibaba", family: "Qwen" },
  { match: /^deepseek/i, vendor: "DeepSeek", family: "DeepSeek" },
  { match: /^phi/i, vendor: "Microsoft", family: "Phi" }
]

const slugOf = (tag: string) =>
  tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "") || "model"

// "gemma4:26b" -> 26B; "claude-opus-5" -> none. Only a size suffix counts,
// so a version number is not mistaken for a parameter count.
const parameterSizeOf = (tag: string) => {
  const match = tag.match(/[:\-_](\d+(?:\.\d+)?)\s*b\b/i)
  return match ? `${match[1]}B` : null
}

/*
 * A name that reads as an author rather than as machinery, while still
 * saying which model it is. "MatBot" marks it unmistakably as a machine, so
 * the interface does not need a separate "AI generated" label beside it.
 */
const displayNameOf = (tag: string, family: string | null) => {
  if (!family) return `MatBot ${tag}`

  // The version that follows the family name, if the tag carries one:
  // "gemma4:26b" -> 4, "claude-opus-5" -> opus 5.
  const rest = tag.slice(family.length).replace(/^[-_:\s]+/, "")
  const version = rest
    .split(/[:\-_]/)
    .filter((part) => part !== "" && !/^\d+(\.\d+)?b$/i.test(part))
    // "opus" is a name, not a number: capitalise the words so the result
    // reads as a title rather than as a command-line argument.
    .map((part) =>
      /^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part
    )
    .join(" ")

  const label = version ? `${family} ${version}` : family
  return `MatBot ${label.replace(/\s+/g, " ").trim()}`
}

export const modelIdentity = (tag: string): ModelIdentity => {
  const trimmed = tag.trim()
  const known = VENDORS.find((entry) => entry.match.test(trimmed))
  const family = known?.family ?? null

  return {
    tag: trimmed,
    slug: slugOf(trimmed),
    displayName: displayNameOf(trimmed, family),
    vendor: known?.vendor ?? "Unknown",
    family,
    parameterSize: parameterSizeOf(trimmed)
  }
}
