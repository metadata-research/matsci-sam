# Live Demo Script: Interactive AI Refinement and Provenance

A run-of-show for demonstrating the interactive refinement feature, the
co-authorship model, and the PROV-O provenance view. Total time is about
10 minutes with one live generation round, or 15 with two.

## Before the demo

- Start the app and log in. On the dev machine that is `pnpm dev` plus
  `/api/auth/dev-login`.
- Warm the model. The first generation after idle pays a model load of
  roughly 20 to 30 seconds. Run one throwaway refinement round (or one
  classic term creation) 10 minutes before the demo so live rounds return
  in a few seconds.
- Confirm the finished exhibit exists. Term 40, "martensite", with
  definitions 84 (original) and 85 (refined), is the prepared fallback if
  the live generation misbehaves.
- Decide the live term. Use the primary below. Each rerun of the demo
  needs a fresh term, so backups are included. If a term was already used,
  delete it first (see Reset, at the end).

## Act 1. The site in one minute

Open the homepage.

- Point out the Latest terms section. The newest entries update as terms
  are defined, so today's demo term will appear here by the end.
- Toggle dark and light mode once. Everything shifts together, including
  the provenance graph shown later. One sentence of framing: gold marks
  AI involvement everywhere on the site, violet marks interactive
  elements.
- Click Browse. Show the single-column dictionary, the definition counts
  in parentheses, and the sticky letter index while scrolling.

## Act 2. Define a term interactively (live generation)

Navigate to Add, then flip the "Interactive AI refinement" toggle. Read
the toggle description aloud. It states the contract: the model suggests,
the author decides, an accepted suggestion is published as a separate
definition credited to both.

Enter the primary term. The draft is deliberately imprecise. Say so. The
point of the feature is that a rough first draft is a legitimate starting
point.

**Term**

```
sintering
```

**Definition**

```
A process where powder is heated so the particles stick together and form a solid piece.
```

**Examples**

```
Ceramic mugs are made by sintering clay powder in a kiln.
```

Click Create, then click "Refine with AI" on the definition page.

While the pending card polls (a few seconds warm, up to half a minute
cold), explain what is being recorded: the round row already exists in
the database with the request timestamp, and every round records the
exact prompt hash and model name, which the provenance view will surface.

When the round 1 suggestion appears, read it and point at the word-level
diff highlighting. Then decline to accept it. Type feedback and click
Re-evaluate.

**Feedback for round 2**

```
State that sintering happens below the melting point and that densification occurs by atomic diffusion across particle boundaries. Mention that it applies to metals and ceramics as well.
```

When round 2 arrives, show that the suggestion incorporated the feedback,
and that round 1 collapsed to "replaced after your feedback". Click
Accept suggestion.

The browser lands on the refined definition. Point at three things.

- The authors line: "Dev User and (gold sparkle) gemma4:26b". The model
  is credited by name, GitHub style, never as a generic "AI".
- The link "Refined from the original definition", and on the original,
  the reverse link plus the collapsed round history.
- Back on the term page, the refined entry shows a "Refined with
  gemma4:26b" badge, and both entries show their comment state.

## Act 3. Community signals

Still on the refined definition, cast an upvote, then post a comment.

**Comment**

```
A note on the driving force, reduction of total surface energy, would strengthen this further.
```

One sentence of framing: votes and comments are ordinary community
mechanics, and both flow into provenance, with voter identity withheld on
the public view.

## Act 4. Provenance

From the term page, click Provenance. This is the payoff slide.

In the graph, click through nodes in roughly this order.

1. The green term node.
2. "Definition v1", the human draft, wired to "Write definition" and the
   author.
3. "Refine definition (round 1)" and its suggestion entity. Show the
   edges to the "prompt: refine" node and the gemma4:26b agent node. Every
   generation is pinned to the exact prompt text and model.
4. "Refine feedback (round 2)". The author's words are a first-class
   entity that the round 2 activity used.
5. "Refined definition v1 (current)". It was derived from both the
   accepted suggestion and the original, and it is attributed to both
   co-authors. This is the co-authorship model, stated in W3C PROV-O.
6. The comment node.

Scroll to the timeline and walk it top to bottom. It reads as a
narrative: term created, definition written, refinement requested,
suggestion, re-evaluation with the feedback text, second suggestion,
refined definition published, suggestion accepted, an upvote by "A
community member", and the comment. Point at the model and prompt badges
on the AI events.

If the audience is technical, mention that none of this is a separate
log. The provenance is derived on demand from the domain tables, so it
cannot drift from the data.

## Act 5 (optional). The classic path still exists

Open Add with the toggle off and read the description: the term gets an
independent AI definition for comparison, the original behavior. Skip
the actual creation unless there is time to burn a generation, and use
"grain boundary" if so.

## Fallbacks

- If generation is slow, keep talking over the pending card. The polling
  UI is honest about the wait and survives a page refresh.
- If Ollama is down, the round fails with a visible error card and a
  Retry button. That is itself demonstrable. Then switch to the finished
  martensite exhibit: `/definition/85`, then `/terms/40/provenance`,
  which contains the identical story already told.

## Backup terms

Use these for reruns, with the same beats as Act 2.

**annealing**

- Definition: `Heating a metal and letting it cool slowly so it becomes softer and easier to work with.`
- Example: `Copper pipe is annealed so it can be bent without cracking.`
- Feedback: `Add that annealing relieves internal stresses through recovery, recrystallization, and grain growth, and that glasses are annealed as well as metals.`
- Comment: `Consider distinguishing full annealing from stress-relief annealing in a later revision.`

**quenching**

- Definition: `Cooling hot metal very fast by putting it in water or oil to make it harder.`
- Example: `The blacksmith quenched the blade in oil after forging.`
- Feedback: `State that the rapid cooling suppresses diffusion and can trap a metastable phase, such as martensite in steel. Note that polymers and glasses can also be quenched.`
- Comment: `This pairs well with the martensite entry. Cross-referencing the two would help readers.`

The quenching comment lands especially well when the martensite exhibit
was shown earlier, since it ties the two entries together.

## Reset between reruns

Demo terms can stay (they are legitimate entries), but to rerun the live
act with the same term, delete it as an admin: open the definition, use
Delete Definition on the refined version's original (the cascade removes
refinement rounds, co-author rows, and the refined child), and repeat for
any remaining definitions of the term. Deleting the last definition
removes the term itself.
