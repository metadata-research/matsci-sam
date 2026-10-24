import type { MatcoreSpecification } from "./matcore-workflow-types"

export type FieldDataType = Exclude<MatcoreSpecification["valueType"], "list">
export type FieldValueForm = NonNullable<MatcoreSpecification["valueForm"]>

/** Interpret legacy list values without rewriting a draft or its source baseline. */
export function fieldDataType(
  specification: MatcoreSpecification
): FieldDataType {
  return specification.valueType === "list"
    ? "unspecified"
    : specification.valueType
}

export function fieldValueForm(
  specification: MatcoreSpecification
): FieldValueForm {
  return (
    specification.valueForm ??
    (specification.valueType === "list" ? "list" : "unspecified")
  )
}

/** Materialize the legacy form only when the contributor edits a value rule. */
export function withFieldDataType(
  specification: MatcoreSpecification,
  valueType: FieldDataType
): MatcoreSpecification {
  return {
    ...specification,
    valueType,
    valueForm: fieldValueForm(specification)
  }
}

export function withFieldValueForm(
  specification: MatcoreSpecification,
  valueForm: FieldValueForm
): MatcoreSpecification {
  return {
    ...specification,
    valueType: fieldDataType(specification),
    valueForm
  }
}
