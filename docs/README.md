# Documentation

| Reader                 | Start here                                     | Source        | Website           |
| ---------------------- | ---------------------------------------------- | ------------- | ----------------- |
| New contributor        | [Quick start](quickstart/index.md)             | `quickstart/` | `/docs`           |
| Contributor or steward | [User guide](guide/index.md)                   | `guide/`      | `/docs/guide`     |
| Metadata consumer      | [Technical reference](reference/index.md)      | `reference/`  | `/docs/reference` |
| Developer              | [Technical documentation](technical/README.md) | `technical/`  | Repository only   |

The application renders Markdown through `lib/docs.ts`. `app/docs/shell.tsx`
provides grouped navigation. Guide articles retain `/docs/{slug}` URLs,
and reference articles use `/docs/reference/{slug}`.

The website labels this area **Help & Guides**. **Participate** links directly
to Quick Start before Contribute. User instructions and technical reference
have distinct navigation groups. Implementation notes remain in the repository.

## Editing

Write task instructions in the guide, metadata semantics in the reference,
and implementation contracts in technical notes. Link to the detailed
explanation from other pages. Keep rollout receipts and design discussions
out of reader documentation.

Write from the perspective of the people contributing to and maintaining the
project. Describe what the application does and what a reader needs to do. Use a
neutral voice or "we" for a shared project decision. Name an individual when
their account or responsibility affects the procedure.
Avoid progress reports, commentary about the quality of past work, and
references to private drafting notes.

Use straight quotes and apostrophes. Write complete sentences without em dashes
or semicolons in prose, and reserve colons for formal labels or definitions.
Use established terms and rephrase invented compounds. Describe what the
software does with literal verbs and put the main action first.

State the action first, use exact control labels, and keep examples and
limitations that affect a reader's decision. Distinguish implemented behavior
from proposed work, and check implementation claims against the relevant
code, schema, and configuration. Deployment details belong in the operations
repository. Preserve published paths and heading anchors.

The seven help sections in `guide/studies.md` also appear inside the study
activity. Their IDs are selected by `lib/study-help.ts`. Run
`pnpm test:surveys` after editing that page to check rendered excerpts and links.
Check local links, images, and heading IDs after reorganizing any page.

## Screenshots

Capture the current interface with a representative example. Crop to the task
controls and exclude private account details. Place static RGB or RGBA PNG files
under `public/images/docs/` and give each image descriptive alternative text.
Use a new filename when replacing a published image to avoid cached copies.
Include the instructions in text so readers can follow a task without the
screenshots.

Keep the quick start near 500 words. Most task guides should fit within
400 to 800 words. Split a longer guide when its tasks can stand alone. Preserve
existing links and embedded study sections when reorganizing content.
