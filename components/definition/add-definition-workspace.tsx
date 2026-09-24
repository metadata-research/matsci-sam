"use client"

import { type ReactNode, useId } from "react"
import {
  PaperclipIcon,
  QuoteIcon,
  SearchIcon,
  SparklesIcon,
  XIcon
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type DefinitionView = "simple" | "advanced"
export type DefinitionTool = "wolfram" | "assistant" | "citations" | "files"

/** Both views share one mounted editor and the same grid track. */
export function AddDefinitionWorkspace({
  view,
  onViewChange,
  children,
  tools,
  references
}: {
  view: DefinitionView
  onViewChange: (view: DefinitionView) => void
  children: ReactNode
  tools?: ReactNode
  references?: ReactNode
}) {
  return (
    <Tabs
      value={view}
      onValueChange={(value) => onViewChange(value as DefinitionView)}
      className="@container/add gap-4"
      data-add-workspace
    >
      <div className="flex max-w-[37.5rem] flex-col items-end gap-1">
        <span className="text-xs font-medium text-muted-foreground">View</span>
        <TabsList aria-label="View">
          <TabsTrigger value="simple">Simple</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value={view} forceMount className="m-0">
        <div className="grid min-w-0 items-start gap-5 @min-[40rem]/add:grid-cols-[minmax(0,1.5fr)_minmax(14rem,1fr)] @min-[57.5rem]/add:grid-cols-[37.5rem_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4" data-add-main>
            {children}
            {tools}
          </div>
          <aside
            hidden={view !== "advanced"}
            className="min-w-0"
            aria-label="Matching terms and ontology context"
            data-add-references
          >
            {references}
          </aside>
        </div>
      </TabsContent>
    </Tabs>
  )
}

const commands = [
  { value: "wolfram", label: "Wolfram lookup", icon: SearchIcon },
  { value: "assistant", label: "AI assistance", icon: SparklesIcon },
  { value: "citations", label: "Add citation", icon: QuoteIcon },
  { value: "files", label: "Attach file", icon: PaperclipIcon }
] as const

/** Tool labels name the mounted panels; switching never resets tool inputs. */
export function DefinitionToolbox({
  view,
  active,
  onSelect,
  panels,
  disabled = false
}: {
  view: DefinitionView
  active: DefinitionTool | null
  onSelect: (tool: DefinitionTool | null) => void
  panels: Record<DefinitionTool, ReactNode>
  disabled?: boolean
}) {
  const id = useId()
  const advanced = view === "advanced"
  const selected = commands.find((command) => command.value === active)
  return (
    <Card
      hidden={!advanced && !active}
      className="min-w-0 gap-0 overflow-hidden py-0"
      data-definition-toolbox
    >
      <CardHeader
        className="flex flex-wrap items-center gap-1 px-3 py-2"
        role="group"
        aria-label="Tools"
      >
        <CardTitle className={advanced ? "sr-only" : "mr-auto"}>
          {advanced ? "Tools" : selected?.label}
        </CardTitle>
        {advanced ? (
          commands.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              id={`${id}-${value}-command`}
              type="button"
              variant={active === value ? "secondary" : "ghost"}
              size="sm"
              disabled={disabled}
              aria-expanded={active === value}
              aria-controls={`${id}-${value}-panel`}
              onClick={() => onSelect(active === value ? null : value)}
            >
              <Icon aria-hidden data-icon="inline-start" />
              {label}
            </Button>
          ))
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(null)}
            aria-label="Close tool"
          >
            <XIcon aria-hidden data-icon="inline-start" />
            Close
          </Button>
        )}
      </CardHeader>
      <Separator hidden={!active} />
      {commands.map(({ value, label }) => (
        <CardContent
          key={value}
          id={`${id}-${value}-panel`}
          role="region"
          aria-label={label}
          hidden={active !== value}
          className="min-w-0 p-4 sm:p-5"
        >
          {panels[value]}
        </CardContent>
      ))}
    </Card>
  )
}
