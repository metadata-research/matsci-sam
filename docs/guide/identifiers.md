# Identifiers and citation

Choose a link for what you want to cite. A term, one definition, and an exact
revision identify different resources.

| Resource | Use |
| --- | --- |
| Term | A concept with its changing set of definitions |
| Definition | One candidate, including later revisions |
| Revision | Exact definition text at a recorded version |

## Citation

1. Open the term or definition you want to cite. Select **Advanced** to see
   its identifier.
2. Open the required revision when quoting exact wording.
3. Copy the persistent identifier displayed for that resource. Retain it if
   the browser redirects to a different website address.

MatSci-SAM identifiers use `https://w3id.org/matsci-sam`. Cite the term when
using a dictionary concept as a field value. Cite a revision for a quotation
or a reproducible comparison of definition text. A revision fixes the wording,
while its page may also display examples added later.

## Identifier paths

Terms in the default vocabulary have addresses under `/vocabulary`. Community
terms include a community slug assigned at creation. Renaming the community
preserves that slug. Two communities can define the same label as separate
concepts. A term referenced by a collection retains its original identifier.

## Term slugs

The readable part of a term address is assigned when the term is created.
It remains fixed when a display label changes. A numbered suffix distinguishes
otherwise identical addresses. Rank is recorded separately.

## Definition and revision numbers

Definition numbers are permanent within a term. Each definition has its own
revision sequence, so Definition 1 and Definition 2 can both have revision 1.
An edit or restoration adds a revision and preserves earlier versions.
Definition and revision numbers remain fixed after a vote.

## Tags, facets and collections

Tag and collection pages also have stable addresses. A merged tag redirects
to its replacement. A retired tag without a replacement retains a status page.
See [Tags](/docs/tags).

## Live rank lookup

A rank link opens the definition at that position when requested. Its
destination can change with votes and new revisions. Use a definition or
revision identifier to cite one candidate consistently.

## Machine-readable forms

[Metadata access](/docs/metadata-access) lists vocabulary and history downloads.
The downloaded descriptions use the same persistent resource identifiers.

## Persistent resolution

The website serving an identifier can change while the identifier remains the
same. Ordinary edits preserve term, definition, and revision addresses.
Exceptional administrator cleanup permanently removes test definitions and
revisions. Removed numbers are not reused. See the
[identifier policy](/docs/reference/identifier-policy#stability).
