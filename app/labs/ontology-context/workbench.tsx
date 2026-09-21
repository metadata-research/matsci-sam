"use client"

import { useState } from "react"
import { OntologyContextPanel } from "@/components/ontology-context-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function OntologyContextWorkbench() {
  const [term, setTerm] = useState("water")
  const [confirmed, setConfirmed] = useState("")
  const [definition, setDefinition] = useState("")
  return (
    <div className="space-y-5">
      <form
        className="max-w-xl space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          setConfirmed(term.trim())
        }}
      >
        <label
          htmlFor="ontology-preview-term"
          className="block text-sm font-medium"
        >
          Term
        </label>
        <div className="flex items-start gap-2">
          <Input
            id="ontology-preview-term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            maxLength={200}
            required
          />
          <Button type="submit" disabled={!term.trim()}>
            Find matches
          </Button>
        </div>
      </form>
      <div className="grid min-w-0 items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,23rem)]">
        <div className="order-2 min-w-0 space-y-2 md:order-1">
          <label
            htmlFor="ontology-preview-definition"
            className="block text-sm font-medium"
          >
            Definition draft
          </label>
          <Textarea
            id="ontology-preview-definition"
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            className="h-48 max-h-80 resize-y field-sizing-fixed"
            maxLength={10000}
            placeholder="Try writing a definition beside the ontology context."
          />
          <p className="text-xs text-muted-foreground">
            For trying the layout. This draft is not saved.
          </p>
        </div>
        <div className="order-1 min-w-0 md:order-2">
          <OntologyContextPanel term={confirmed} />
        </div>
      </div>
    </div>
  )
}
