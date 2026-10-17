import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"

/**
 * The deployed Ollama grammar compiler rejects bounded definition strings.
 * Keep the object contract on the wire and enforce string bounds with the
 * original Zod schema after generation. Other transports retain every bound.
 */
export function ollamaResponseSchema(schema: z.ZodTypeAny) {
  const output = zodToJsonSchema(schema)
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== "object") return
    const node = value as Record<string, unknown>
    if (node.type === "string") {
      delete node.minLength
      delete node.maxLength
    }
    // Visit schema nodes only; never rewrite enum values, defaults or examples.
    for (const key of [
      "properties",
      "patternProperties",
      "definitions",
      "$defs",
      "dependentSchemas"
    ]) {
      const children = node[key]
      if (children && typeof children === "object")
        Object.values(children).forEach(visit)
    }
    for (const key of [
      "allOf",
      "anyOf",
      "oneOf",
      "prefixItems",
      "items",
      "additionalItems",
      "additionalProperties",
      "contains",
      "not",
      "if",
      "then",
      "else",
      "propertyNames",
      "unevaluatedItems",
      "unevaluatedProperties"
    ])
      visit(node[key])
  }
  visit(output)
  return output
}
