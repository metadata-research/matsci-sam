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
import { WorkspaceSelect } from "./workspace-select"
import {
  profileLabel,
  repeatabilityLabels,
  requirementLabels,
  valueTypeLabels
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
  onChange
}: {
  specification: Specification
  profileKey: string | null
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
      <div className="grid gap-6 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="field-value-type" className="min-h-8">
            Value type
          </FieldLabel>
          <WorkspaceSelect
            id="field-value-type"
            value={specification.valueType}
            onChange={(event) =>
              set("valueType", event.target.value as Specification["valueType"])
            }
          >
            {Object.entries(valueTypeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-format" className="min-h-8">
            Format
          </FieldLabel>
          <Input
            id="field-format"
            value={specification.format}
            maxLength={2000}
            onChange={(event) => set("format", event.target.value)}
            placeholder="For example, YYYY-MM-DD"
          />
        </Field>
        <Field>
          <div className="flex items-center gap-1">
            <FieldLabel htmlFor="field-requirement">
              Requirement{profileKey ? ` in ${profileLabel(profileKey)}` : ""}
            </FieldLabel>
            <InfoPopover label="About field requirements">
              A required child field must be supplied when its parent is
              present. Record other conditions below. Not specified means no
              rule has been established.
            </InfoPopover>
          </div>
          <WorkspaceSelect
            id="field-requirement"
            value={specification.requirement}
            onChange={(event) =>
              set(
                "requirement",
                event.target.value as Specification["requirement"]
              )
            }
          >
            {Object.entries(requirementLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
        <Field>
          <div className="flex items-center gap-1">
            <FieldLabel htmlFor="field-repeatability">
              Repeatable field
            </FieldLabel>
            <InfoPopover label="About repeatable fields">
              Whether the field can occur more than once. Choose List as the
              value type when a single field contains several values.
            </InfoPopover>
          </div>
          <WorkspaceSelect
            id="field-repeatability"
            value={specification.repeatability}
            onChange={(event) =>
              set(
                "repeatability",
                event.target.value as Specification["repeatability"]
              )
            }
          >
            {Object.entries(repeatabilityLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
      </div>
      {specification.requirement === "conditional" ||
      specification.condition ? (
        <Field>
          <FieldLabel htmlFor="field-condition">
            Requirement condition
          </FieldLabel>
          <Textarea
            id="field-condition"
            value={specification.condition}
            maxLength={2000}
            rows={2}
            onChange={(event) => set("condition", event.target.value)}
            placeholder="Describe when the field is required, including its parent context."
          />
        </Field>
      ) : null}
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
        </FieldGroup>
      </details>
    </FieldGroup>
  )
}

export function SpecificationSummary({
  specification,
  profileKey
}: {
  specification: Specification
  profileKey: string | null
}) {
  const rows = [
    ...(profileKey ? [["Profile", profileLabel(profileKey)]] : []),
    ["Field path", specification.path],
    ["Value type", valueTypeLabels[specification.valueType]],
    ["Format", specification.format],
    ["Requirement", requirementLabels[specification.requirement]],
    ["Condition", specification.condition],
    ["Repeatable", repeatabilityLabels[specification.repeatability]],
    ["Units", specification.units],
    ["Allowed values", specification.allowedValues.join("\n")],
    ["Example values", specification.examples.join("\n")],
    ["Value guidance", specification.guidance]
  ]
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
            {value || "Not specified"}
          </dd>
        </div>
      ))}
    </dl>
  )
}
