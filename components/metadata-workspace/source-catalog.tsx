"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { matcoreCatalogHref } from "@/lib/matcore-catalog-navigation"
import type { MatcoreProfileKey } from "@/lib/matcore-workflow-types"
import { profileLabel } from "./workspace-presenters"
import { WorkspaceSelect } from "./workspace-select"
import { SourceCatalogEntry } from "./source-catalog-entry"

type Props = {
  community: { slug: string; title: string }
  catalog: RouterOutput["matcoreWorkflow"]["sourceCatalog"]
  entry: RouterOutput["matcoreWorkflow"]["sourceEntry"] | null
  viewerId: number | null
}

/** Shared source text is separate from the contributor's private proposal. */
export function SourceCatalog({ community, catalog, entry, viewerId }: Props) {
  const router = useRouter()
  if (!catalog.selectedRelease)
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">MatCore catalog</h2>
        <p className="text-sm text-muted-foreground">
          No source version has been installed for this community. A site
          administrator can add an approved source version.
        </p>
      </section>
    )
  const selectedRelease = catalog.selectedRelease
  const profileKey = catalog.profileKey ?? undefined
  const href = (next: {
    releaseId?: string
    profileKey?: MatcoreProfileKey
    offset?: number
    source?: string
  }) => matcoreCatalogHref(community.slug, next)
  const listHref = href({
    releaseId: selectedRelease.id,
    profileKey,
    offset: catalog.offset
  })

  return (
    <section
      aria-labelledby="matcore-catalog-heading"
      className="flex min-w-0 flex-col gap-5"
    >
      <header className="flex flex-col gap-2">
        <h2 id="matcore-catalog-heading" className="text-xl font-semibold">
          MatCore catalog
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Versioned reference entries from the preserved MatCore source. Changes
          are prepared separately as local proposals.
        </p>
      </header>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="matcore-catalog-version">
            Source version
          </FieldLabel>
          <WorkspaceSelect
            id="matcore-catalog-version"
            value={selectedRelease.id}
            onChange={(event) =>
              router.push(href({ releaseId: event.target.value }))
            }
          >
            {catalog.releases.map((release) => (
              <option key={release.id} value={release.id}>
                MatCore {release.version}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="matcore-catalog-profile">Profile</FieldLabel>
          <WorkspaceSelect
            id="matcore-catalog-profile"
            value={profileKey ?? ""}
            onChange={(event) =>
              router.push(
                href({
                  releaseId: selectedRelease.id,
                  profileKey: (event.target.value || undefined) as
                    | MatcoreProfileKey
                    | undefined
                })
              )
            }
          >
            <option value="">All profiles</option>
            {catalog.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profileLabel(profile.id)} ({profile.count})
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
      </FieldGroup>
      {entry ? (
        <SourceCatalogEntry
          key={`${entry.releaseId}:${entry.occurrenceId}`}
          community={community}
          entry={entry}
          viewerId={viewerId}
          listHref={listHref}
          detailHref={href({
            releaseId: entry.releaseId,
            profileKey,
            offset: catalog.offset,
            source: entry.occurrenceId
          })}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {catalog.total} source field{" "}
            {catalog.total === 1 ? "entry" : "entries"}
            {catalog.occurrences.length
              ? ` · Showing ${catalog.offset + 1}–${catalog.offset + catalog.occurrences.length}`
              : ""}
          </p>
          {catalog.occurrences.length ? (
            <ul className="flex min-w-0 flex-col divide-y rounded-lg border">
              {catalog.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="min-w-0 p-4">
                  <h3 className="break-words font-medium">
                    <Link
                      href={href({
                        releaseId: selectedRelease.id,
                        profileKey,
                        offset: catalog.offset,
                        source: occurrence.id
                      })}
                      className="underline underline-offset-4"
                    >
                      {occurrence.baseline.label}
                    </Link>
                  </h3>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {profileLabel(occurrence.profileKey)} ·{" "}
                    {occurrence.source.path.join(" / ")}
                  </p>
                  <p className="mt-2 line-clamp-2 break-words text-sm">
                    {occurrence.baseline.definition}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No source entries on this page.{" "}
              {catalog.offset > 0 ? (
                <Link
                  className="underline underline-offset-4"
                  href={href({
                    releaseId: selectedRelease.id,
                    profileKey
                  })}
                >
                  Return to the first page
                </Link>
              ) : null}
            </p>
          )}
          {catalog.total > catalog.limit || catalog.offset > 0 ? (
            <nav
              aria-label="MatCore catalog pages"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={catalog.offset === 0}
                onClick={() =>
                  router.push(
                    href({
                      releaseId: selectedRelease.id,
                      profileKey,
                      offset: Math.max(0, catalog.offset - catalog.limit)
                    })
                  )
                }
              >
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">
                Page {Math.floor(catalog.offset / catalog.limit) + 1}
              </p>
              <Button
                variant="outline"
                disabled={catalog.offset + catalog.limit >= catalog.total}
                onClick={() =>
                  router.push(
                    href({
                      releaseId: selectedRelease.id,
                      profileKey,
                      offset: catalog.offset + catalog.limit
                    })
                  )
                }
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  )
}
