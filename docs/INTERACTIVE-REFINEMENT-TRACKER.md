# Interactive Definition Refinement — Implementation Tracker

**Status:** ALL PHASES COMPLETE — implemented and verified end-to-end in the
browser on 2026-07-20. Remaining: commit, and the Open items below.
**Branch:** `feature/provenance`
**Last updated:** 2026-07-20

This document is the working plan for the interactive AI-assisted definition
refinement feature. It is meant to be updated as work proceeds: check off
tasks, append to the session log, and record any decision changes in the
Decisions section so future sessions can pick up exactly where this left off.

## Feature summary

A new `/add/interactive` route with the same three fields as `/add` (term,
definition, example). Submitting creates the term and the user's definition as
normal — but **skips** the automatic background AI definition — and redirects
to the definition page. There the author sees a **Refine** button. Each
refinement round appends a card to the page (stacked elements, not a chat
window): the model's suggested revision with three choices — **Accept**,
**Keep mine**, or **comment + Re-evaluate**. Accepting creates a *second,
separate* definition co-authored by the user and the model (displayed by model
name, GitHub-style), leaving the original intact. All of it is derivable into
the PROV-O graph, which becomes publicly viewable (read-only).

## Decisions (locked in 2026-07-20)

| # | Question | Decision |
|---|----------|----------|
| 1 | Where does the refine UI live? | On `/definition/{id}`, author-only. The add flow redirects there as it already does. |
| 2 | What does Accept do? | Creates a **separate new definition** (original stays). Not an in-place edit. |
| 3 | Relation to the existing auto-AI definition? | New `/add/interactive` route **skips** auto-AI generation; classic `/add` keeps current behavior unchanged. Refine button appears only for definitions with `createdVia = 'interactive'`. **Amended 2026-07-20:** both URLs render one shared form with an "Interactive AI refinement" toggle at the top (mode-specific instructions, typed input preserved, URL kept in sync via `history.replaceState`); the routes remain as deep links / default-mode selectors. |
| 4 | Authorship of the accepted definition? | **Co-authorship**, GitHub-style: primary author = the human, co-author = an AI user named after the **model** (e.g. `gemma4:26b`), never a generic "AI". |
| 5 | Provenance graph access? | **Public read-only** view at `/terms/[termId]/provenance`; admin view keeps full detail. Public view anonymizes voter identities (pending confirmation — see Open items). |

## Architecture notes (read before implementing)

- Provenance in this codebase is **derived, not logged**: `lib/provenance.ts`
  `buildTermProvenance()` reconstructs the PROV-O graph from domain tables.
  Therefore every interaction in this feature must land in a queryable table
  with author, timestamp, and generation-stamp columns. The schema *is* the
  provenance model.
- Refinement rounds must NOT go into `chatsTable`. `reviseDefinition()`
  (`lib/apis/ollama.ts:81`) replays the entire per-term chat thread as LLM
  context for the auto-AI definition; foreign turns there would corrupt it.
- `runLLM` already produces structured `{definition, example}` output via
  `zodToJsonSchema(DefinitionOutput)` — reuse that shape for suggestions.
- `generationStamp` (`lib/apis/ollama.ts:43`) is currently a module-level
  constant tied to the single define prompt; it must be parameterized per
  prompt (Phase 2) so refine rounds are stamped with the refine prompt.
- gemma4:26b cold load is ~22 s. Generation must run via the `after()` +
  pending-row + client-polling pattern, not a held-open HTTP request.
- Per user's global rule: no error suppression / fallbacks in development —
  failed generations get an explicit `failed` status surfaced in the UI.

---

## Phase 1 — Schema & data model

New migration (next number after current head in `drizzle/migrations/`).
All schema work in `drizzle/schema.ts`; regenerate with drizzle-kit.

- [x] `definitionRefinements` table — one row per round (= one UI card):
      `id`, `definitionId` (FK), `round` (int), `userComment` (nullable; the
      feedback that prompted the round, null for round 1),
      `suggestedDefinition`, `suggestedExample`, stamp columns (`model`,
      `promptKey`, `promptHash`, `promptText`), `status`
      (`pending → suggested → accepted | kept | superseded | failed`),
      `errorMessage` (nullable, for `failed`), `createdAt`, `decidedAt`
