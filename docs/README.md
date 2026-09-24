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
have distinct navigation groups; implementation notes remain in the repository.

## Editing

Write task instructions in the guide, metadata semantics in the reference,
and implementation contracts in technical notes. Link to the detailed
explanation from other pages. Keep rollout receipts and design discussions
out of reader documentation.

Apply the canonical writing guide at `Working/style.md` in OneDrive while drafting.
State the action first,
use exact control labels, and keep examples and limitations that affect a
reader decision. Preserve published paths and heading anchors.

The seven help sections in `guide/studies.md` also appear inside the study
activity. Their IDs are selected by `lib/study-help.ts`. Run
`pnpm test:surveys` after editing that page to check rendered excerpts and links.
Check local links, images, and heading IDs after reorganizing any page.

## Screenshots

Capture the current interface with a representative example. Crop to the task
controls and exclude private account details. Place static RGB or RGBA PNG files
under `public/images/docs/` and give each image descriptive alternative text.
Use a new filename when replacing a published image to avoid cached copies.
Keep essential instructions in text so a screenshot is never the only way to
follow a task.

Keep the quick start near 500 words. Most task guides should fit within
400 to 800 words. Split a longer guide when its tasks can stand alone. Preserve
existing links and embedded study sections when reorganizing content.
