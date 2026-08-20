export type MatCoreSnapshotStatus = "preliminary"
export type MatCoreProfileKey = "minimal" | "dft"

export type MatCoreSourceSnapshot = Readonly<{
  citationLabel: string
  title: string
  arxivId: string
  arxivVersion: string
  snapshotLabel: string
  publishedDate: string
  sourceUrl: string
  status: MatCoreSnapshotStatus
  transcriptionNotice: string
}>

export type MatCoreProfileSource = Readonly<{
  figure: 3 | 5
  pdfPage: 8 | 10
}>

/*
 * How a MatCore element relates to the Dublin Core property of the same name.
 * The 2025 paper places MatCore in the Dublin Core lineage and observes that
 * core standards map their properties to it, but it publishes no crosswalk, so
 * these relations are read off the element descriptions and stated here rather
 * than claimed as the paper's own.
 *
 * "exact" means the element is that property. "subproperty" means the element
 * narrows it, which is the honest relation where MatCore constrains what the
 * value may be.
 */
export type MatCoreCrosswalk = Readonly<{
  property: string
  relation: "exact" | "subproperty"
}>

export type MatCoreElement<Key extends string = string> = Readonly<{
  sourceKey: string
  key: Key
  label: string
  required: boolean
  description: string
  // Absent where no Dublin Core property carries the same meaning, which is
  // the case for every method-specific element.
  crosswalk?: MatCoreCrosswalk
  // Set where the value should be drawn from the MatSci-SAM vocabulary rather
  // than written free-text. This is the join between the metadata standard and
  // the dictionary.
  rangeIsVocabulary?: boolean
}>

export type MatCoreProfile = Readonly<{
  key: MatCoreProfileKey
  name: string
  profileRequired: boolean
  scopeNote: string
  requirementNote: string
  source: MatCoreProfileSource
  elements: readonly MatCoreElement[]
}>

export const matCoreSourceSnapshot = {
  citationLabel: "Greenberg et al. (2025)",
  title: "Towards MatCore: A Unified Metadata Standard for Materials Science",
  arxivId: "2502.07106",
  arxivVersion: "v1",
  snapshotLabel: "arXiv:2502.07106v1",
  publishedDate: "2025-02-10",
  sourceUrl: "https://arxiv.org/abs/2502.07106v1",
  status: "preliminary",
  transcriptionNotice:
    "This is a MatSci-SAM transcription of preliminary tables in Figures 3 and 5. It is not an official or current MatCore release."
} as const satisfies MatCoreSourceSnapshot