- [x] `definitionCoauthors` join table: `(definitionId, userId)` composite PK.
      Primary `authorId` on `definitions` stays untouched (all existing
      queries keep working); co-authors are additive.
- [x] `definitions` additions: `refinedFromId` (nullable self-FK to the
      original definition) and `createdVia` (`'classic' | 'interactive'`,
      default `'classic'` so existing rows need no backfill)
- [x] Replace unique `(authorId, termId)` with a **partial unique index**
      `WHERE refined_from_id IS NULL` — one *original* per user per term;
      refined versions exempt
- [x] Per-model AI user: added `GetModelUser(model)` in `lib/crud.ts`
      (get-or-create `isAi` user with `name = model`). **Decision made
      during implementation:** the legacy `GetAiUser()` stays untouched so
      the term-level auto-AI definitions keep their existing owner; only
      co-authorship uses per-model users. Renaming/backfilling the generic
      AI user remains an open item.
- [x] `definitions.delete` cascade in `trpc/routers/definitions.ts` extended:
      per-definition cleanup helper now also deletes refinement rounds and
      coauthor rows, and refined children are deleted before their original
      (FK order). Note: only originals can be refined (the refine panel is
      restricted to `refinedFromId IS NULL`), so one level of children
      suffices.

**Done when:** migration applies cleanly to a copy of the dev DB; existing
add/vote/comment flows are unaffected.
**Verified 2026-07-20:** migration `0011_right_deadpool.sql` applied to the
local dev DB; `tsc --noEmit` clean; psql transaction test confirmed the
partial index rejects a duplicate original and accepts a refined version
for the same (author, term).

## Phase 2 — Ollama layer & prompt

