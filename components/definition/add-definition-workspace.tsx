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
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { ViewScope, ViewTabList } from "@/components/interface-view"

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
      <div className="flex max-w-[37.5rem] flex-col items-end">
        <ViewTabList label="Contribution view" onSelect={onViewChange} />
      </div>
      <TabsContent value={view} forceMount className="m-0">
        <ViewScope view={view}>
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
        </ViewScope>
      </TabsContent>
    </Tabs>
  )
}

// Simple opens the tools listed with a simpleLabel from the form. The others
// are Advanced tools.
const commands = [
  { value: "wolfram", label: "Wolfram lookup", icon: SearchIcon },
  { value: "assistant", label: "AI assistance", icon: SparklesIcon },
  { value: "citations", label: "Add citation", icon: QuoteIcon },
  {
    value: "files",
    label: "Attach file",
    simpleLabel: "Attach an example file",
    icon: PaperclipIcon
  }
] as const

export const toolLabel = (tool: DefinitionTool, view: DefinitionView) => {
  const command = commands.find((item) => item.value === tool)!
  return view === "simple" && "simpleLabel" in command
    ? command.simpleLabel
    : command.label
}

const simpleTool = (tool: DefinitionTool | null) =>
  tool !== null &&
  commands.some((item) => item.value === tool && "simpleLabel" in item)

export const toolPanelId = (toolboxId: string, tool: DefinitionTool) =>
  `${toolboxId}-${tool}-panel`

/** Tool labels name the mounted panels. Switching never resets tool inputs. */
export function DefinitionToolbox({
  id: givenId,
  view,
  active,
  onSelect,
  panels,
  disabled = false
}: {
  id?: string
  view: DefinitionView
  active: DefinitionTool | null
  onSelect: (tool: DefinitionTool | null) => void
  panels: Record<DefinitionTool, ReactNode>
  disabled?: boolean
}) {
  const generatedId = useId()
  const id = givenId ?? generatedId
  const advanced = view === "advanced"
  const shown = advanced || simpleTool(active) ? active : null
  return (
    <Card
      hidden={!advanced && !shown}
      className="min-w-0 gap-0 overflow-hidden py-0"
      data-definition-toolbox
    >
      <CardHeader
        className="flex flex-wrap items-center gap-1 px-3 py-2"
        role="group"
        aria-label="Tools"
      >
        <CardTitle className={advanced ? "sr-only" : "mr-auto"}>
          {advanced ? "Tools" : shown ? toolLabel(shown, view) : null}
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
              aria-controls={toolPanelId(id, value)}
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
      <Separator hidden={!shown} />
      {commands.map(({ value }) => (
        <CardContent
          key={value}
          id={toolPanelId(id, value)}
          role="region"
          aria-label={toolLabel(value, view)}
          hidden={shown !== value}
          className="min-w-0 p-4 sm:p-5"
        >
          {panels[value]}
        </CardContent>
      ))}
    </Card>
  )
}
