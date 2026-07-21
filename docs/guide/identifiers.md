# Identifiers and citation

Every term in this vocabulary has a stable, human-readable address. This page
describes how those addresses are formed, what you can rely on, and how to cite
a term in published work.

## The shape of an identifier

A term's identifier is its name, lowercased, with spaces written as
underscores:

```
https://sam.cci.drexel.edu/vocabulary/sintering
https://sam.cci.drexel.edu/vocabulary/high-entropy_alloy
https://sam.cci.drexel.edu/vocabulary/density_functional_theory_dft
```

Underscores stand in for spaces so that hyphens keep their meaning. In
materials science a hyphen is often part of the term itself — a *high-entropy
alloy* is not a *high entropy alloy* — and writing spaces as hyphens would
erase that distinction. Wikipedia uses underscores for the same reason.

Characters outside `a-z`, `0-9`, `_` and `-` are dropped, which is why
*density functional theory (dft)* becomes `density_functional_theory_dft`.

## What is stable

An identifier is assigned once, when a term is first defined, and is never
reassigned to a different concept. Links, citations, and RDF references can
rely on this.

Older links of the form `/terms/41` still work. They issue a permanent
redirect to the term's `/vocabulary/` address, so nothing published before the
change is broken.

## Terms that share a name

Where two distinct concepts would produce the same identifier, the second and
subsequent ones take a numeric suffix — `band_gap`, `band_gap_2` — following
the convention the *Oxford English Dictionary* uses to number homographs. The
number distinguishes entries; it does not rank them.

Note that this is different from a term having several *definitions*. A term
with five community definitions is still one concept with one identifier. The
definitions are alternative formulations of it, each individually addressable
at its own `/definition/` URL, with the highest-voted one marked as the
default.

## Machine-readable forms

Every term is a `skos:Concept` within the scheme at
`https://sam.cci.drexel.edu/vocabulary`, which itself resolves to a description of
the vocabulary.

Two serializations are linked from each term page:

- **SKOS** (Turtle) — `/terms/<id>/skos.ttl`
- **JSON-LD** — `/terms/<id>/skos.jsonld`

Each term page also embeds a schema.org `DefinedTerm` block, which is what
search engines and reference managers read.

Provenance — who wrote what, when, and which model was involved — is published
separately as PROV-O from the Provenance link on each term page. The SKOS
record describes the vocabulary's current state; the PROV-O record describes
how it got there.

## Citing a term

Cite the `/vocabulary/` address rather than the numeric one. It is readable in
a bibliography, it survives changes to the underlying database, and it is the
address the RDF output publishes as the concept's identifier.

> sintering. *MatSci SAM*. https://sam.cci.drexel.edu/vocabulary/sintering

Identifiers moved to this host as part of the move from YAMZ to SAM. That
change was made once, deliberately, before the vocabulary was cited anywhere
external. It is the last such change we intend to make by editing identifiers
directly — see below.

## Persistent identifiers

Work is underway to place these identifiers behind a persistent-identifier
service, so that citations survive a change of domain as well as a change of
database. The identifier scheme above is designed for it: because the mapping
is pattern-based, one redirect rule covers every term in the vocabulary,
present and future, and the readable part of the address does not change.
