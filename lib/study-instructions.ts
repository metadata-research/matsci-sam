export type StudyInstructionBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "steps"; items: string[] }

export type StudyInstructionPart = "all" | "overview" | "actions"

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

/*
 * Structured study copy serves two consecutive surfaces. The invitation and
 * study page orient the participant with prose, while the first activity step
 * presents the numbered actions. Older copy without a numbered block remains
 * intact on both surfaces instead of disappearing.
 */
export const studyInstructionBlocks = (
  text: string,
  part: StudyInstructionPart = "all"
): StudyInstructionBlock[] => {
  const blocks = parseStudyInstructions(text)
  if (part === "all") return blocks

  const selected = blocks.filter((block) =>
    part === "overview" ? block.kind === "paragraph" : block.kind === "steps"
  )
  return selected.length > 0 ? selected : blocks
}
