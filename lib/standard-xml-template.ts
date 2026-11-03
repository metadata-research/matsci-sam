import type { StandardEntry } from "./community-standard-types"
import { fieldDataType, fieldValueForm } from "./metadata-field-rules"

// XML 1.0 (5th edition) Name, excluding namespace colons.
// https://www.w3.org/TR/xml/#NT-Name
const start =
  "A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}"
const xmlName = new RegExp(
  `^[${start}][${start}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`,
  "u"
)
const invalidCharacter =
  /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

export class XmlTemplateError extends Error {}

/** Comments cannot contain '--'. Text here is commentary, never dataset values. */
function comment(value: string) {
  return `<!-- ${value
    .replace(invalidCharacter, "\uFFFD")
    .replace(/-(?=-)/g, "- ")
    .replace(/\s+/g, " ")
    .trim()} -->`
}

type Node = {
  name: string
  path: string
  entry?: StandardEntry
  children: Map<string, Node>
}

/** Serialize a single profile. No definitions or examples become dataset values. */
export function standardXmlTemplate(
  entries: StandardEntry[],
  header: string[]
) {
  if (!entries.length)
    throw new XmlTemplateError("This section has no fields to export.")
  if (entries.length > 10000)
    throw new XmlTemplateError("This section is too large to export.")
  if (new Set(entries.map((entry) => entry.profileKey)).size !== 1)
    throw new XmlTemplateError("Choose one section to export.")
  const root: Node = { name: "root", path: "", children: new Map() }
  for (const entry of entries) {
    const path = entry.payload.specification.path
    const parts = path.split(".")
    if (
      path.length > 500 ||
      parts.length > 64 ||
      parts.some((part) => !xmlName.test(part))
    )
      throw new XmlTemplateError(
        `The field path "${path}" cannot be used as XML element names. Update the path before exporting.`
      )
    let node = root
    for (const name of parts) {
      let child = node.children.get(name)
      if (!child) {
        child = {
          name,
          path: node.path ? `${node.path}.${name}` : name,
          children: new Map()
        }
        node.children.set(name, child)
      }
      node = child
    }
    if (node.entry)
      throw new XmlTemplateError(
        `More than one field uses "${path}". Resolve the duplicate before exporting.`
      )
    node.entry = entry
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...header.map(comment),
    comment(
      "Dataset metadata template. Replace FILL placeholders with dataset values. FILL* is required within its parent. Remove unused optional elements. Copy repeatable elements with their children as needed. Comments describe field rules, not executable validation."
    ),
    "<root>"
  ]
  const render = (node: Node, depth: number) => {
    const indent = "  ".repeat(depth)
    const spec = node.entry?.payload.specification
    const parent = node.path.split(".").slice(0, -1).join(".")
    // The catalog importer records required child fields with this explicit
    // parent-presence condition. Other free-text conditions stay conditional.
    const required =
      spec?.requirement === "required" ||
      (Boolean(parent) &&
        spec?.requirement === "conditional" &&
        spec.condition === `Required when ${parent} is present.`)
    if (
      spec &&
      node.children.size &&
      !["unspecified", "object"].includes(fieldDataType(spec))
    )
      throw new XmlTemplateError(
        `The field "${node.path}" has both child fields and a scalar data type. Resolve this before exporting.`
      )
    const requirement =
      !spec || spec.requirement === "unspecified"
        ? "Requirement unspecified"
        : required
          ? parent
            ? "REQUIRED within parent"
            : "REQUIRED"
          : spec.requirement[0].toUpperCase() + spec.requirement.slice(1)
    const repetition =
      !spec || spec.repeatability === "unspecified"
        ? "Repeatability unspecified"
        : spec.repeatability === "yes"
          ? "Repeatable"
          : "Not repeatable"
    const rules = [requirement, repetition]
    if (spec) {
      if (fieldDataType(spec) !== "unspecified")
        rules.push(`Data type: ${fieldDataType(spec)}`)
      if (fieldValueForm(spec) !== "unspecified")
        rules.push(`Value form: ${fieldValueForm(spec)}`)
      if (spec.condition) rules.push(`Condition: ${spec.condition}`)
      if (spec.units) rules.push(`Units: ${spec.units}`)
      if (spec.format) rules.push(`Format: ${spec.format}`)
      if (spec.allowedValues.length)
        rules.push(`Allowed values: ${spec.allowedValues.join(", ")}`)
    }
    lines.push(`${indent}${comment(rules.join(". "))}`)
    if (spec?.guidance)
      lines.push(`${indent}${comment(`Value guidance: ${spec.guidance}`)}`)
    if (spec?.notes) lines.push(`${indent}${comment(`Notes: ${spec.notes}`)}`)
    if (node.children.size) {
      lines.push(`${indent}<${node.name}>`)
      for (const child of node.children.values()) render(child, depth + 1)
      lines.push(`${indent}</${node.name}>`)
    } else {
      lines.push(
        `${indent}<${node.name}>${required ? "FILL*" : "FILL"}</${node.name}>`
      )
    }
  }
  for (const node of root.children.values()) render(node, 1)
  lines.push("</root>", "")
  return lines.join("\n")
}
