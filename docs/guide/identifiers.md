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

Default-vocabulary terms have addresses under `/vocabulary`. Community terms
include the community name in the path. Two communities can define the same
label as separate concepts. A collection reference retains the identifier of
the owning vocabulary.

## Term slugs

The readable part of a term address is assigned when the term is created.
It remains fixed when a display label changes. A numbered suffix distinguishes
otherwise identical addresses and does not indicate rank.

## Definition and revision numbers

Definition numbers are permanent within a term. Each definition has its own
revision sequence, so Definition 1 and Definition 2 can both have revision 1.
An edit or restoration adds a revision and preserves earlier versions.
Voting does not change either number.

## Tags, facets and collections

Tag and collection pages also have stable addresses. A merged tag redirects
to its replacement. A retired tag without a replacement retains a status page.
See [Tags](/docs/tags).

## Live rank lookup

A rank link opens the definition currently at that position. Its destination
can change with votes and new revisions. Use a definition or revision
identifier to cite one candidate consistently.

## Machine-readable forms

[Metadata access](/docs/metadata-access) lists vocabulary and history downloads.
The downloaded descriptions use the same persistent resource identifiers.

## Persistent resolution

The website serving an identifier can change while the identifier remains the
same. Ordinary edits preserve term, definition, and revision addresses.
Exceptional administrator cleanup permanently removes test definitions and
revisions. Removed numbers are not reused. See the
[identifier policy](/docs/reference/identifier-policy#stability).
