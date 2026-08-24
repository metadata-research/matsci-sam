# Search and browse

## Search

The **Search** entry under **Vocabulary** in the navigation bar opens the
Search page. The quick-search field in the navigation bar opens the same page
with a query. Search covers term names, definition text, and examples of use.

Results are divided into **Terms** and **Definitions**. Checkboxes show or
hide either result type. At least one remains selected. The **By** filter
narrows definitions to people or AI authors and does not apply to term
results. Definition results show the same vote controls and comment counts
as the term page, and comment counts open the discussion for that
definition. When no term matches, the page offers a link to define the
searched term.

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
suggestions and definitions, or use **Browse** to scan every defined term
alphabetically.

## Browse

The **Browse** page lists defined terms alphabetically with the definition
count in parentheses. A letter index stays pinned to the top of the page
while you scroll. Browse lists every defined term when you are signed out or
have not chosen a community. Choosing a community from the **Working in**
control narrows Browse to the terms in the collections on the worklist for that
community. **Show everything** displays the full vocabulary for one request and
keeps the selected community in place. See [Communities and
scope](/docs/communities).

The **Tags** page is the other way to browse. It groups terms by facet and
definitions by topic, and lists collections. See
[Tags](/docs/tags).

The **Filter these terms** field performs a direct substring filter on
the terms already displayed. Press Escape or use the clear control to
remove that filter.

A bookmarked `/terms?q=...` address applies the full search engine before
the page loads and provides a **Show all terms** link. The navigation search
sends queries to `/search`.
