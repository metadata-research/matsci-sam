import type { ReactNode } from "react"
import { parseStudyInstructions } from "@/lib/study-instructions"
import { cn } from "@/lib/utils"

type StudyInstructionContentProps = {
  text: string
  className?: string
  empty?: ReactNode
}

// Reviewed study copy stays plain text. Consecutive numbered lines are the
// one formatting convention shared by every participant-facing surface.
export const StudyInstructionContent = ({
  text,
  className,
  empty = null
}: StudyInstructionContentProps) => {
  const blocks = parseStudyInstructions(text)

  if (blocks.length === 0) return empty

  return (
    <div className={cn("grid gap-3", className)}>
      {blocks.map((block, blockIndex) =>
        block.kind === "steps" ? (
          <ol
            key={blockIndex}
            className="list-decimal space-y-3 rounded-md border bg-muted/30 py-4 pr-4 pl-10 marker:font-semibold marker:text-primary"
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${itemIndex}-${item}`} className="pl-1">
                {item}
              </li>
            ))}
          </ol>
        ) : (
          <p key={blockIndex} className="whitespace-pre-line">
            {block.text}
          </p>
        )
      )}
    </div>
  )
}
