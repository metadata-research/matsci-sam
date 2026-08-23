# Search and browse

## Search

The **Search** entry under **Vocabulary** in the navigation bar opens the
complete Search page without requiring a query. The quick-search field in the navigation bar opens the same page with
a query. Search covers term names, definition text, and examples of use.

Results are divided into **Terms** and **Definitions**. Checkboxes show
or hide either result type; at least one remains selected. The **By** filter
narrows definitions to people or AI authors and does not apply to term results.
Definition results show the same vote controls and comment counts as the
term page, and comment counts open the discussion for that definition. When
no term matches, the page offers a link to define the searched term.

Exact term names rank first, followed by term names that begin with the
query. Full-text relevance and term-name similarity order the remaining
results. English stemming can match related word forms, such as "quench"
and "quenching". Term-name similarity can recover some misspellings.
Search uses PostgreSQL web-search syntax: quotation marks search for words as
a phrase, uppercase `OR` matches either alternative, and a minus sign
immediately before a word excludes it. The example buttons beneath the search
field can insert each form.

Search filters and the query are stored in the URL so the result view can
be bookmarked or shared.

The empty Search page does not list the whole vocabulary. Begin typing to see
matching term suggestions and definitions, or use **Browse** to scan every
defined term alphabetically.

## Browse

The **Browse** page lists defined terms alphabetically with the definition
count in parentheses. A letter index stays pinned to the top of the page while
you scroll. Signed out, or with no community chosen, it lists every defined
term. When you have chosen a community from the account menu, Browse narrows to
the terms that community is working through, which are the terms in the
collections on its worklist, and a **Show everything** link drops the narrowing
for one request without changing your standing choice. See
[Communities and scope](/docs/communities).

The **Tags** page is the other way to browse. It groups terms by facet and
definitions by topic, and lists the curated collections. See
[Tags](/docs/tags).

The **Filter these terms** field performs a direct substring filter on
the terms already displayed. Press Escape or use the clear control to
remove that filter.

A bookmarked `/terms?q=...` address applies the full search engine before
the page loads and provides a **Show all terms** link. The ordinary
navigation search opens `/search` instead of sending queries to Browse.
