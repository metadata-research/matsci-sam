"use client"

import Link from "next/link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function WorkspaceError({ reset }: { reset(): void }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <Alert variant="destructive">
        <AlertTitle>The metadata workspace could not be loaded</AlertTitle>
        <AlertDescription>
          Try again to load your saved drafts. Loading this page does not change
          their contents.
        </AlertDescription>
      </Alert>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/metadata/workspace">My field drafts</Link>
        </Button>
      </div>
    </main>
  )
}
