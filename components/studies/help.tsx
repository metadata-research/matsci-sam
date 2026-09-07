"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { CircleHelpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { StudyInstructionContent } from "./instruction-content"
import { studyHelpTopic, type StudyHelpSection } from "@/lib/study-help"

export function StudyHelp({
  kind,
  instructions,
  sections
}: {
  kind?: Parameters<typeof studyHelpTopic>[0]
  instructions: string | null
  sections: StudyHelpSection[]
}) {
  const selectId = useId()
  const [topic, setTopic] = useState("instructions")
  const selected = sections.find((section) => section.id === topic)

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          const context = studyHelpTopic(kind)
          setTopic(
            context === "instructions" || sections.some((s) => s.id === context)
              ? context
              : "instructions"
          )
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CircleHelpIcon data-icon="inline-start" />
          Study help
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>Study help</DialogTitle>
          <DialogDescription>
            Read help without leaving your current step. Guide links open in a
            new tab.
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-2">
          <Label htmlFor={selectId}>Help topic</Label>
          <select
            id={selectId}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
          >
            <option value="instructions">This study’s instructions</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </div>
        <div
          key={topic}
          className="min-h-0 overflow-y-auto pr-2"
          tabIndex={0}
          aria-label="Help content"
        >
          {topic === "instructions" ? (
            <div className="flex flex-col gap-4 text-sm">
              <h2 className="font-semibold">This study’s instructions</h2>
              {instructions ? (
                <StudyInstructionContent text={instructions} />
              ) : (
                <p>The study instructions have not been prepared yet.</p>
              )}
            </div>
          ) : selected ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-4 prose-h2:mt-0 prose-table:block prose-table:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: selected.html }}
            />
          ) : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button asChild variant="outline">
            <Link
              href={selected ? `/docs/studies#${selected.id}` : "/docs/studies"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Study guide (new tab)
            </Link>
          </Button>
          <DialogClose asChild>
            <Button type="button">Back to study</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
