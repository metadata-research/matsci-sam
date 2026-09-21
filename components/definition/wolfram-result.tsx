"use client"

import { useMemo } from "react"
import { CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow
} from "@/components/ui/table"
import {
  parseWolframResult,
  wolframSectionCopyText
} from "@/lib/wolfram-result-format"

export function WolframResult({
  text,
  onCopySection,
  copyDisabled = false
}: {
  text: string
  onCopySection?: (text: string) => void
  copyDisabled?: boolean
}) {
  const { sections } = useMemo(() => parseWolframResult(text), [text])
  const ordered = [
    ...sections.filter((section) => section.kind === "interpretation"),
    ...sections.filter((section) => section.kind === "assumptions"),
    ...sections.filter(
      (section) =>
        section.kind !== "interpretation" && section.kind !== "assumptions"
    )
  ]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ordered.map((section, index) => {
        const heading =
          section.kind === "interpretation"
            ? "Interpreted as"
            : (section.title ?? "Result")
        return (
          <section
            key={index}
            aria-label={heading}
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="break-words text-sm font-medium">{heading}</h4>
              {onCopySection && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Copy ${heading}`}
                  disabled={copyDisabled}
                  onClick={() =>
                    onCopySection(wolframSectionCopyText(section, sections))
                  }
                >
                  <CopyIcon data-icon="inline-start" aria-hidden />
                  Copy section
                </Button>
              )}
            </div>
            {section.blocks.map((block, blockIndex) =>
              block.kind === "text" ? (
                <p
                  key={blockIndex}
                  className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]"
                >
                  {block.text}
                </p>
              ) : (
                <Table
                  key={blockIndex}
                  aria-label={heading}
                  className="table-fixed"
                >
                  <TableBody>
                    {block.rows.map(([property, value], rowIndex) => (
                      <TableRow key={rowIndex}>
                        <TableHead
                          scope="row"
                          className="w-2/5 align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                        >
                          {property}
                        </TableHead>
                        <TableCell className="align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
          </section>
        )
      })}
      <details className="min-w-0">
        <summary className="cursor-pointer text-sm font-medium">
          Original response
        </summary>
        <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
          {text}
        </pre>
      </details>
    </div>
  )
}
