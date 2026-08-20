-- Hand-written data migration. No schema change.
--
-- The PSPP text seeded in 0029 was drafted, and its own plan flagged the
-- wording for review against the source. This is that revision, against
-- Greenberg, J., et al. (2023), "Materials Science Ontology Design with an
-- Analytico-Synthetic Facet Analysis Framework", and the materials paradigm it
-- builds on (Agrawal and Choudhary, reference 10 of that paper).
--
-- Two things change. The definitions now say what each facet groups rather
-- than what the underlying concept means, because the ledger gained a bridge
-- between a concept and a term: a facet reading like a term definition invites
-- the reading that it is one. Each facet also gains a scope note, which is
-- where SKOS puts guidance on what to file under a concept.
--
-- Every update is conditional on the 0029 text still being in place, so a
-- curator edit made through tags.updateConcept is left alone rather than
-- silently reverted.
UPDATE "conceptSchemes"
SET description = 'Processing, Structure, Properties, Performance. A navigation aid that classifies the term concept, following the facet analysis of Greenberg et al. (2023) and the materials paradigm it draws on. A term may be assigned more than one facet. A facet classifies terms and is never the same concept as a term, so it is never bridged to one.'
WHERE slug = 'pspp'
  AND description = 'Processing, Structure, Properties, Performance: a navigation aid classifying the term concept. A term may carry several.';--> statement-breakpoint
UPDATE "concepts" c
SET definition = 'Terms for how a material is made, shaped, or treated, including synthesis, forming, heat treatment, and joining. Processing establishes structure.',
    "scopeNote" = 'Assign this facet to a term that names an operation performed on a material, or a route by which one is produced.'
FROM "conceptSchemes" s
WHERE s.id = c."schemeId" AND s.slug = 'pspp' AND c.slug = 'processing'
  AND c.definition = 'Processing: how a material is made, shaped or treated — synthesis, forming, heat treatment, joining and other operations that establish or change its structure.';--> statement-breakpoint
UPDATE "concepts" c
SET definition = 'Terms for the arrangement of the constituents of a material at any scale, from atomic and crystal structure through microstructure to macroscopic form. Structure results from processing and gives rise to properties.',
    "scopeNote" = 'Assign this facet to a term that names an arrangement, a phase, or a feature observed at any length scale. A term for a measurement of that arrangement belongs under Properties.'
FROM "conceptSchemes" s
WHERE s.id = c."schemeId" AND s.slug = 'pspp' AND c.slug = 'structure'
  AND c.definition = 'Structure: the arrangement of a material''s constituents at any scale, from atomic and crystal structure through microstructure to macroscopic form.';--> statement-breakpoint
UPDATE "concepts" c
SET definition = 'Terms for the measurable characteristics that follow from structure, including mechanical, thermal, electrical, optical, and chemical behavior.',
    "scopeNote" = 'Assign this facet to a term that names a measurable characteristic. A term for how a material behaves in an application belongs under Performance.'
FROM "conceptSchemes" s
WHERE s.id = c."schemeId" AND s.slug = 'pspp' AND c.slug = 'properties'
  AND c.definition = 'Properties: measurable characteristics of a material — mechanical, thermal, electrical, optical, chemical — that follow from its structure.';--> statement-breakpoint
UPDATE "concepts" c
SET definition = 'Terms for how a material behaves in service, under the conditions and over the time that an application imposes. Performance follows from properties, and it is where the inverse design pathway begins.',
    "scopeNote" = 'Assign this facet to a term that names behavior in service, such as durability, reliability, or a mode of failure. Greenberg et al. report this facet as the hardest to apply, because it describes a dynamic aspect of a material rather than a fixed one, so a term that also names a measurable characteristic may take Properties as well.'
FROM "conceptSchemes" s
WHERE s.id = c."schemeId" AND s.slug = 'pspp' AND c.slug = 'performance'
  AND c.definition = 'Performance: how a material behaves in service under real conditions and over time — durability, reliability, failure and fitness for purpose.';
