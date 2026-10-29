"use client"

import { useEffect, useRef, useState } from "react"
import type { MatCoreDraftPayload } from "@/lib/matcore-workflow-types"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { InfoPopover } from "@/components/info-popover"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FieldRuleControls } from "./field-rule-controls"
import { fieldDataType, fieldValueForm } from "@/lib/metadata-field-rules"
import { Badge } from "@/components/ui/badge"
import {
  profileLabel,
  repeatabilityLabels,
  requirementLabels,
  dataTypeLabels,
  valueFormLabels
} from "./workspace-presenters"

type Specification = MatCoreDraftPayload["specification"]

function TextList({
  id,
  label,
  value,
  onChange,
  maxLength,
  limit
}: {
  id: string
  label: string
  value: string[]
  onChange(value: string[]): void
  maxLength: number
  limit: number
}) {
  const [text, setText] = useState(value.join("\n"))
  const emitted = useRef(JSON.stringify(value))
  const serialized = JSON.stringify(value)
  useEffect(() => {
    // Keep a trailing newline while typing, but restore remote text after the
    // contributor explicitly reloads a saved revision.
    if (serialized !== emitted.current) {
      emitted.current = serialized
      setText((JSON.parse(serialized) as string[]).join("\n"))
    }
  }, [serialized])
  const lines = text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
  const invalid =
    lines.length > limit || lines.some((line) => line.length > maxLength)
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={text}
        rows={3}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.target.value)
          const next = event.target.value
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
          emitted.current = JSON.stringify(next)
          onChange(next)
        }}
      />
      <FieldDescription>
        One value per line. Up to {limit} values, {maxLength} characters each.
      </FieldDescription>
    </Field>
  )
}

export function FieldSpecification({
  specification,
  profileKey,
  baseline,
  onChange
}: {
  specification: Specification
  profileKey: string | null
  baseline?: Specification | null
  onChange(value: Specification): void
}) {
  function set<K extends keyof Specification>(key: K, value: Specification[K]) {
    onChange({ ...specification, [key]: value })
  }
  return (
    <FieldGroup>
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="field-path">Field path</FieldLabel>
          <InfoPopover label="About field paths">
            Include the parent context, for example creator.name.
          </InfoPopover>
        </div>
        <Input
          id="field-path"
          value={specification.path}
          maxLength={500}
          onChange={(event) => set("path", event.target.value)}
        />
      </Field>
      <FieldRuleControls
        specification={specification}
        profileKey={profileKey}
        baseline={baseline}
        onChange={onChange}
      />
      <Field>
        <FieldLabel htmlFor="field-format">Format</FieldLabel>
        <Input
          id="field-format"
          value={specification.format}
          maxLength={2000}
          onChange={(event) => set("format", event.target.value)}
          placeholder="For example, YYYY-MM-DD"
        />
      </Field>
      <details>
        <summary className="cursor-pointer py-2 font-medium">
          More specification details
        </summary>
        <FieldGroup className="pt-4">
          <Field>
            <FieldLabel htmlFor="field-units">Units</FieldLabel>
            <Input
              id="field-units"
              value={specification.units}
              maxLength={2000}
              onChange={(event) => set("units", event.target.value)}
            />
          </Field>
          <TextList
            id="field-allowed-values"
            label="Allowed values"
            value={specification.allowedValues}
            onChange={(value) => set("allowedValues", value)}
            maxLength={500}
            limit={100}
          />
          <TextList
            id="field-examples"
            label="Example values"
            value={specification.examples}
            onChange={(value) => set("examples", value)}
            maxLength={2000}
            limit={20}
          />
          <Field>
            <FieldLabel htmlFor="field-guidance">Value guidance</FieldLabel>
            <Textarea
              id="field-guidance"
              value={specification.guidance}
              maxLength={10000}
              rows={5}
              onChange={(event) => set("guidance", event.target.value)}
            />
            <FieldDescription>
              Keep explanatory guidance separate from a formal requirement.
              Describe inherited or contextual rules when they are not
              represented above.
            </FieldDescription>
          </Field>
          <Field>
            <div className="flex items-center gap-1">
              <FieldLabel htmlFor="field-notes">Notes</FieldLabel>
              <InfoPopover label="About field notes">
                Additional context or exceptions. Required values and other
                rules belong in their named fields.
              </InfoPopover>
            </div>
            <Textarea
              id="field-notes"
              value={specification.notes ?? ""}
              maxLength={10000}
              rows={3}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </FieldGroup>
      </details>
      {baseline ? (
        <SpecificationComparison
          specification={specification}
          baseline={baseline}
        />
      ) : null}
    </FieldGroup>
  )
}