export const minimalMatCoreElements = [
  {
    sourceKey: "creator",
    key: "creator",
    label: "Creator",
    required: true,
    description:
      "Authors who generated the data and their institutional affiliations.",
    crosswalk: { property: "dcterms:creator", relation: "exact" }
  },
  {
    sourceKey: "title",
    key: "title",
    label: "Title",
    required: true,
    description: "Title of the dataset.",
    crosswalk: { property: "dcterms:title", relation: "exact" }
  },
  {
    sourceKey: "date",
    key: "date",
    label: "Date",
    required: true,
    description: "Date or dates when the dataset was created.",
    crosswalk: { property: "dcterms:date", relation: "exact" }
  },
  {
    sourceKey: "description",
    key: "description",
    label: "Description",
    required: true,
    description: "Brief description of the dataset.",
    crosswalk: { property: "dcterms:description", relation: "exact" }
  },
  {
    sourceKey: "disclaimer",
    key: "disclaimer",
    label: "Disclaimer",
    required: false,
    description:
      "Intended uses, applicability, or known limitations supplied by the author."
  },
  {
    sourceKey: "material",
    key: "material",
    label: "Material",
    required: true,
    description:
      "Material represented by the data, including composition or chemistry range, structure, and microstructure.",
    rangeIsVocabulary: true
  },
  {
    sourceKey: "calculation-type",
    key: "calculation-type",
    label: "Calculation type",
    required: true,
    description: "Type of calculation, such as static, dynamic, or sampling."
  },
  {
    sourceKey: "simulation-conditions",
    key: "simulation-conditions",
    label: "Simulation conditions",
    required: true,
    description:
      "Environmental and boundary conditions, including an ensemble and values such as pressure or temperature where applicable."
  },
  {
    sourceKey: "method",
    key: "method",
    label: "Method",
    required: true,
    description:
      "Computational materials-science method used, such as DFT, GW, BSE, molecular dynamics, derivative methods, or machine learning."
  },
  {
    sourceKey: "software-code",
    key: "software-code",
    label: "Software code",
    required: true,
    description:
      "Software name and version used to generate the data, with a DOI when available."
  },
  {
    sourceKey: "software-files",
    key: "software-files",
    label: "Software files",
    required: false,
    description:
      "Input or run files, their description, and suitably sized sample data files when available."
  },
  {
    sourceKey: "Source-citation",
    key: "source-citation",
    label: "Source citation",
    required: false,
    description: "Citation or DOI for sources that describe the data.",
    crosswalk: { property: "dcterms:bibliographicCitation", relation: "exact" }
  },
  {
    sourceKey: "doi",
    key: "doi",
    label: "DOI",
    required: false,
    description:
      "Dataset DOI and repository location when available and distinct from the associated publication.",
    crosswalk: { property: "dcterms:identifier", relation: "subproperty" }
  },
  {
    sourceKey: "funding",
    key: "funding",
    label: "Funding",
    required: false,
    description:
      "Project funding sources, preferably using Crossref funder designations when available."
  },
  {
    sourceKey: "matcore-version",
    key: "matcore-version",
    label: "MatCore version",
    required: true,
    description:
      "Version of the MatCore standard used for the metadata document."
  },
  {
    sourceKey: "matcore-id",
    key: "matcore-id",
    label: "MatCore ID",
    required: true,
    description: "MatCore identifier assigned to the dataset."
  },
  {
    sourceKey: "matcore-date",
    key: "matcore-date",
    label: "MatCore date",
    required: true,
    description: "Date when the MatCore metadata document was created."
  },
  {
    sourceKey: "license",
    key: "license",
    label: "License",
    required: true,
    description: "Dataset license expressed using an SPDX license identifier.",
    crosswalk: { property: "dcterms:license", relation: "subproperty" }
  }
] as const satisfies readonly MatCoreElement[]

export type MinimalMatCoreElementKey =
  (typeof minimalMatCoreElements)[number]["key"]

export const dftMatCoreElements = [
  {
    sourceKey: "xc-functional",
    key: "xc-functional",
    label: "Exchange-correlation functional",
    required: true,
    description:
      "Exchange-correlation functional, such as LDA, GGA, or hybrid, plus relevant parameters such as hybrid mixing."
  },
  {
    sourceKey: "potential",
    key: "potential",
    label: "Potential",
    required: true,
    description:
      "Potential type and details, including all-electron, pseudopotential, or PAW; valence-electron count and pseudopotential identity or type where applicable."
  },
  {
    sourceKey: "calculation-physics",
    key: "calculation-physics",
    label: "Calculation physics",
    required: false,
    description:
      "Physical effects included in the calculation, such as spin polarization, relativistic effects, or noncollinear spin."
  },
  {
    sourceKey: "basis-set",
    key: "basis-set",
    label: "Basis set",
    required: true,
    description:
      "Basis type and its defining parameters, such as plane-wave cutoff or the number and type of localized basis functions."
  },
  {
    sourceKey: "k-points",
    key: "k-points",
    label: "K-points",
    required: false,
    description:
      "Reciprocal-space mesh and type, such as gamma-centered or Monkhorst-Pack, for periodic systems."
  },
  {
    sourceKey: "k-smearing",
    key: "k-smearing",
    label: "K-point smearing",
    required: false,
    description: "Smearing function and reciprocal-space integration algorithm."
  },
  {
    sourceKey: "Self-consistent-field-convergence",
    key: "self-consistent-field-convergence",
    label: "Self-consistent-field convergence",
    required: false,
    description:
      "Self-consistent-field mixing scheme and convergence tolerance."
  },
  {
    sourceKey: "state-occupations",
    key: "state-occupations",
    label: "State occupations",
    required: false,
    description:
      "Special treatment of state occupations, including finite-temperature or DeltaSCF occupations when applicable."
  },
  {
    sourceKey: "relaxation-convergence",
    key: "relaxation-convergence",
    label: "Relaxation convergence",
    required: false,
    description:
      "Convergence criteria used when the dataset results from a structural relaxation."
  }
] as const satisfies readonly MatCoreElement[]

export type DftMatCoreElementKey = (typeof dftMatCoreElements)[number]["key"]

