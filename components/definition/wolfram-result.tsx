"use client"

import { useMemo } from "react"
import { CopyIcon, ExternalLinkIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  parseWolframResult,
  wolframReadingText,
  wolframResultPresentation,
  wolframSectionReadingText,
  type WolframResultSection
} from "@/lib/wolfram-result-format"

type SectionActions = {
  onCopySection?: (text: string) => void
  onAddSection?: (text: string) => void
  copyDisabled?: boolean
  addDisabled?: boolean
}

/** Use real subscripts where Unicode has no equivalent Latin letter. */
function ScientificText({
  text,
  literal = false
}: {
  text: string
  literal?: boolean
}) {
  if (literal) return text
  const readable = wolframReadingText(text)
  return readable
    .split(/(\b(?:T_[bc]|P_c)\b|Δ_(?:fg|fh|vaph|fush|vap|fus)(?:\^⊖)?|\bs\^⊖)/g)
    .map((part, index) => {
      const variable = /^(T|P|Δ)_([a-z]+)(?:\^(⊖))?$/.exec(part)
      if (variable)
        return (
          <span key={index}>
            {variable[1]}
            <sub>{variable[2]}</sub>
            {variable[3] ? <sup>{variable[3]}</sup> : null}
          </span>
        )
      if (part === "s^⊖")
        return (
          <span key={index}>
            s<sup>⊖</sup>
          </span>
        )
      return part
    })
}

function SectionContent({ section }: { section: WolframResultSection }) {
  const heading = section.title ?? "Result"
  return section.blocks.map((block, blockIndex) => {
    if (block.kind === "text")
      return (
        <p
          key={blockIndex}
          className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]"
        >
          {wolframReadingText(block.text)}
        </p>
      )
    const header = block.kind === "table" ? block.header : undefined
    return (
      <Table key={blockIndex} aria-label={heading} className="table-fixed">
        {header ? (
          <TableHeader>
            <TableRow>
              {header.map((cell, index) => (
                <TableHead
                  key={index}
                  scope="col"
                  className="h-auto align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                >
                  <ScientificText text={cell} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        ) : null}
        <TableBody>
          {block.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 && !header ? (
                  <TableHead
                    key={cellIndex}
                    scope="row"
                    className="h-auto w-2/5 align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                  >
                    <ScientificText
                      text={cell}
                      literal={/identifier|SMILES|InChI|registry number/i.test(
                        row[0] ?? ""
                      )}
                    />
                  </TableHead>
                ) : (
                  <TableCell
                    key={cellIndex}
                    className="align-top whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                  >
                    <ScientificText
                      text={cell}
                      literal={/identifier|SMILES|InChI|registry number/i.test(
                        row[0] ?? ""
                      )}
                    />
                  </TableCell>
                )
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  })
}

function ReadingSection({
  section,
  sections,
  onCopySection,
  onAddSection,
  copyDisabled,
  addDisabled
}: SectionActions & {
  section: WolframResultSection
  sections: WolframResultSection[]
}) {
  const heading = section.title ?? "Result"
  const text = wolframSectionReadingText(section, sections)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionContent section={section} />
      {text && (onCopySection || onAddSection) ? (
        <div className="flex flex-wrap gap-1">
          {onCopySection ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Copy ${heading}`}
              disabled={copyDisabled}
              onClick={() => onCopySection(text)}
            >
              <CopyIcon data-icon="inline-start" aria-hidden />
              Copy section
            </Button>
          ) : null}
          {onAddSection ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Add ${heading} to definition`}
              disabled={addDisabled}
              onClick={() => onAddSection(text)}
            >
              <PlusIcon data-icon="inline-start" aria-hidden />
              Add to definition
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function WolframResult({
  text,
  sourceUrl,
  onChangeInterpretation,
  changeDisabled = false,
  onCopyOriginal,
  ...actions
}: SectionActions & {
  text: string
  sourceUrl: string
  onChangeInterpretation?: () => void
  changeDisabled?: boolean
  onCopyOriginal?: () => void
}) {
  const { sections, alternatives } = useMemo(
    () => parseWolframResult(text),
    [text]
  )
  const presentation = useMemo(
    () => wolframResultPresentation(sections),
    [sections]
  )
  return (
    <div className="flex min-w-0 flex-col gap-5" data-wolfram-reading-view>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {presentation.interpretation.length ? (
            <section
              aria-label="Interpreted as"
              className="flex flex-col gap-1"
            >
              <h4 className="text-sm font-medium">Interpreted as</h4>
              {presentation.interpretation.map((section, index) => (
                <SectionContent key={index} section={section} />
              ))}
            </section>
          ) : null}
          {presentation.assumptions.map((section, index) => (
            <section
              key={index}
              aria-label="Assumptions"
              className="flex flex-col gap-1"
            >
              <SectionContent section={section} />
            </section>
          ))}
          {alternatives.length && onChangeInterpretation ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={changeDisabled}
              onClick={onChangeInterpretation}
            >
              Change interpretation
            </Button>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Open in Wolfram|Alpha
            <ExternalLinkIcon data-icon="inline-end" aria-hidden />
          </a>
        </Button>
      </div>
      {presentation.overview.length ? (
        <section aria-label="Overview" className="flex min-w-0 flex-col gap-4">
          <h4 className="text-sm font-semibold">Overview</h4>
          {presentation.overview.map((section, index) => (
            <section
              key={index}
              aria-label={section.title ?? "Result"}
              className="flex min-w-0 flex-col gap-2"
            >
              <h5 className="text-sm font-medium">
                {section.title ?? "Result"}
              </h5>
              <ReadingSection
                section={section}
                sections={sections}
                {...actions}
              />
            </section>
          ))}
        </section>
      ) : null}
      {presentation.more.length ? (
        <section
          aria-label="More properties"
          className="flex min-w-0 flex-col gap-3"
        >
          <h4 className="text-sm font-semibold">More properties</h4>
          {presentation.more.map((section, index) => (
            <details key={index} className="min-w-0 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {section.title ?? "Additional result"}
              </summary>
              <div className="mt-3">
                <ReadingSection
                  section={section}
                  sections={sections}
                  {...actions}
                />
              </div>
            </details>
          ))}
        </section>
      ) : null}
      {presentation.visual.length ? (
        <p className="text-sm text-muted-foreground">
          Available on Wolfram|Alpha:{" "}
          {presentation.visual
            .map((section) => section.title ?? "additional graphics")
            .join(", ")}
          .
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        The Wolfram link opens a live query. This saved response remains the
        source for citations and assistant context.
      </p>
      <details className="min-w-0">
        <summary className="cursor-pointer text-sm font-medium">
          Original response
        </summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          {onCopyOriginal ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={actions.copyDisabled}
              onClick={onCopyOriginal}
            >
              <CopyIcon data-icon="inline-start" aria-hidden />
              Copy original response
            </Button>
          ) : null}
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
            {text}
          </pre>
        </div>
      </details>
    </div>
  )
}
