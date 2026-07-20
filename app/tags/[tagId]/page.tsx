import { TermDefinition } from "@/components/term/preview";
import { Card } from "@/components/ui/card";
import {
  db,
  definitionsTable,
  tagsTable,
  tagsToDefinitions,
  termsTable,
} from "@yamz/db";
import { eq } from "drizzle-orm";
import Link from "next/link";

export default async function TagPage({
  params,
}: {
  params: Promise<{ tagId: string }>;
}) {
  const tagId = Number((await params).tagId);

  const [tag] = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.id, tagId))
    .limit(1);
  const terms = await db
    .select()
    .from(tagsToDefinitions)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, tagsToDefinitions.definitionId),
    )
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .where(eq(tagsToDefinitions.tagId, tagId));

  return (
    <main className="max-w-2xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Definitions Tagged with {tag.name}</h1>
      {/* Curated knowledge-organization layer: a tag may assert a SKOS
          mapping to a class in an external ontology (see lib/skos.ts) */}
      {tag.mappingIri && (
        <p className="text-sm text-muted-foreground">
          skos:{tag.mappingRelation ?? "closeMatch"}{" "}
          <a
            href={tag.mappingIri}
            className="text-primary font-mono break-all"
            rel="noreferrer"
          >
            {tag.mappingIri}
          </a>
        </p>
      )}
      {terms.map((t) => (
        <Link key={t.definitions.id} href={`/definition/${t.definitions.id}`}>
          <Card className="!p-2">
            <h2 className="text-lg font-semibold">{t.terms.term}</h2>
            <TermDefinition definition={t.definitions} />
          </Card>
        </Link>
      ))}
    </main>
  );
}
