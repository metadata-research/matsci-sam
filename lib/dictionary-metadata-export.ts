import { experimentalMetadataFields } from "./dictionary-metadata"
import { en, turtleBlock } from "./kos-export"
import { IDENTIFIER_BASE_URL } from "./site"

/** Project vocabulary definitions, independent of the frozen MatCore source. */
export const generateDictionaryMetadataDefinitionsTurtle = () => {
  const base = IDENTIFIER_BASE_URL
  const properties = [
    [
      "usedAsValueFor",
      "Used as a value for",
      "A metadata field for which the described concept or definition can supply a value. This is usage guidance, not a dataset value or an equivalence assertion."
    ],
    [
      "describesMetadataField",
      "Describes a metadata field",
      "The metadata property whose meaning this dictionary entry or definition explains. The concept and the property retain distinct identities."
    ],
    [
      "relatedConcept",
      "Related external concept",
      "An external concept supplied as relevant context, without asserting equivalence, subclassing, or class membership."
    ],
    [
      "recommendedValueScheme",
      "Recommended value scheme",
      "A vocabulary suggested by this project as a source of values. It is not an RDF class range or a requirement imposed by the source standard."
    ]
  ] as const
  return [
    ...properties.map(([key, label, description]) =>
      turtleBlock(`${base}/metadata#${key}`, [
        "a rdf:Property",
        `rdfs:label ${en(label)}`,
        `rdfs:comment ${en(description)}`
      ])
    ),
    turtleBlock(`${base}/metadata/experimental`, [
      "a matsci:MetadataProfile",
      `rdfs:label ${en("Experimental methods — local proposal")}`,
      `rdfs:comment ${en("MatSci-SAM proposal 1 for discussing experimental metadata. These fields are not official ICoN-PCL or MatCore requirements.")}`,
      'dcterms:identifier "proposal-1"',
      ...experimentalMetadataFields.map(
        (field) =>
          `dcterms:hasPart <${base}/metadata/experimental#${field.key}>`
      )
    ]),
    ...experimentalMetadataFields.map((field) =>
      turtleBlock(`${base}/metadata/experimental#${field.key}`, [
        "a rdf:Property",
        `rdfs:label ${en(field.label)}`,
        `rdfs:comment ${en(field.description)}`,
        `skos:scopeNote ${en(field.valueGuidance)}`,
        `dcterms:isPartOf <${base}/metadata/experimental>`,
        'matsci:status "proposed"'
      ])
    )
  ].join("\n")
}
