export type StudyInstructionBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "steps"; items: string[] }

const NUMBERED_STEP = /^(\d+)\.\s+(.+)$/

// Study copy remains plain text. A consecutive 1., 2., 3. block is the one
// small convention that gives participant instructions real list semantics.
export const parseStudyInstructions = (text: string): StudyInstructionBlock[] =>
  text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const items: string[] = []

      for (const [index, line] of lines.entries()) {
        const match = NUMBERED_STEP.exec(line)
        if (!match || Number(match[1]) !== index + 1)
          return { kind: "paragraph", text: chunk.trim() }
        items.push(match[2])
      }

      return items.length > 1
        ? { kind: "steps", items }
        : { kind: "paragraph", text: chunk.trim() }
    })
