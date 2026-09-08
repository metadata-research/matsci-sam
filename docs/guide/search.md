# Search and browse

## Search

Open **Search** under **Vocabulary**, or enter a query in the navigation bar.
Search covers term names, definition text, and examples across all hosted
vocabularies. **Working in** does not limit it. Each result identifies the
owning vocabulary and highlights the matching text. **Similar term name**
labels a fuzzy name match.

Select **Terms**, **Definitions**, or both. At least one result type must
remain selected. **By** filters definition results by human or model
attribution. It does not filter term results. A matching term name includes
its definitions. Otherwise, a definition result requires matching definition
text or an example.

**PSPP facet** narrows both result types by term-level Processing, Structure,
Properties, or Performance assignments. Multiple selected facets match any
of them. No facet is selected initially, so unclassified terms remain in the
results. Definition topics are browsable under [Tags](/docs/tags).

Exact term names rank first, then names that begin with the query. Other
results use full-text relevance and name similarity. English word forms can
match, such as "quench" and "quenching". Name similarity can recover some
misspellings.

| Search form        | Effect                   |
| ------------------ | ------------------------ |
| `"heat treatment"` | Match a phrase           |
| `quench OR anneal` | Match either alternative |
| `steel -stainless` | Exclude a word           |

The query and filters are stored in the URL for sharing or bookmarking.
Vote controls and comment counts work as on the term page. A search with no
matching term links to Contribute in the selected vocabulary.

## Browse

**Browse** lists defined terms with a definition count. A community selection
limits the list to its vocabulary. **Everything**, or signed-out browsing,
includes all hosted vocabularies. **Show everything** expands one request
without changing your selection. **Defined in** distinguishes vocabularies in
the full catalog. References from a community worklist remain in their owning
vocabulary.

Use **Filter these terms** to match a substring in the displayed names.
Escape or the clear control removes that filter. A bookmarked `/terms?q=...`
applies the full search engine before the list loads. **Show all terms**
removes that search.

[Tags](/docs/tags) provides another route through facets, topics, and collections.
