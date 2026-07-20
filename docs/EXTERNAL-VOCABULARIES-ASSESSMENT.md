# External Vocabulary Sources Assessment

Date: 2026-07-20. Question: which external materials-science sources are
practical to add, and which vocabularies can be downloaded into a RAG
component. Constraint from the outset: the add-a-term flow stays exactly as
it is. External knowledge enters only through the refine path, as optional
grounding for suggestions, or as an offered enrichment of a definition.

## Verdict summary

| Source | Verdict | Role |
|---|---|---|
| MatPortal | Yes, as offline snapshots | Primary vocabulary corpus for RAG |
| Materials Project API | Not for RAG | Possible later enrichment for material-name terms |
| OPTIMADE | Not for RAG | Same enrichment role, federated and keyless |
| MaRDA Alliance | Not a data source | Community alignment and citation |

## MatPortal (matportal.org)

An OntoPortal (BioPortal technology) repository run by Fraunhofer Materials,
BAM, and NFDI MatWerk, hosting roughly 37 materials ontologies with about
13,500 classes. The REST API at data.matportal.org uses a free API key.
Probed today, the site serves only its JavaScript shell and the API does not
respond, which matches the reported up-and-down behavior.

That instability is the reason to treat MatPortal as a snapshot source, not
a live dependency. The practical pattern is a one-time (and occasionally
repeated) pull of each ontology as OWL, extraction of class labels and
definitions into a local table, and no runtime dependency at all. Most of
the ontologies it hosts also live on GitHub (see the shopping list below),
so the majors are obtainable even while MatPortal is down. Licenses vary
per ontology, mostly CC-BY variants, so each stored entry needs its source
IRI, ontology version, and license for attribution.

Definitions in OWL files sit in a handful of annotation properties
(skos:definition, IAO_0000115, rdfs:comment, and the EMMO elucidation
property). One extraction script with rdflib normalizes all of them into
rows of {term, definition, source, sourceIri, version, license}.

## Materials Project API (next-gen.materialsproject.org/api)

The wrong shape for a glossary. The API returns computed property data
(structures, band gaps, formation energies) keyed by material, through the
mp-api Python client, with a free API key and CC-BY 4.0 data. There are no
term definitions to retrieve.

A later enrichment is plausible for terms that name materials or compounds
("titanium", "metal-organic framework"), where the refine path could offer
a factual aside sourced from MP. That adds a live dependency and key
management for modest payoff, so it is parked, not planned.

## OPTIMADE (optimade.org)

A federation API specification over 20-plus structure databases (AFLOW,
COD, NOMAD, Materials Cloud, OQMD, and others). The providers index at
providers.optimade.org responds without authentication (verified today).
Like MP, it serves structure and property records, not definitions. The
specification defines its own API properties precisely, but that is API
vocabulary, not materials-science vocabulary, and would read oddly next to
glossary entries. Parked for the same enrichment role as MP, with the
advantage of needing no key.

## MaRDA Alliance (marda-alliance.org)

A community network, not a data source. Its outputs are working-group
recommendations (FAIR microscopy metadata, LIMS practices) and community
coordination. The related RDA/IMRR effort produced a small NIST controlled
vocabulary for materials data discovery, which is worth ingesting (below),
but MaRDA itself offers nothing to download into a RAG store. Its value
here is alignment and visibility for the project, which suits the MRC
context. The site also blocks non-browser fetchers.

## Downloadable vocabulary shopping list

Priority order for a RAG corpus, all obtainable without MatPortal uptime.

1. EMMO, the Elementary Multiperspective Material Ontology (GitHub
   emmo-repo, OWL/Turtle, CC-BY 4.0). Elucidations serve as definitions.
   The upper levels are abstract, so ingest the domain modules selectively.
2. EMMO domain ontologies, especially CHAMEO (characterization), BattINFO
   (batteries), and the mechanical-testing domain (GitHub, CC-BY 4.0).
3. PMDco, the Platform MaterialDigital core ontology (GitHub, OWL, CC-BY
   4.0). Process, structure, and property terms with curated definitions.
4. MDO, the Materials Design Ontology (GitHub, Linköping). Compact and
   well defined.
5. The defect ontologies DISO, PLDO, and PODO (dislocations, line and
   point defects). Small, focused, GitHub-hosted.
6. The NIST/RDA IMRR controlled vocabulary for materials data discovery.
   Small metadata vocabulary, directly relevant to the MRC angle.
7. IUPAC Gold Book (about 7,000 chemical terminology entries, JSON
   download). License is CC BY-NC-ND, so entries can ground retrieval
   with attribution but must not be republished as derived definitions.
   Keep it retrieval-only if included at all.
8. Wikidata/Wikipedia materials-science subsets (CC0 / CC BY-SA). Easy to
   pull, uneven quality. Useful as a long-tail fallback tier ranked below
   curated ontologies.

QUDT (units and quantities, CC-BY) is a possible ninth for quantity terms
such as band gap or Young's modulus, though it defines quantities rather
than materials concepts.

## Integration sketch that keeps add-a-term simple

The add form does not change at all. Everything lands in the refine path,
which already has the right shape for it.

- Two tables, vocabSources (name, homepage, license, version, fetchedAt)
  and vocabEntries (sourceId, term, definition, sourceIri), filled by an
  offline ingestion script per source.
- Retrieval starts with Postgres full-text search. A corpus of 20k to 50k
  entries does not need vector search, which matches the existing decision
  to defer pgvector until the corpus grows.
- runRefinementRound retrieves the top few entries for the term before
  generation and passes them to the model as reference context, with an
  instruction to reconcile rather than copy.
- The suggestion card gains one optional disclosure, "References", listing
  source and entry with attribution. Nothing new to fill in, nothing new
  to decide at add time.
- Provenance gets the interesting part for free. Each retrieved entry
  becomes an entity that the refine activity used, stamped with source and
  version, so the graph shows exactly which external definitions informed
  a suggestion. That is a distinctive, publishable angle for the project.

## Suggested next step

A small Phase 7 in the tracker: ingestion script plus the two tables for
two or three sources (PMDco, CHAMEO, and the NIST vocabulary make a good
first set), retrieval wired into runRefinementRound behind a single flag,
and the References disclosure. MatPortal snapshots join whenever the
portal happens to be up.
