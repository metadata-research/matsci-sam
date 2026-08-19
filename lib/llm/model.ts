// The model every generation runs against. Deliberately alone in this file:
// lib/admin/integration-readiness.ts needs the name for a health check and
// nothing else, and importing it must not pull in the prompt registry, the
// database, or the environment it requires.
export const OllamaModel = "gemma4:26b"
