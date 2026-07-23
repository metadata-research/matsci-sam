# Identifiers and citation

Every term receives a readable slug when it is created. The application
combines that slug with the configured public site URL to produce the
concept IRI.

## Identifier paths

The term page displays the full IRI for the active deployment. Its path
has this form:

```
/vocabulary/sintering
/vocabulary/high-entropy_alloy
/vocabulary/density_functional_theory_dft
```

The application lowercases term names and writes spaces as underscores.
Hyphens remain part of the slug, so _high-entropy alloy_ and _high
entropy alloy_ produce different paths. Characters outside `a-z`,
`0-9`, `_`, and `-` are dropped. For example, _density functional theory
(DFT)_ becomes `density_functional_theory_dft`.

## What remains stable

The slug is assigned when a term is created. The application has no term
rename operation and does not reassign an existing slug to another term.

The authority portion of the IRI comes from `NEXT_PUBLIC_SITE_URL`.
Changing that setting changes the full IRI even though the slug remains
the same. Copy the IRI displayed on the term page instead of assuming a
hostname from this guide.

A numeric path such as `/terms/41` issues a permanent redirect to the
readable `/vocabulary/` path on the same host.

## Normalization collisions

Different term labels can produce the same slug after punctuation is
removed. The first term receives the base slug. A later collision
receives a numeric suffix such as `_2`, followed by `_3` when needed.
The number resolves an identifier collision and does not rank the terms.

Several definitions of one term remain part of one concept with one
identifier. Definitions have their own `/definition/{id}` pages. The
definition path remains the same when its author publishes a revision. The
base path displays the current revision, and `?version={number}` identifies a
historical version on that stable page. The term page orders current revisions
by score, with the newest definition first when scores are equal.
[Community review and revisions](/docs/community) describes the score and
status rules.

## Machine-readable forms

Every term is a `skos:Concept` in the concept scheme at `/vocabulary`.
The term page links to two serializations:

- **SKOS (Turtle):** `/terms/{id}/skos.ttl`
- **JSON-LD:** `/terms/{id}/skos.jsonld`

Each term page also embeds a schema.org `DefinedTerm` block. Provenance
is published separately as W3C PROV-O from the **Provenance** link on the
term page. The SKOS record describes the published vocabulary state. The
PROV-O record describes the stored contribution history.

## Citing a term

Use the full IRI displayed on the term page, not the numeric route. A
minimal citation has this form:

> sintering. _MatSci SAM_. [IRI displayed on the term page]

Confirm the public authority before external citation. A move to another
host changes the full IRI unless a persistent redirect layer is already
in place.

## Persistent identifiers

The application does not implement a domain-independent
persistent-identifier layer. A service such as w3id.org or an
institutionally managed redirect can preserve citations across a future
change of host. The slug pattern allows one redirect rule to map the
vocabulary and its terms to a new authority.