- [x] Added `"refine"` prompt to `lib/prompts.json` (editor persona: keep the
      user's intent, correct errors, address feedback). Overridable via
      `REFINE_PROMPT_KEY` env var (defaults to `"refine"`).
- [x] Parameterized `lib/apis/ollama.ts`: `resolvePromptKey(key)`,
      `makeGenerationStamp(promptKey, promptText)`, `runLLM(messages,
      systemPrompt?)`. Define-flow behavior and env precedence unchanged;
      new exports `RefinePromptKey` / `RefineSystemPrompt` /
      `refineGenerationStamp`.
- [x] `runRefinementRound(refinementId)` in `lib/apis/ollama.ts`: replays
      the negotiation chronologically (each round's feedback comment before
      its suggestion; failed rounds contribute feedback but no assistant
      turn), calls the LLM with the refine prompt, writes suggestion + stamp
      → `suggested`, or `failed` + `errorMessage` and rethrows.

**Done when:** a round row can be driven from `pending` to `suggested`
against local Ollama, with correct refine-prompt stamps on the row.
**Verified 2026-07-20:** one-off tsx script drove a real round for
definition 63 (metal-organic framework) through the live model — status
`suggested`, stamp `model=gemma4:26b promptKey=refine`, sensible improved
definition/example. Test rows cleaned up.

## Phase 3 — tRPC `refinements` router

New router `trpc/routers/refinements.ts`, registered in `_app.ts`.

- [x] `list({definitionId})` — rounds for rendering cards (author-only)
- [x] `request({definitionId, comment?})` — author-only; rejects if a round
      is pending; requires a comment when a `suggested` round is open
      (re-evaluation) and marks that round `superseded`; fires
      `runRefinementRound` via `after()`
- [x] `accept({refinementId})` — as designed, plus guards (round must be
      `suggested`). Coauthor row uses `GetModelUser(round.model)`.
- [x] `keep({refinementId})` — mark `kept`, set `decidedAt`
- [x] `retry({refinementId})` — added during implementation: resets a
      `failed` round to `pending` (clearing `errorMessage`/`suggestedAt`)
      and re-runs generation
- [x] `definitions.create` gained an `interactive: boolean` flag that skips
      chat-seeding + auto `reviseDefinition()` and stamps
      `createdVia = 'interactive'`
- [x] Known edge (accepted, documented): a term born interactively never gets
      the auto-AI definition, even if later defined via classic `/add`
      (auto-AI only fires on brand-new terms — same as today)

**Done when:** the full request → suggest → re-evaluate → accept/keep loop
works end-to-end from a tRPC client, with rows in the right states.
**Verified 2026-07-20** as part of the Phase 6 browser run (see below).

## Phase 4 — UI

- [x] `app/add/interactive/page.tsx` — reuses `DefineTermForm` (new
      `interactive` prop); classic `/add` untouched
- [x] `components/definition/refine-panel.tsx` — mounted on
      `/definition/[id]` for the author when `createdVia = 'interactive'`
      and the definition is an original (`refinedFromId` null):
      - [x] Refine button → creates round 1; "Refine again" after a decided
            session (no comment required when no suggestion is open)
      - [x] Pending card with spinner; polls `refinements.list` every 2 s
            while pending (refresh-safe)
      - [x] Suggested card: word-level LCS diff highlighting
            (`lib/word-diff.ts`) vs. current text; Accept / Keep mine /
            comment + Re-evaluate (disabled until feedback typed)
      - [x] Failed card: explicit error + Retry (no silent fallback)
      - [x] Decided rounds collapse to `<details>` status lines (accepted /
            kept / replaced-after-feedback), expandable to the suggestion
- [x] Co-author display: `definitions.get` returns `coauthors` +
      `refinedVersionId`; definition page renders "Authors: Chris and
      gemma4:26b", plus "Refined from the original definition" /
      "See the AI-refined version" cross-links; term-page list cards show a
      "Refined with <model>" badge (`components/definition.tsx`)

**Done when:** the whole loop is usable in the browser, refresh-safe
mid-generation, and the refined definition displays both authors.
**Verified 2026-07-20** — full browser run, see Phase 6.

## Phase 5 — Provenance extension & public view

- [x] Extended `buildTermProvenance` (`lib/provenance.ts`) as designed. Also
      added a `suggestedAt` column to `definitionRefinements` (migration
      0012) so the suggestion event has a real timestamp, and refined
      definitions get "Refined definition vN" entity labels + "Accept AI
      suggestion" activity labels + coauthor `wasAttributedTo` edges.
- [x] New timeline event kinds: refine-requested / refine-suggested /
      refine-accepted / refine-kept / refine-failed (icons in
      `components/provenance/timeline.tsx`)
- [x] `graph.tsx` / `timeline.tsx` moved (git mv) to
      `components/provenance/`; admin page imports updated
- [x] Public endpoint `terms.provenance` (baseProcedure) + page at
      `/terms/[termId]/provenance`; "Provenance" link on the term page
- [x] Public variant passes `{ anonymizeVoters: true }` — vote events show
      "A community member"; `admin.provenance` unchanged (full detail)

**Done when:** a refinement session is visible in both graph and timeline,
and the public page renders for a logged-out visitor.
**Verified 2026-07-20:** public page for the test term shows the full
negotiation in graph and timeline (suggestion entities, refine activities,
model + refine-prompt nodes, feedback entity, dual-attributed refined
definition); the public endpoint on a voted term returned
"A community member" for all vote events.

## Phase 6 — Verification & polish

Browser run 2026-07-20 (dev server + Playwright, dev-login user, live
Ollama; test data left in the dev DB deliberately — terms
"spinodal decomposition" (definitions 80/81, interactive + refined) and
"work hardening" (classic + auto-AI), useful as demos):

- [x] Interactive add → definition page → Refine → suggestion (round 1) →
      **accepted** (clicked by Chris live) → refined definition 81 published
      with authors "Dev User and gemma4:26b" and cross-links both ways
- [x] Round 2 ("Refine again") → feedback + Re-evaluate → round 2 marked
      "replaced after your feedback", round 3 suggestion demonstrably
      addressed the feedback (added spinodal region + ∂²G/∂x² < 0) →
      **Keep mine** → "you kept your original"
- [x] Provenance graph + timeline inspected for the refined term (public
      page); refined-definition event label fixed during review
      ("Refined definition published (accepted AI suggestion)")
- [x] Classic `/add` regression: new term "work hardening" got its chats
      seed (user + system rows) and an AI-user definition; the interactive
      term has neither — confirmed by SQL
- [x] `tsc --noEmit` clean; `next lint` no errors (pre-existing warnings
      only); migrations 0011 + 0012 applied to the dev DB
- [ ] Failure-path (Ollama down) not exercised live; the code path
      (`failed` status + errorMessage + Retry) exists but has only been
      reviewed, not observed

## Open items

- Confirm voter anonymization choice for the public provenance view
  (implemented as anonymized — "A community member"; admin view full
  detail; flip by dropping the option in `trpc/routers/terms.ts`).
- Decide fate of the existing generic AI user now that per-model AI users
  exist (`GetModelUser`); the generic one still owns the term-level auto-AI
  definitions.
- Exercise the failure path (Ollama down → `failed` round → Retry) once.
- The admin delete cascade for refinements/coauthors/refined children is
  code-reviewed but hasn't been run against real refined data.
- Everything is uncommitted on `feature/provenance` as of the Phase 6 run.

## Related: "anodized titanium" theme (2026-07-20)

A styling pass done right after this feature landed (same working tree,
uncommitted together). Everything routes through the shadcn token system in
`app/globals.css` so light/dark both carry it: titanium-gray neutrals,
anodized blue-violet `--primary`/`--ring`, and a reserved interference-gold
`--ai` token that marks all AI involvement (sparkles, AI badges, timeline
icons) — including this feature's refine panel and co-author display. Fonts
(revised same day): the full IBM Plex family — Plex Sans (body/UI), Plex
Serif (term headwords + logo), Plex Mono (model/prompt badges;
`--font-mono` previously aliased to Open Sans by mistake). Also fixed:
hardcoded body wash in `app/layout.tsx`, hardcoded header colors
(`components/header.module.css`), and the provenance graph's hardcoded node
colors — now `--prov-*` variables with light/dark variants. Form labels
app-wide use an eyebrow style (`components/ui/form.tsx`).
The header is a content-width (56rem) pill nav with token surfaces and
ghost link buttons, replacing the full-bleed dark strip. It is NOT sticky
(per Chris): page-level elements own the floating role instead — the
layout's content wrapper uses `overflow-x-clip` (not `-hidden`) exactly so
in-page `position: sticky` works. Browse (`app/terms/page.tsx`) was
redesigned to a single-column dictionary list: serif terms with "(count)"
in muted parentheses, violet letter markers with hairline rules, and a
sticky alphabetical index bar (the old two-column card grid, its CSS
module, and its LetterNav hamburger usage are gone; LetterNav itself
remains for the Tags page).
The homepage (`app/page.tsx`) was rebuilt on the same system: content
aligned to the navbar's 56rem column, same copy (lightly de-bulleted; a
garbled sentence fragment in Scott's bio was removed), a Get Started card
with search plus a session-aware Login / Define-a-term button, and a new
"Latest terms" section listing the four newest terms with definition
counts and added dates. `app/mycss.module.css` deleted; the search
button in `app/search-section.tsx` now uses tokens.
The definition list card (`components/definition.tsx`) was cleaned up:
eyebrow Definition/Example labels, a metadata footer with author
attribution (gold sparkle + model name for AI definitions, person icon +
name for humans — `definitions.list` now selects the author name), the
created date, and an always-present comment indicator ("N comments" in
accent when nonzero, muted "No comments" otherwise).
Provenance detail boxes (`components/provenance/detail.tsx`) parse the
stored message markers (`<term>`, `<definition>`, `<example>`,
`<feedback>`) into eyebrow-labeled sections instead of showing raw
markup, in both the timeline and the graph node panel. Backfilled votes
present their fallback date as the vote date with no placeholder caveat.

## Session log

- **2026-07-20** — Explored codebase, drafted plan, resolved design questions
  with Chris (see Decisions). Created this tracker. No code changes yet.
- **2026-07-20 (later)** — Implemented all six phases: migrations 0011
  (refinements, coauthors, definitions columns, partial unique index) and
  0012 (`suggestedAt`); refine prompt + parameterized stamping +
  `runRefinementRound`; `refinements` tRPC router (+ `retry`) and
  `interactive` create flag; `/add/interactive`, refine panel with word-diff
  cards, co-author display; provenance extension + shared components +
  public `/terms/[termId]/provenance` with anonymized voters. Verified
  end-to-end in the browser with live Ollama (Chris participated — clicked
  the round-1 Accept). Test terms left in dev DB as demos.
- **2026-07-20 (later still)** — Applied the anodized-titanium theme (see
  section above). Then made the interactive mode discoverable: `/add` and
  `/add/interactive` now share one form with a top toggle (decision 3
  amended), real instructions replaced the "Instructions will go here"
  stub, and the Definition/Examples placeholders got a worked austenite
  example. Verified in-browser: toggling swaps instructions + URL without
  losing typed input.
