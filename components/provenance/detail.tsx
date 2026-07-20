import { ReactNode } from "react"

// Chat and refinement messages are stored with lightweight section markers
// ("<term>", "<definition>", "<example>", "<feedback>"). Render them as
// labeled sections instead of leaking the raw markup; text without markers
// passes through unchanged.
const TAG_RE = /<(term|definition|example|feedback)>\s*/g

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
  </div>
)

export const ProvDetail = ({
  text,
  className = ""
}: {
  text: string
  className?: string
}) => {
  const parts: { label: string | null; body: string }[] = []
  let label: string | null = null
  let lastIndex = 0

  for (const match of text.matchAll(TAG_RE)) {
    const body = text.slice(lastIndex, match.index).trim()
    if (body) parts.push({ label, body })
    label = match[1]
    lastIndex = match.index + match[0].length
  }
  const tail = text.slice(lastIndex).trim()
  if (tail) parts.push({ label, body: tail })

  if (parts.length === 0) return null

  return (
    <div className={`space-y-2 ${className}`}>
      {parts.map((part, i) => (
        <div key={i}>
          {part.label && <SectionLabel>{part.label}</SectionLabel>}
          <p className="text-sm whitespace-pre-wrap">{part.body}</p>
        </div>
      ))}
    </div>
  )
}