export const matCoreProfiles = [
  {
    key: "minimal",
    name: "Minimal MatCore Metadata",
    profileRequired: true,
    scopeNote: "Applies to every computational dataset in the paper's model.",
    requirementNote:
      "Figure 3 marks 13 of the 18 preliminary elements as required.",
    source: {
      figure: 3,
      pdfPage: 8
    },
    elements: minimalMatCoreElements
  },
  {
    key: "dft",
    name: "DFT method-specific metadata",
    profileRequired: false,
    scopeNote:
      "An optional second-tier profile for density functional theory datasets.",
    requirementNote:
      "If the DFT profile is supplied, Figure 5 marks xc-functional, potential, and basis-set as required within it.",
    source: {
      figure: 5,
      pdfPage: 10
    },
    elements: dftMatCoreElements
  }
] as const satisfies readonly MatCoreProfile[]

type MatCoreExampleValues<Key extends string> = Readonly<Record<Key, string>>

export type SyntheticSiliconDftRecord = Readonly<{
  id: string
  kind: "synthetic"
  title: string
  description: string
  caveat: string
  values: Readonly<{
    minimal: MatCoreExampleValues<MinimalMatCoreElementKey>
    dft: MatCoreExampleValues<DftMatCoreElementKey>
  }>
}>

export const syntheticSiliconDftRecord = {
  id: "synthetic-silicon-dft",
  kind: "synthetic",
  title: "PBE lattice relaxation of diamond-structure silicon",
  description:
    "A static example showing how the preliminary Minimal and DFT profiles can describe one computational dataset.",
  caveat:
    "Synthetic teaching example created by MatSci-SAM. It is not source data from Greenberg et al., a stored dataset record, or validated benchmark data.",
  values: {
    minimal: {
      creator: "Example Researcher, Example Materials Laboratory",
      title: "PBE lattice relaxation of diamond-structure silicon",
      date: "2026-07-24",
      description:
        "Static DFT relaxation of a periodic two-atom primitive silicon cell to estimate its equilibrium lattice parameter.",
      disclaimer:
        "Synthetic teaching example; not validated benchmark data and not suitable for quantitative comparison.",
      material:
        "Elemental silicon, Si; diamond-cubic crystal structure, space group Fd-3m; periodic primitive cell; no microstructure represented.",
      "calculation-type": "Static structural relaxation",
      "simulation-conditions":
        "Three-dimensional periodic boundaries, neutral cell, electronic ground state at 0 K, target external pressure 0 kbar.",
      method: "DFT",
      "software-code": "Quantum ESPRESSO pw.x, version 7.2",
      "software-files":
        "Input deck, pseudopotential file identifier and checksum, relaxed structure, and text output would accompany a real deposit.",
      "source-citation":
        "None; synthetic example. A real record would cite the dataset or publication.",
      doi: "None; synthetic example.",
      funding: "None; synthetic example.",
      "matcore-version":
        "Greenberg-2025-preliminary — local snapshot label, not an official MatCore release number",
      "matcore-id":
        "example:si-pbe-relax-001 — illustrative, nonpersistent identifier",
      "matcore-date": "2026-07-24",
      license: "CC-BY-4.0"
    },
    dft: {
      "xc-functional": "PBE generalized-gradient approximation",
      potential:
        "PBE ultrasoft pseudopotential for silicon with four valence electrons; an exact file identifier and checksum would be supplied with a real record.",
      "calculation-physics":
        "Non-spin-polarized calculation using a scalar-relativistic pseudopotential.",
      "basis-set":
        "Plane waves; 40 Ry wave-function cutoff and 320 Ry charge-density cutoff.",
      "k-points": "Gamma-centered 8 × 8 × 8 mesh.",
      "k-smearing":
        "No smearing; fixed occupations appropriate to the insulating state.",
      "self-consistent-field-convergence":
        "Linear mixing with mixing factor 0.7; electronic energy threshold 1 × 10⁻¹⁰ Ry.",
      "state-occupations":
        "Fixed occupations; eight valence electrons in the two-atom primitive cell.",
      "relaxation-convergence":
        "Maximum force below 1 × 10⁻⁴ Ry/Bohr, total-energy change below 1 × 10⁻⁵ Ry, and residual pressure below 0.5 kbar."
    }
  }
} as const satisfies SyntheticSiliconDftRecord
