import type { Definition as DefinitionType, Term as TermType } from "@yamz/db"
import Link from "next/link"
import { Card } from "./ui/card"
import { TermVotes } from "./term/votes"
import { formatDate } from "@/lib/date"
import { ReactNode } from "react"
import {
  ArrowRight,
  MessageSquareIcon,
  SparklesIcon,
  UserIcon
} from "lucide-react"
import { Badge } from "./ui/badge"
import { definitionStatus, type DefinitionStatus } from "@/lib/status"
import { PublicProfileName } from "./public-profile-name"
import { definitionPath } from "@/lib/public-identifiers"

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
  onScoreChange,
  children
}: {
  definition: DefinitionType & {
    vote?: "up" | "down" | null
    isAi: boolean
    // author display name; pages that don't fetch it omit the attribution
    author?: string | null
    authorProfilePublic?: boolean
    comments?: number | null
    revisionId: number
    version: number
    termSlug: string
  }
  // The term's leading definition: highest voted, newest breaking ties. Callers
  // decide -- this component does not rank, it only marks. Left false when a
  // term has just one definition, where "default" would distinguish nothing.
  isDefault?: boolean
  // Reports this definition's live score up so a parent list can re-sort when a
  // vote changes the ranking. Optional -- standalone uses (search, homepage)
  // ignore it.
  onScoreChange?: (score: number) => void
  children?: ReactNode
}) => (
  <Card
    // The leading (highest-voted) definition is marked by a full primary
    // border and a soft lift, not a label and not a fill -- a colored edge on
    // a bright surface reads as promoted, whereas a tint reads as muted. The
    // styling follows whichever card is on top, so it survives reordering.
    className={`flex-row p-4 gap-4 transition-all ${
      isDefault
        ? "border-primary shadow-md hover:bg-secondary/50"
        : "hover:bg-secondary/50"
    }`}
  >
    {definition.vote !== undefined && (
      <TermVotes
        initial={{ score: definition.score, vote: definition.vote }}
        definitionId={definition.id}
        revisionId={definition.revisionId}
        onScoreChange={onScoreChange}
      />
    )}
    <section className="min-w-0 flex-1 space-y-2">
      <Link
        href={definitionPath(definition.termSlug, definition.definitionNumber)}
        className="block space-y-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
        <div>
          <Eyebrow>Definition</Eyebrow>
          <p>{definition.definition}</p>
        </div>
        <div>
          <Eyebrow>Example</Eyebrow>
          <p className="text-muted-foreground">{definition.example}</p>
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm text-muted-foreground">
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
              <UserIcon className="size-3.5 text-muted-foreground" />
              <PublicProfileName
                user={{
                  id: definition.authorId,
                  name: definition.author,
                  isAi: false,
                  isProfilePublic: definition.authorProfilePublic ?? false
                }}
              />
            </span>
          )
        )}
        <span>{formatDate(definition.createdAt)}</span>
        <span>
          Definition {definition.definitionNumber} · revision{" "}
          {definition.version}
        </span>
        <StatusChip score={definition.score} />
        {typeof definition.comments === "number" && (
          <Link
            href={
              definitionPath(
                definition.termSlug,
                definition.definitionNumber
              ) + "#discussion"
            }
            className={`flex items-center gap-1 hover:underline ${
              definition.comments > 0 ? "text-primary" : ""
            }`}
          >
            <MessageSquareIcon className="size-3.5" />
            {definition.comments > 0
              ? `${definition.comments} ${definition.comments === 1 ? "comment" : "comments"}`
              : "No comments"}
          </Link>
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
)
