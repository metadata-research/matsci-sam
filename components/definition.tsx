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
  UserIcon
} from "lucide-react"
import { Badge } from "./ui/badge"

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
  </div>
)

export const Term = ({
  term
}: {
  term: TermType & { count?: number | null }
}) => (
  <Link href={`/terms/${term.id}`} className="block">
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
  children
}: {
  definition: DefinitionType & {
    vote?: "up" | "down" | null
    isAi: boolean
    // author display name; pages that don't fetch it omit the attribution
    author?: string | null
    comments?: number | null
  }
  children?: ReactNode
}) => (
  <Link
    href={`/definition/${definition.id}`}
    className="block"
    key={definition.id}
  >
    <Card className="flex-row p-4 gap-4 transition-colors hover:bg-secondary/50">
      {definition.vote !== undefined && (
        <TermVotes
          initial={{ score: definition.score, vote: definition.vote }}
          definitionId={definition.id}
        />
      )}
      <section className="flex-1 space-y-2">
        {children}
        <div>
          <Eyebrow>Definition</Eyebrow>
          <p>{definition.definition}</p>
        </div>
        <div>
          <Eyebrow>Example</Eyebrow>
          <p className="text-muted-foreground">{definition.example}</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1 flex-wrap">
          {definition.isAi ? (
            <span className="flex items-center gap-1 text-ai">
              <SparklesIcon className="size-3.5" />
              {definition.model ?? "AI"}
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
        </div>
      </section>
      <section className="flex flex-col items-end gap-1">
        {definition.isAi && (
          <Badge className="bg-ai/15 text-ai border-ai/30">AI Generated</Badge>
        )}
        {definition.refinedFromId && definition.model && (
          <Badge className="bg-ai/15 text-ai border-ai/30 font-mono">
            Refined with {definition.model}
          </Badge>
        )}
      </section>
    </Card>
  </Link>
)
