import type {
  DeclaredImportSource,
  RevisionImportReceipt
} from "./import-draft-types"
import type { ProvEdge, ProvNode } from "./provenance"

export type PublicImportOrigin = {
  parserVersion: string
  importedAt: string
  originalWording: { term: string; definition: string } | null
  declaredOrigin: DeclaredImportSource | null
}

export type ManualCitationEvidence = {
  title: string
  creator: string
  url: string
  version: string
  license: string
}

// Explicit projections: never serialize a private batch, filename, unreviewed
// candidate, account identifier, private content hash or future receipt field to
// public consumers. Hashes of omitted input can still disclose its identity.
export function publicDeclaredSource(
  source: DeclaredImportSource
): ManualCitationEvidence {
  return {
    title: source.title,
    creator: source.creator,
    url: source.url,
    version: source.version,
    license: source.license
  }
}

export function publicImportOrigin(
  receipt: RevisionImportReceipt
): PublicImportOrigin {
  return {
    parserVersion: receipt.parserVersion,
    importedAt: receipt.importedAt,
    originalWording:
      receipt.publishOriginalWording === true
        ? { term: receipt.originalTerm, definition: receipt.originalDefinition }
        : null,
    declaredOrigin: receipt.declaredOrigin
      ? publicDeclaredSource(receipt.declaredOrigin)
      : null
  }
}

/** Import origin is derivation evidence, not a citation or a model request. */
export function importOriginProvenance(
  origin: PublicImportOrigin,
  revisionNodeId: string,
  importerNodeId: string | null
): { nodes: ProvNode[]; edges: ProvEdge[] } {
  const activityId = `import_${revisionNodeId}`
  const rowId = `import_row_${revisionNodeId}`
  const source = origin.declaredOrigin
  const nodes: ProvNode[] = [
    {
      id: activityId,
      type: "activity",
      label: "Import term",
      meta: {
        importedAt: origin.importedAt,
        parserVersion: origin.parserVersion,
        evidenceBasis: "recorded_import"
      }
    },
    {
      id: rowId,
      type: "entity",
      label: origin.originalWording
        ? `Imported wording: ${origin.originalWording.term}`
        : "Imported source record",
      ...(origin.originalWording
        ? { detail: origin.originalWording.definition }
        : {}),
      meta: {
        ...(source
          ? {
              sourceTitle: source.title,
              sourceCreator: source.creator,
              sourceIri: source.url,
              sourceVersion: source.version,
              sourceLicense: source.license,
              evidenceBasis: "contributor_declared_origin"
            }
          : {})
      }
    }
  ]
  const edges: ProvEdge[] = [
    {
      id: `${rowId}_generated`,
      source: rowId,
      target: activityId,
      rel: "wasGeneratedBy"
    },
    {
      id: `${revisionNodeId}_imported_from`,
      source: revisionNodeId,
      target: rowId,
      rel: "wasDerivedFrom"
    }
  ]
  if (importerNodeId)
    edges.push({
      id: `${activityId}_importer`,
      source: activityId,
      target: importerNodeId,
      rel: "wasAssociatedWith"
    })
  return { nodes, edges }
}
