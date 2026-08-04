import { diffToStringSimple } from "@/lib/utils"
import { Diff, DiffOp } from "diff-match-patch-ts"
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

type DiffTextProps = {
  diffs: Diff[],
};

export const DiffText = ({ diffs }: DiffTextProps) => {
  const chunks = [];
  let i = 0;
  for (const [operation, text] of diffs) {
    switch (operation) {
      case DiffOp.Delete:
        chunks.push(<span key={i} style={{ color: "red", textDecoration: "line-through" }}>{text}</span>);
        break;
      case DiffOp.Equal:
        chunks.push(<span key={i}>{text}</span>);
        break;
      case DiffOp.Insert:
        chunks.push(<span key={i} style={{ color: "green" }}>{text}</span>);
        break;
    }
    i++;
  }
  return (
    <div>
      {chunks.map((chunk) => chunk)}
    </div>
  );
}

export const ProvDetail = ({
  text,
  className = ""
}: {
  text: string | Diff[]
  className?: string
}) => {
  const parts: { label: string | null; body: string }[] = []
  let label: string | null = null
  let lastIndex = 0
  if (typeof text === "string") {
    const textStr = text;
    for (const match of textStr.matchAll(TAG_RE)) {
      const body = textStr.slice(lastIndex, match.index).trim()
      if (body) parts.push({ label, body })
      label = match[1]
      lastIndex = match.index + match[0].length
    }
    const tail = textStr.slice(lastIndex).trim()
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
  } else {
    return (<DiffText diffs={text} />);
  }

}
