# Making MatSci YAMZ a Metadata Dictionary in Substance

Date: 2026-07-20. The question is how the site can reflect its identity as
an MRC metadata project, without complicating the add-a-term flow.

## The governing principle

The provenance feature already set the pattern. Contributors type a term, a
definition, and an example, and the system derives a W3C PROV-O graph from
ordinary domain tables. Nobody fills in provenance. The same principle
applies to everything below. Metadata is a derived view over data the site
already has, or an optional layer curators add later. The add form does not
grow a single field.

A useful reframe follows from it. The site's content is already
SKOS-shaped without knowing it. A term is a skos:Concept, the term string
is skos:prefLabel, a definition is skos:definition, an example is
skos:example, and competing definitions from different authors are exactly
the "multiple definitions with community consensus" problem SKOS
concept schemes were designed to carry. Nothing needs remodeling. The work
is to expose what exists in the vocabularies of the metadata community.

## Idea menu

Ordered roughly by effort, lowest first.

### 1. JSON-LD in page heads (schema.org DefinedTerm)

Each term page embeds a script block describing the term as a
schema.org/DefinedTerm inside a DefinedTermSet, with dcterms creator,
created, and license. Crawlers and reference managers see a machine-
readable dictionary immediately. Zero visible UI change, roughly a day of
work, and the FAIR claim on the homepage gains a concrete artifact.

### 2. SKOS export with content negotiation

A serializer (same shape as buildTermProvenance) renders a term as SKOS.
Routes like /terms/40.ttl and /terms/40.jsonld, plus /vocabulary.ttl for
the whole scheme as a skos:ConceptScheme. Mapping: prefLabel from the
term, one skos:definition per community definition with dcterms:creator
and dcterms:created, skos:example from examples, dcterms:contributor for
the model on co-authored definitions, skos:changeNote derived from the
edit history. The scheme-level record includes dcterms and a license. This
is the single strongest "metadata dictionary" signal available, and it is
purely additive.

### 3. Tags become SKOS concepts with external mappings

The tags table today is a bare name. Give tags an optional scheme and an
optional external IRI, so a tag can assert skos:exactMatch or
skos:closeMatch to a class in EMMO, PMDco, CHAMEO, or another ontology
(the same sources as in the RAG assessment, whose planned vocab tables
double as the mapping picker). Two consequences follow.

- A small curated facet scheme becomes possible (for example Material,
  Process, Property, Characterization method), which is itself a tiny
  skos:ConceptScheme the site publishes.
- The SKOS export gains skos:related and mapping triples, which is where
  a dictionary starts becoming a knowledge organization system.

Contributors keep using tags exactly as today. Curation of mappings is an
admin or moderator activity, invisible by default, surfaced as a small
"maps to" line on the tag page for those who care.

### 4. Persistent identifiers per term

The PURL assessment (docs-internal, 2026-07-17) already explored this.
Mint a stable URI per term (w3id.org or PURL redirecting to the term
page), advertise it on the term page as "Cite this term", and make the
SKOS export use it as the concept URI. Original YAMZ minted ARKs for the
same reason, so this is also a heritage continuity point. Effort is mostly
registration and redirect config, not code.

### 5. Serialize the provenance graph as actual PROV-O RDF

The provenance view is PROV-shaped JSON today. Emitting Turtle or JSON-LD
from the same builder (prov:Activity, prov:Entity, prov:wasDerivedFrom,
prov:wasAttributedTo) makes the claim literal: a metadata researcher can
load a term's history into any RDF tool. Small, because the hard modeling
is done.

### 6. Term lifecycle status

Original YAMZ classed terms as vernacular or canonical through voting.
A derived status per definition (for example proposed, community-reviewed
at a vote threshold, stable) recorded as editorial metadata
(skos:editorialNote or a small status vocabulary) gives the dictionary a
governance story. Displayed as one quiet chip, derived entirely from
existing votes, no flow change.

### 7. Dataset-level description (DCAT/VoID)

One /about/metadata page plus a machine-readable DCAT description of the
whole dictionary as a dataset (publisher MRC, license, update frequency,
distribution links to /vocabulary.ttl). This is what makes the site
citable and harvestable as a dataset, and it is a static artifact.

### 8. TEI export of entries

TEI's dictionaries module (entry, form, sense, def, cit) can render each
term as a scholarly dictionary entry. Charming for the digital-humanities
audience and for archival deposit, but SKOS covers the interoperability
need better. Worth doing only after 2, as an additional serialization of
the same derived model.

## What shows by default

Almost nothing, deliberately. The visible changes across all eight ideas
amount to a "Cite this term" line with a persistent URI, an optional
status chip, small format links (Turtle, JSON-LD) tucked near the
provenance link, and a "maps to" note on tag pages. Everything else is in
response headers, page heads, and export routes.

## Suggested sequence

1 and 2 first (JSON-LD embed, SKOS export), since they convert the site's
existing substance into the community's formats with no schema change.
Then 3 (tag mappings) because it shares tables with the planned RAG work.
Then 4 (PIDs), which makes the SKOS URIs permanent. 5 through 8 as
appetite allows.
