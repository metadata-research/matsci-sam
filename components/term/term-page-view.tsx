"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { OntologyContextPanel } from "@/components/ontology-context-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type TermView = "simple" | "advanced"
const TermViewContext = createContext<TermView>("simple")

/** One mounted reader: a presentation change must not reset votes or disclosures. */
export function TermPageView({
  heading,
  children
}: {
  heading: ReactNode
  children: ReactNode
}) {
  const [view, setView] = useState<TermView>("simple")
  return (
    <TermViewContext.Provider value={view}>
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as TermView)}
        className="gap-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">{heading}</div>
          <div className="flex shrink-0 flex-col items-end gap-1 self-end">
            <span className="text-xs font-medium text-muted-foreground">
              View
            </span>
            <TabsList aria-label="Term view">
              <TabsTrigger value="simple">Simple</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent value={view} forceMount className="m-0">
          {children}
        </TabsContent>
      </Tabs>
    </TermViewContext.Provider>
  )
}

/** Keep descendants mounted, including expanded source details and curator UI. */
export function TermAdvancedDetails({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  const view = useContext(TermViewContext)
  return (
    <div hidden={view !== "advanced"} className={className}>
      {children}
    </div>
  )
}

export function TermOntologyContext({ term }: { term: string }) {
  const advanced = useContext(TermViewContext) === "advanced"
  return (
    <aside
      hidden={!advanced}
      className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2"
      aria-label="Ontology context"
    >
      <OntologyContextPanel term={term} enabled={advanced} />
    </aside>
  )
}
