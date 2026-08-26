# Search and browse

## Search

The **Search** entry under **Vocabulary** in the navigation bar opens the
Search page. The quick-search field in the navigation bar opens the same page
with a query. Search covers term names, definition text, and examples of use.
Search always covers every vocabulary hosted by MatSci-SAM, including while a
community is selected under **Working in**. Each result names the vocabulary
that defines it.

Every result also says why it matched. A term-name match highlights the name;
a definition or example match shows a short highlighted excerpt. A fuzzy
term-name match is labelled **Similar term name** when the typed text does not
appear literally.

Results are divided into **Terms** and **Definitions**. Checkboxes show or
hide either result type. At least one remains selected. The **By** filter
narrows definitions by human or language-model attribution and does not apply
to term results. Definition results contain only definitions whose own text or
examples match, except that a matching term name includes that term's
definitions. Definition results show the same vote controls and comment counts
as the term page, and comment counts open the discussion for that definition.
When no term matches, the page offers a link to define the searched term in the
vocabulary selected under **Working in**.

The optional **PSPP facet** checkboxes narrow both term and definition results
by term-level Processing, Structure, Properties, or Performance assignments.
No facet is selected by default, so terms without an assignment remain in
ordinary search results. Selecting several facets matches any of them.
Definition-level topic tags remain available on the **Tags** page and are not
search filters yet.

Two vocabularies may define the same label differently. Global Search keeps
those terms as separate results, and each result opens the term in its own
vocabulary namespace.

Exact term names rank first, followed by term names that begin with the
query. Full-text relevance and term-name similarity order the remaining
results. English stemming can match related word forms, such as "quench" and
"quenching". Term-name similarity can recover some misspellings. Search uses
PostgreSQL web-search syntax. Quotation marks search for words as a phrase,
uppercase `OR` matches either alternative, and a minus sign immediately
before a word excludes it. The example buttons beneath the search field can
insert each form.

Search filters and the query are stored in the URL so the result view can
be bookmarked or shared.

The empty Search page waits for a query. Begin typing to see matching term
suggestions and definitions, or use **Browse** to scan the terms in the current
scope alphabetically.

## Browse

The **Browse** page lists defined terms alphabetically with the definition
count in parentheses. A letter index stays pinned to the top of the page while
you scroll. Browse lists terms from every hosted vocabulary when you are signed
out or have selected **Everything**. Choosing a community from the **Working
in** control narrows Browse to terms defined in that community's vocabulary.
Terms from another vocabulary that appear in a worklist collection remain
references and are not added to this list. **Show everything** displays the
full catalog for one request and keeps the selected community in place. In the
full catalog, a **Defined in** label distinguishes same-label terms from
different vocabularies. See [Communities and scope](/docs/communities).

The **Tags** page is the other way to browse. It groups terms by facet and
definitions by topic, and lists collections. See
[Tags](/docs/tags).

The **Filter these terms** field performs a direct substring filter on
the terms already displayed. Press Escape or use the clear control to
remove that filter.

A bookmarked `/terms?q=...` address applies the full search engine before
the page loads and provides a **Show all terms** link. The navigation search
sends queries to `/search`.
