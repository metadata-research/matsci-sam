import { AdvancedOnly } from "@/components/interface-view"
import { PublicProfileName } from "@/components/public-profile-name"
import { formatDate } from "@/lib/date"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { ContributionFileDownloads } from "./contribution-file-downloads"

/** Read the full active collection without adding contribution controls. */
export function DefinitionExampleList({
  items,
  fallback,
  headingId,
  headingLevel = 3
}: {
  items: RouterOutput["examples"]["list"]["items"]
  fallback?: string | null
  headingId: string
  headingLevel?: 3 | 4
}) {
  if (items.length === 0 && !fallback?.trim()) return null
  const Heading = headingLevel === 4 ? "h4" : "h3"

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <Heading id={headingId} className="font-sans text-sm font-semibold">
        {items.length > 1 ? "Examples" : "Example"}
      </Heading>
      {items.length === 0 ? (
        <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
          {fallback}
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((example) => {
            const modelAuthored =
              example.actorKind === "model" || example.author?.isAi === true
            return (
              <li
                key={example.id}
                className="min-w-0 space-y-2 [&+li]:border-t [&+li]:pt-4"
              >
                <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
                  {example.text}
                </p>
                <ContributionFileDownloads
                  files={example.attachments}
                  showCaption={false}
                />
                {example.legacyBackfill ? (
                  <AdvancedOnly
                    as="p"
                    className="text-xs text-muted-foreground"
                  >
                    Origin and contribution date not recorded
                  </AdvancedOnly>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <span>
                      Added by{" "}
                      <PublicProfileName
                        user={example.author}
                        className={modelAuthored ? "text-ai" : undefined}
                      />
                    </span>
                    <AdvancedOnly as="span">
                      {formatDate(example.createdAt)}
                    </AdvancedOnly>
                    {example.model && (
                      <AdvancedOnly as="span" className="font-mono text-ai">
                        {example.model}
                      </AdvancedOnly>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
