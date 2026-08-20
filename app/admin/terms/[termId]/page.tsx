import { db, definitionsTable, termsTable, usersTable } from "@yamz/db"
import { eq, inArray } from "drizzle-orm"
import { RunButton } from "./run"
import { HydrateClient, trpc } from "@/trpc/server"
import { Chats } from "./chats"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeftIcon, ExternalLinkIcon, NetworkIcon } from "lucide-react"
import { auth } from "@/lib/auth"
import { AdminPageHeader } from "../../page-header"
import styles from "../../admin.module.css"
import { definitionPath } from "@/lib/public-identifiers"

export default async function JobPage(props: {
  params: Promise<{ termId: string }>
}) {
  const { user } = await auth()
  if (user?.role !== "admin") redirect("/")

  const params = await props.params
  const termId = Number(params.termId)

  const [term, chats] = await Promise.all([
    db.query.termsTable.findFirst({
      where: eq(termsTable.id, termId),
      with: {
        definitions: {
          // Every machine author, not one anonymous account: AI definitions
          // are owned by per-model identities, so matching a single user id
          // matched nothing.
          where: inArray(
            definitionsTable.authorId,
            db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(eq(usersTable.isAi, true))
          )
        }
      }
    }),
    trpc.admin.chats(termId)
  ])

  const aiDefinition = term?.definitions[0]
  const canRun = chats.at(-1)?.role === "user"

  if (!term) notFound()

  return (
    <HydrateClient>
      <div className={styles.sectionStack}>
        <AdminPageHeader
          title={term.term}
          description="Inspect the term-level AI definition, generation conversation, and recorded provenance."
          actions={
            <Link href="/admin/terms" className={styles.textLink}>
              <ArrowLeftIcon aria-hidden />
              Vocabulary
            </Link>
          }
        />
        <nav className={styles.subnavigation} aria-label="Term administration">
          <Link href={`/admin/terms/${termId}/provenance`}>
            <NetworkIcon aria-hidden className="mr-2 size-4" />
            Provenance
          </Link>
          {aiDefinition && (
            <Link
              href={definitionPath(term.slug, aiDefinition.definitionNumber)}
              className="flex items-center text-primary mb-2"
            >
              <ExternalLinkIcon aria-hidden className="mr-2 size-4" />
              Public definition
            </Link>
          )}
        </nav>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Standing AI definition</h2>
            <span className={styles.panelMeta}>
              Prompt:{" "}
              <span className={styles.codeText}>
                {process.env.SYSTEM_PROMPT
                  ? "raw override"
                  : (process.env.SYSTEM_PROMPT_KEY ?? "not selected")}
              </span>
            </span>
          </div>
          {aiDefinition && (
            <dl className="grid gap-5 px-5 py-4 text-sm">
              <div>
                <dt className="mb-1 text-xs font-medium text-muted-foreground">
                  Definition
                </dt>
                <dd className="leading-6">{aiDefinition.definition}</dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium text-muted-foreground">
                  Example
                </dt>
                <dd className="leading-6">{aiDefinition.example}</dd>
              </div>
            </dl>
          )}
          {!aiDefinition && (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No term-level AI definition has been published.
            </p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Generation conversation</h2>
          </div>
          <Chats termId={termId} initialData={chats} />
          <div className={styles.panelFooter}>
            <RunButton termId={termId} canRun={canRun} />
          </div>
        </section>
      </div>
    </HydrateClient>
  )
}
