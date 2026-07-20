import type { Definition as DefinitionType, Term as TermType } from "@yamz/db"
import Link from "next/link"
import { Card } from "./ui/card"
import { TermVotes } from "./term/votes"
import { lightFormat } from "date-fns"
import { ReactNode } from "react"
import {
  ArrowRight,
  MessageSquareIcon,
  SparklesIcon,
  StarIcon,
  UserIcon
} from "lucide-react"
import { Badge } from "./ui/badge"
import { definitionStatus, type DefinitionStatus } from "@/lib/status"

// Shared by the definition cards and the single-definition page so both use
// one label treatment.
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
  </div>
)

// Community lifecycle chip, derived from votes (lib/status.ts). Quiet by
// design: one word, gaining color only as a definition earns standing.
const STATUS_STYLE: Record<DefinitionStatus, string> = {
  proposed: "text-muted-foreground border-border",
  "community-reviewed": "bg-secondary text-secondary-foreground border-border",
  stable: "bg-primary/15 text-primary border-primary/30"
}

export const StatusChip = ({ score }: { score: number }) => {
  const status = definitionStatus(score)

  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {status}
    </Badge>
  )
}

export const Term = ({
  term
}: {
  term: TermType & { count?: number | null }
}) => (
  <Link href={`/vocabulary/${term.slug}`} className="block">
    <Card className="flex-row justify-between p-4 transition-colors hover:bg-secondary/50">
      <h1 className="text-lg font-bold font-serif">{term.term}</h1>
      {term.count && (
        <p className="text-primary flex items-center">
          {term.count} definitions <ArrowRight className="size-4 ml-2" />
        </p>
      )}
    </Card>
  </Link>
)

export const Definition = ({
  definition,
  isDefault = false,
  children
}: {
  definition: DefinitionType & {
    vote?: "up" | "down" | null
    isAi: boolean
    // author display name; pages that don't fetch it omit the attribution
    author?: string | null
    comments?: number | null
  }
  // The term's leading definition: highest voted, newest breaking ties. Callers
  // decide -- this component does not rank, it only marks. Left false when a
  // term has just one definition, where "default" would distinguish nothing.
  isDefault?: boolean
  children?: ReactNode
}) => (
  <Link
    href={`/definition/${definition.id}`}
    className="block"
    key={definition.id}
  >
    <Card
      className={`flex-row p-4 gap-4 transition-colors hover:bg-secondary/50 ${
        isDefault ? "ring-1 ring-primary/25" : ""
      }`}
    >
      {definition.vote !== undefined && (
        <TermVotes
          initial={{ score: definition.score, vote: definition.vote }}
          definitionId={definition.id}
        />
      )}
      <section className="flex-1 space-y-2">
        {isDefault && (
          <div
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-primary"
            title="Highest voted definition for this term"
          >
            <StarIcon className="size-3.5 fill-current" />
            Default
          </div>
        )}
        {children}
        <div>
          <Eyebrow>Definition</Eyebrow>
          <p>{definition.definition}</p>
        </div>
        <div>
          <Eyebrow>Example</Eyebrow>
          <p className="text-muted-foreground">{definition.example}</p>
        </div>
        <div className="flex items-center gap-x-4 gap-y-2 text-sm text-muted-foreground pt-1 flex-wrap">
          {definition.isAi ? (
            // Carries the plain-language "AI" label alongside the model, so no
            // separate "AI Generated" badge is needed to state the same thing.
            <span className="flex items-center gap-1 text-ai">
              <SparklesIcon className="size-3.5" />
              AI
              {definition.model && (
                <>
                  <span aria-hidden className="text-ai/50">
                    &middot;
                  </span>
                  <span className="font-mono">{definition.model}</span>
                </>
              )}
            </span>
          ) : (
            definition.author && (
              <span className="flex items-center gap-1">
                <UserIcon className="size-3.5" />
                {definition.author}
              </span>
            )
          )}
          <span>{lightFormat(definition.createdAt, "yyyy-MM-dd")}</span>
          <StatusChip score={definition.score} />
          {typeof definition.comments === "number" && (
            <span
              className={`flex items-center gap-1 ${
                definition.comments > 0 ? "text-primary" : ""
              }`}
            >
              <MessageSquareIcon className="size-3.5" />
              {definition.comments > 0
                ? `${definition.comments} ${definition.comments === 1 ? "comment" : "comments"}`
                : "No comments"}
            </span>
          )}
          {/* The badge slot means one thing only: this definition is a
              refinement of another. AI authorship is stated by the identity
              chip above. Closing out the metadata row rather than sitting in a
              side column, which reserved full-card-height width for one line
              of content; ml-auto right-aligns it on whichever line it wraps
              onto. */}
          {definition.refinedFromId && definition.model && (
            <Badge className="ml-auto bg-ai/15 text-ai border-ai/30 font-mono">
              Refined with {definition.model}
            </Badge>
          )}
        </div>
      </section>
    </Card>
  </Link>
)
