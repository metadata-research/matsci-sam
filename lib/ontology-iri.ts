import { z } from "zod"

/** A MatSci-ONT source key, as the store names its sources. */
export const ontologySourceKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

/** An absolute http or https IRI without credentials or unsafe characters. */
export const ontologyIri = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (/[\s<>"{}|\\^`]/u.test(value)) return false
    try {
      const url = new URL(value)
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }, "Invalid ontology IRI")
