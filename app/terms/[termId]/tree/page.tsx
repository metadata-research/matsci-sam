import { Definition } from "@/components/definition"
import { db, termsTable } from "@/drizzle"
import { HydrateClient, trpc } from "@/trpc/server"
import { eq } from "drizzle-orm"
import { MessageCircleIcon, PenIcon } from "lucide-react"
import { notFound } from "next/navigation"

export default async function TermTreePage(props: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await props.params

  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.id, Number(termId))
  })

  if (!term) notFound()

  const tree = await trpc.terms.tree({ termId: term.id })

  return (
    <HydrateClient>
      <main className="px-4 p-8">
        <section className="w-full">
          <h1 className="text-5xl font-bold mb-4">{term.term}</h1>
        </section>
        {tree.map((definition) => (
          <section className="flex items-stretch group" key={definition.id}>
            <div className="w-8 relative">
              <div className="absolute top-0 -bottom-4 left-1/2 -translate-x-1/2 bg-foreground h-full w-1 group-last:bottom-auto group-last:h-5" />
              <div className="absolute top-4 left-1/2 w-1/2 h-1 bg-foreground" />
            </div>
            <div className="flex-1 pb-4">
              <Definition
                definition={{ ...definition, author: definition.author?.name }}
              />
              {definition.history.map((history, index) => (
                <div className="flex items-stretch group" key={history.id}>
                  <div className="w-8 shrink-0 relative">
                    <div className="rounded-full z-10 bg-secondary border size-6 flex items-center justify-center absolute left-1/2 -translate-x-1/2 top-2">
                      {history.type == "edit" && <PenIcon className="size-3" />}
                      {history.type == "comment" && (
                        <MessageCircleIcon className="size-3" />
                      )}
                    </div>
                    {index == definition.history.length - 1 ? (
                      <div className="bg-secondary-foreground opacity-50 z-0 h-6 w-1 left-1/2 -translate-x-1/2 absolute" />
                    ) : (
                      <div className="bg-secondary-foreground opacity-50 z-0 inset-y-0 h-full w-1 left-1/2 -translate-x-1/2 absolute" />
                    )}
                  </div>
                  <div className="min-h-8 pt-3 flex-1">
                    {history.type == "comment" && (
                      <>
                        <p className="text-xs font-semibold opacity-80">
                          COMMENT
                        </p>
                        {history.message}
                      </>
                    )}
                    {history.type == "edit" && (
                      <>
                        <p className="text-xs font-semibold opacity-80">
                          DEFINITION CHANGED
                        </p>
                        <span className="italic">From</span>:{" "}
                        {history.definition} <br />
                        <span className="italic">To</span>:{" "}
                        {history.newDefinition}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </HydrateClient>
  )
}
