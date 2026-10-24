"use client"

import type { MatcoreSpecification } from "@/lib/matcore-workflow-types"
import {
  fieldDataType,
  fieldValueForm,
  withFieldDataType,
  withFieldValueForm,
  type FieldDataType,
  type FieldValueForm
} from "@/lib/metadata-field-rules"
import { InfoPopover } from "@/components/info-popover"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { WorkspaceSelect } from "./workspace-select"
import {
  dataTypeLabels,
  profileLabel,
  repeatabilityLabels,
  requirementLabels,
  valueFormLabels
} from "./workspace-presenters"

export function FieldRuleControls({
  specification,
  profileKey,
  baseline,
  onChange
}: {
  specification: MatcoreSpecification
  profileKey: string | null
  baseline?: MatcoreSpecification | null
  onChange(value: MatcoreSpecification): void
}) {
  return (
    <FieldGroup className="grid gap-5 sm:grid-cols-2" aria-label="Field rules">
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="field-requirement">
            Requirement{profileKey ? ` in ${profileLabel(profileKey)}` : ""}
          </FieldLabel>
          <InfoPopover label="About field requirements">
            A required child field must be supplied when its parent is present.
            Record other conditions below. Not specified means no rule has been
            established.
          </InfoPopover>
        </div>
        <WorkspaceSelect
          id="field-requirement"
          value={specification.requirement}
          onChange={(event) =>
            onChange({
              ...specification,
              requirement: event.target
                .value as MatcoreSpecification["requirement"]
            })
          }
        >
          {Object.entries(requirementLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </WorkspaceSelect>
        {baseline ? (
          <FieldDescription>
            Source: {requirementLabels[baseline.requirement]}
          </FieldDescription>
        ) : null}
      </Field>
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="field-repeatability">
            Repeatable field
          </FieldLabel>
          <InfoPopover label="About repeatable fields">
            Whether the field can occur more than once. A single field can
            contain several values when its value form is List or Array.
          </InfoPopover>
        </div>
        <WorkspaceSelect
          id="field-repeatability"
          value={specification.repeatability}
          onChange={(event) =>
            onChange({
              ...specification,
              repeatability: event.target
                .value as MatcoreSpecification["repeatability"]
            })
          }
        >
          {Object.entries(repeatabilityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </WorkspaceSelect>
        {baseline ? (
          <FieldDescription>
            Source: {repeatabilityLabels[baseline.repeatability]}
          </FieldDescription>
        ) : null}
      </Field>
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="field-value-type">Data type</FieldLabel>
          <InfoPopover label="About data types">
            The kind of value, such as text or a number. For a list or array,
            choose the type of its items when known.
          </InfoPopover>
        </div>
        <WorkspaceSelect
          id="field-value-type"
          value={fieldDataType(specification)}
          onChange={(event) =>
            onChange(
              withFieldDataType(
                specification,
                event.target.value as FieldDataType
              )
            )
          }
        >
          {Object.entries(dataTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </WorkspaceSelect>
        {baseline ? (
          <FieldDescription>
            Source: {dataTypeLabels[fieldDataType(baseline)]}
          </FieldDescription>
        ) : null}
      </Field>
      <Field>
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor="field-value-form">Value form</FieldLabel>
          <InfoPopover label="About value forms">
            Single value holds one item. List holds several items. Array holds
            values arranged by dimensions, such as a matrix. This does not
            determine whether the field itself is repeatable.
          </InfoPopover>
        </div>
        <WorkspaceSelect
          id="field-value-form"
          value={fieldValueForm(specification)}
          onChange={(event) =>
            onChange(
              withFieldValueForm(
                specification,
                event.target.value as FieldValueForm
              )
            )
          }
        >
          {Object.entries(valueFormLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </WorkspaceSelect>
        {baseline ? (
          <FieldDescription>
            Source: {valueFormLabels[fieldValueForm(baseline)]}
          </FieldDescription>
        ) : null}
      </Field>
      {specification.requirement === "conditional" ||
      specification.condition ? (
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="field-condition">
            Requirement condition
          </FieldLabel>
          <Textarea
            id="field-condition"
            value={specification.condition}
            maxLength={2000}
            rows={2}
            onChange={(event) =>
              onChange({ ...specification, condition: event.target.value })
            }
            placeholder="Describe when the field is required."
          />
          {baseline?.condition ? (
            <FieldDescription>Source: {baseline.condition}</FieldDescription>
          ) : null}
        </Field>
      ) : null}
    </FieldGroup>
  )
}
