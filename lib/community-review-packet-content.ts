import {
  dataTypeLabels,
  repeatabilityLabels,
  requirementLabels,
  valueFormLabels
} from "../components/metadata-workspace/workspace-presenters"
import { fieldDataType, fieldValueForm } from "./metadata-field-rules"
import type { MatcoreDraftPayload } from "./matcore-workflow-types"
import type { ReviewPacketContent } from "./community-review-packet-types"

/** Interpret published rules exactly as the field UI does, without rewriting them. */
export function reviewPacketContent(
  payload: MatcoreDraftPayload
): ReviewPacketContent {
  const specification = payload.specification
  const missing = specification.guidance.trim()
    ? "Not recorded separately"
    : "Not specified"
  const dataType = fieldDataType(specification)
  const valueForm = fieldValueForm(specification)
  const rows: [string, string][] = [
    ["Field path", specification.path],
    [
      "Data type",
      dataType === "unspecified" ? missing : dataTypeLabels[dataType]
    ],
    [
      "Value form",
      valueForm === "unspecified" ? missing : valueFormLabels[valueForm]
    ],
    ["Format", specification.format],
    [
      "Requirement",
      specification.requirement === "unspecified"
        ? missing
        : requirementLabels[specification.requirement]
    ],
    ["Condition", specification.condition],
    [
      "Repeatable",
      specification.repeatability === "unspecified"
        ? missing
        : repeatabilityLabels[specification.repeatability]
    ],
    ["Units", specification.units],
    ["Allowed values", specification.allowedValues.join("\n")],
    ["Example values", specification.examples.join("\n")],
    ["Value guidance", specification.guidance],
    ["Notes", specification.notes ?? ""]
  ]
  return {
    label: payload.label,
    definition: payload.definition,
    example: payload.example,
    rules: rows.map(([label, value]) => ({ label, value }))
  }
}
