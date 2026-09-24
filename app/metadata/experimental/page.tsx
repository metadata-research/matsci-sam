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
import { getMetadataCatalogFields } from "@/lib/dictionary-metadata"
import { IDENTIFIER_BASE_URL, SITE_NAME } from "@/lib/site"

export const metadata: Metadata = {
  title: `Experimental metadata proposal | ${SITE_NAME}`
}

export default function ExperimentalMetadataPage() {
  const fields = getMetadataCatalogFields(IDENTIFIER_BASE_URL).filter(
    (field) => field.profileKey === "experimental-v1"
  )
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/metadata/fields"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          Metadata fields
        </Link>
        <Badge variant="outline" className="w-fit">
          Local proposal · version 1
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Experimental methods
        </h1>
        <p className="text-muted-foreground">
          Two proposed fields for exploring how dictionary terms support
          laboratory metadata.
        </p>
        <p className="text-sm leading-relaxed">
          The experimental setting takes inspiration from{" "}
          <a
            href="https://icon-pcl.org/"
            className="underline underline-offset-4"
          >
            ICoN-PCL
          </a>
          . The field names and guidance below are MatSci-SAM proposals, not
          requirements published by ICoN-PCL or MatCore. Required status has not
          been assigned.
        </p>
      </header>
      {fields.map((field) => (
        <Card
          key={field.key}
          id={field.iri.split("#")[1]}
          className="scroll-mt-24"
        >
          <CardHeader>
            <CardTitle>
              <h2>{field.label}</h2>
            </CardTitle>
            <CardDescription>{field.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <h2 className="mb-1 font-medium">Value guidance</h2>
              <p>{field.valueGuidance}</p>
            </div>
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                Field identifier
              </summary>
              <p className="mt-2 break-all font-mono text-xs">{field.iri}</p>
            </details>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm">
        <Link
          href="/metadata/examples#atomic-layer-deposition"
          className="underline underline-offset-4"
        >
          See the atomic layer deposition example
        </Link>
      </p>
    </main>
  )
}
