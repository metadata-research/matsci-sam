# The knowledge organization model

MatSci-SAM holds two kinds of concept and one kind of relation between them.
The dictionary is a concept scheme whose concepts are terms. The tag layer is
a set of further concept schemes whose concepts are tags. Every relation that
attaches, links, groups or maps these concepts is one statement in a single
ledger.

## The dictionary scheme

Every term is a `skos:Concept` in the concept scheme at `/vocabulary`. The
term name is its preferred label. Each current definition revision is an
identified resource that the term points at with `skos:definition`. Competing
definitions of one term are separate definitions, each with its own revision
history, and a term does not compete with another term for a meaning.

## Tag schemes

A tag is a `skos:Concept` in a tag scheme, and the scheme says what kind of
tag it is. Two schemes exist.

The **topics** scheme is open. A signed-in contributor creates a topic and
attaches it to a definition they wrote. Topics attach at definition level
only. The export lifts them onto the term as a derived statement, so a reader
who sees only term records still finds them.

The **PSPP** scheme is curated. Its four concepts, Processing, Structure,
Properties and Performance, classify the term concept itself, and only a
curator assigns them. Facets attach at term level only. A term may have
several, and a facet does not claim that the classification is complete.

The two levels are enforced. A topic cannot attach to a term and a facet
cannot attach to a definition. Whether a scheme is curated or open settles
both who may attach its concepts and at which level.

A tag has a preferred label, alternative labels, an optional definition, and
an optional scope note. The definition says what the concept means. The scope
note says what belongs under it in classification, which is a different
question, and it is the text that keeps a tag usable while the meaning of a
linked term moves. A tag may also have broader and narrower tags within its
own scheme, and related tags.

## Collections

A collection is a `skos:Collection`: a curated named set of terms gathered
for a purpose, such as the terms reviewed for an event. Membership is a
statement, so a term joins or leaves a collection without its own record
changing. Collections hold terms only and are unordered.

## The statement ledger

Every attachment, link, grouping and mapping is one row in a statement
ledger. A row records a subject, a predicate, an object, who asserted it,
when, and whether and when it was retracted. While a row is active it is one
RDF triple, and the row itself is the record of the assertion.

The predicate set is closed. It holds `dcterms:subject`, `skos:broader`,
`skos:related`, `skos:member`, and the five SKOS mapping properties
`exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch` and `relatedMatch`.
Each predicate accepts only certain kinds of subject and object.

| Predicate          | Subject             | Object                     |
| ------------------ | ------------------- | -------------------------- |
| `dcterms:subject`  | term or definition  | tag                        |
| `skos:broader`     | term or tag         | term or tag, same kind     |
| `skos:related`     | term or tag         | term or tag, same kind     |
| `skos:member`      | collection          | term                       |
| `skos:exactMatch`  | term or tag         | external IRI               |
| `skos:exactMatch`  | tag                 | term                       |
| other `*Match`     | term or tag         | external IRI               |

A closed predicate set is what keeps tags from becoming a store for
provenance, source identity or metadata relationships. No predicate accepts
them.

Statements are retracted, never deleted. A retraction records who withdrew
the assertion and when, and the row remains readable. The one exception is
the administrative purge of a definition, which removes the definition and
everything that depends on it.

Some triples in the export have no row of their own. `skos:narrower` is the
stored `skos:broader` read from the other end. `skos:related` is stored once
and emitted in both directions. A topic on a definition is lifted onto its
term. A tag linked to a term is named by the term in return. These derived
triples are computed when a document is built, and they have no assertion
record of their own.

## A tag that is also a term

A tag and a term can be the same concept. The ledger records this as
`skos:exactMatch` from the tag to the term, through a typed reference rather
than an external IRI. The link is optional and expected to be uncommon, since
most tags are subject headings nobody would write a definition of.

A linked tag keeps its own identifier and gains the definitions of the term.
A tag is never linked to a term whose own definitions are filed under it,
since the statement would say that a definition is about itself. A facet is
never linked, because a facet classifies a term rather than being one. One
tag links to one term and one term to one tag, since `skos:exactMatch` is
symmetric and transitive and two tags naming one term would name each other.
