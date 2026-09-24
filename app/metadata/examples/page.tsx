import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Metadata examples | ${SITE_NAME}` }

const examples = [
  {
    id: "density-functional-theory",
    title: "Density functional theory",
    source: "MatCore · 2025 preliminary snapshot",
    description:
      "A method concept that can supply a value for a computational metadata field.",
    term: "Density functional theory (DFT)",
    field: "Method",
    fieldPath: "/metadata/matcore#method",
    usage:
      "Use this term when the reported computational method is density functional theory. Record the functional and calculation settings separately.",
    record: "Example dataset → Method → Density functional theory",
    caveat:
      "The dictionary explains DFT and its use. The dataset record would describe one particular calculation."
  },
  {
    id: "atomic-layer-deposition",
    title: "Atomic layer deposition",
    source: "Experimental methods · local proposal",
    description:
      "A processing concept that can be used in a laboratory metadata profile.",
    term: "Atomic layer deposition (ALD)",
    field: "Processing method",
    fieldPath: "/metadata/experimental#processing-method",
    usage:
      "Use for the process performed in the described activity. Identify the material, equipment, precursors and conditions separately for the actual experiment.",
    record:
      "Example processing activity → Processing method → Atomic layer deposition",
    caveat:
      "Inspired by ICoN-PCL’s experimental setting. This example is a local proposal, not an official ICoN-PCL metadata record."
  },
  {
    id: "deposition-temperature",
    title: "Deposition temperature",
    source: "Experimental methods · local proposal",
    description: "A dictionary entry can also explain a field itself.",
    term: "Deposition temperature",
    field: "Deposition temperature",
    fieldPath: "/metadata/experimental#deposition-temperature",
    usage:
      "Specify what is being measured or controlled: for example, the substrate temperature. A reported value needs a unit and the activity it describes.",
    record:
      "Example processing activity → Deposition temperature → 200 °C (illustrative substrate setpoint)",
    caveat:
      "The numerical temperature belongs to a particular activity. It is not a property of the general ALD concept."
  }
] as const

export default function MetadataExamplesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/metadata/fields"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          Metadata fields
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          From terms to metadata
        </h1>
        <p className="text-muted-foreground">
          Three examples show what belongs in the dictionary and what belongs in
          a research record.
        </p>
        <p className="text-sm">
          These are illustrative examples. They do not create entries, publish
          relationships, or store research records.
        </p>
      </header>
      {examples.map((example) => (
        <Card key={example.id} id={example.id} className="scroll-mt-24">
          <CardHeader>
            <Badge
              variant="secondary"
              className="w-fit max-w-full whitespace-normal"
            >
              {example.source}
            </Badge>
            <CardTitle>
              <h2>{example.title}</h2>
            </CardTitle>
            <CardDescription>{example.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 text-sm">
            <dl className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="font-medium">Dictionary entry</dt>
              <dd>{example.term}</dd>
              <dt className="font-medium">
                {example.id === "deposition-temperature"
                  ? "Describes a field"
                  : "Used as a value for"}
              </dt>
              <dd>
                <Link
                  href={example.fieldPath}
                  className="underline underline-offset-4"
                >
                  {example.field}
                </Link>
              </dd>
              <dt className="font-medium">Usage note</dt>
              <dd>{example.usage}</dd>
            </dl>
            <div className="rounded-lg bg-muted p-4">
              <p className="mb-2 font-medium">Illustrative research record</p>
              <p className="break-words">{example.record}</p>
            </div>
            <p className="text-muted-foreground">{example.caveat}</p>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm">
        Ontology placement can be useful context for any of these entries.
        Previewing an ontology does not save a relationship. Choose an explicit
        related-concept link when you want to retain it, with its source
        recorded independently of the definition.
      </p>
    </main>
  )
}