function coreRuleRows(specification: Specification): [string, string][] {
  const missing = specification.guidance.trim()
    ? "Not recorded separately"
    : "Not specified"
  return [
    [
      "Requirement",
      specification.requirement === "unspecified"
        ? missing
        : requirementLabels[specification.requirement]
    ],
    [
      "Repeatable",
      specification.repeatability === "unspecified"
        ? missing
        : repeatabilityLabels[specification.repeatability]
    ],
    [
      "Data type",
      fieldDataType(specification) === "unspecified"
        ? missing
        : dataTypeLabels[fieldDataType(specification)]
    ],
    [
      "Value form",
      fieldValueForm(specification) === "unspecified"
        ? missing
        : valueFormLabels[fieldValueForm(specification)]
    ]
  ]
}

function specificationRows(specification: Specification): [string, string][] {
  return [
    ["Value guidance", specification.guidance],
    ["Field path", specification.path],
    ...coreRuleRows(specification),
    ["Format", specification.format],
    ["Condition", specification.condition],
    ["Units", specification.units],
    ["Allowed values", specification.allowedValues.join("\n")],
    ["Example values", specification.examples.join("\n")],
    ["Notes", specification.notes ?? ""]
  ]
}

export function SpecificationSummary({
  specification,
  profileKey,
  compact = false
}: {
  specification: Specification
  profileKey: string | null
  compact?: boolean
}) {
  const rows = compact
    ? coreRuleRows(specification)
    : [
        ...(profileKey ? [["Profile", profileLabel(profileKey)]] : []),
        ...specificationRows(specification)
      ]
  return (
    <dl
      className={
        compact
          ? "grid grid-cols-2 gap-x-4 gap-y-3"
          : "grid gap-4 sm:grid-cols-2"
      }
      aria-label={compact ? "Field rules" : "Field specification"}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          className={
            label === "Value guidance" ? "min-w-0 sm:col-span-2" : "min-w-0"
          }
        >
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
            {value || "Not specified"}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Keep the common field rules visible while retaining the full specification. */
export function FieldRuleOverview({
  specification,
  profileKey,
  compact = false
}: {
  specification: Specification
  profileKey: string | null
  compact?: boolean
}) {
  return (
    <div className="min-w-0">
      <SpecificationSummary
        specification={specification}
        profileKey={profileKey}
        compact
      />
      <details
        className={compact ? "mt-2 border-t" : "mt-4 rounded-md border px-4"}
      >
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
          {specification.guidance.trim()
            ? "Value guidance and field rules"
            : "All field rules"}
        </summary>
        <div className="pb-4 pt-2">
          <SpecificationSummary
            specification={specification}
            profileKey={profileKey}
          />
        </div>
      </details>
    </div>
  )
}

export function SpecificationComparison({
  specification,
  baseline,
  currentLabel = "Proposal"
}: {
  specification: Specification
  baseline: Specification
  currentLabel?: string
}) {
  const source = new Map(specificationRows(baseline))
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer font-medium">
        Compare with source rules
      </summary>
      <dl
        className="mt-4 flex flex-col gap-4"
        aria-label="Source and proposal field rules"
      >
        {specificationRows(specification).map(([label, value]) => {
          const original = source.get(label) ?? ""
          return (
            <div
              key={label}
              className="flex min-w-0 flex-col gap-2 border-t pt-3"
            >
              <dt className="flex items-center gap-2 text-sm font-medium">
                {label}
                {original !== value ? (
                  <Badge variant="secondary">Changed</Badge>
                ) : null}
              </dt>
              <dd className="grid min-w-0 grid-cols-2 gap-4 text-sm">
                <div className="min-w-0">
                  <p className="text-muted-foreground">Source</p>
                  <p className="whitespace-pre-wrap break-words">
                    {original ||
                      (label === "Notes" && baseline.notes === undefined
                        ? "Not recorded separately"
                        : "Not specified")}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground">{currentLabel}</p>
                  <p className="whitespace-pre-wrap break-words">
                    {value || "Not specified"}
                  </p>
                </div>
              </dd>
            </div>
          )
        })}
      </dl>
    </details>
  )
}
