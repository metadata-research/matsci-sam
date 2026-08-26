import { db, termsTable } from "@yamz/db"
import { eq } from "drizzle-orm"
import { notFound, permanentRedirect } from "next/navigation"
import { termPath } from "@/lib/public-identifiers"

/*
 * Legacy id-based term URL. The canonical address is /vocabulary/<term> for
 * the default vocabulary or /vocabulary/<vocabulary>/<term> for a community
 * vocabulary. That is the concept IRI published in SKOS, so this 308s there
 * rather than rendering a duplicate page. Existing links, bookmarks, and any
 * previously published /terms/<id> IRI keep resolving.
 *
 * The sub-routes (provenance, tree, skos.ttl, skos.jsonld) stay under this
 * path -- they are representations and views of the concept, not the concept
 * itself, so they are not affected by the IRI change.
 */
export default async function TermByIdPage(props: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await props.params

  const id = Number(termId)
  if (!Number.isInteger(id)) notFound()

  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.id, id)
  })

  if (!term) notFound()

  permanentRedirect(termPath(term.slug, term.vocabularySlug))
}
