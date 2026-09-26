import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Metadata fields | ${SITE_NAME}` }

export default function MetadataFieldsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex max-w-3xl flex-col gap-3">
        <p className="text-muted-foreground text-sm">Metadata dictionary</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Metadata fields
        </h1>
        <p className="text-muted-foreground text-lg">
          Understand a field, find terms that can supply its values, and explain
          how those terms are used.
        </p>
        <p className="text-sm leading-relaxed">
          A dictionary entry explains a concept such as density functional
          theory. A metadata field such as Method names a detail to record. A
          research record supplies the value for a particular dataset or
          experiment.
        </p>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="secondary" className="w-fit">
              2025 preliminary snapshot
            </Badge>
            <CardTitle>
              <h2>MatCore</h2>
            </CardTitle>
            <CardDescription>Computational materials science</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              The 18 common fields and 9 DFT fields transcribed from Figures 3
              and 5 of Greenberg et al. (2025).
            </p>
            <p className="text-muted-foreground">
              These preliminary tables are from the paper, not an official
              MatCore release.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/metadata/matcore">Browse MatCore fields</Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <Badge variant="outline" className="w-fit">
              Local proposal
            </Badge>
            <CardTitle>
              <h2>Experimental methods</h2>
            </CardTitle>
            <CardDescription>
              A starting point for laboratory metadata
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              Processing method and deposition temperature demonstrate how the
              dictionary could support experimental work.
            </p>
            <p className="text-muted-foreground">
              Inspired by the research setting described by ICoN-PCL. These
              proposed fields are not an official ICoN-PCL or MatCore standard.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/metadata/experimental">Browse proposed fields</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <section
        className="flex flex-col gap-3"
        aria-labelledby="entry-metadata-heading"
      >
        <h2 id="entry-metadata-heading" className="text-xl font-semibold">
          Connect a term to its use
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed">
          Open a dictionary entry and choose Metadata. Simple view adds usage
          notes and links to fields for the whole term. Advanced view adds a
          choice of definition, sources, alternative names, and related external
          concepts. Both views describe the same entry.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/vocabulary">Find a dictionary entry</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/metadata/examples">See examples</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
