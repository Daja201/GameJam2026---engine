# Project Story Context — "What's Left Below" (working title)

This is the narrative and tonal source of truth for the game. Paste this
whole file into any AI development session alongside the technical project
context (SHARED_CONTRACTS, current zip) whenever a request touches story,
dialogue, flavor text, level naming, visual direction, or any
content-facing decision. Every piece of writing or art direction produced
for this game should be consistent with everything below — treat this as
canon, not as a suggestion to reinterpret.

## Premise

An imaginary totalitarian state. Freedom of movement, expression, and
thought is tightly controlled. The player character is a student who
attends school during the day, on the surface, like every other citizen —
compliant, observed, unremarkable on purpose.

The player has a close friend — a fellow student — who one day simply
**vanishes**. The system's official record marks her status as
**"Removed: Non-Compliant."** No further explanation is given, and none is
expected; this is how the system always handles people it decides don't
fit.

The player does not believe she is dead. The player believes she was taken
somewhere, and is determined to find out where — and to get her back.

Every evening, the player descends beneath the city into a network of
tunnels where an underground resistance operates, hacking the regime's
systems in search of any trace of where the "Removed" are actually sent.

The player has a cat. The cat is more than a companion — see **The Cat**
below for its mechanical and narrative role.

## The Core Loop (reset mechanic — narrative justification)

The underground is not safe indefinitely. The longer the player stays and
the more they dig, the more attention they draw. Eventually — every single
time, no matter how careful — **soldiers arrive** as the player tries to
leave the tunnels, and the player is tranquilized/put to sleep. This is
the moment the in-game loop resets.

The player wakes up back home, **with nothing**. No items, no files, no
notes, no progress carried on their own person — the system strips
everything from anyone caught near the underground, as a matter of
routine, not even particular suspicion of this one player specifically.

**The only thing that survives every reset is whatever was hidden inside
the cat.** The cat was never searched, never suspected, always let back
through — it carries a small number of items/data across the reset as a
literal, physical "flash drive" smuggling things between lives. This is
not a vague metaphor for memory; it is meant to be a concrete, diegetic
mechanic: the player deliberately chooses what to stash in the cat before
risking the walk out of the tunnels each night.

This mechanic should feel like genuine risk/tension each session: what you
don't manage to hide in the cat before the soldiers come, you lose.

## The Cat

- Narrative role: the one constant across every reset. It was not taken
  from the friend, nor is it explicitly stated (yet) to have belonged to
  her — keep this ambiguous for now rather than deciding it either way;
  it's a thread that can be resolved later in development, not before.
- Mechanical role: a small, dedicated inventory space (think: a few
  slots) that is the ONLY persistent storage across a loop reset.
  Everything else the player is carrying or has discovered is wiped on
  reset; only what was deliberately placed "in the cat" survives.
- Tone: the cat should read as a quiet source of stability and loyalty in
  an otherwise cold, controlling world — not comic relief, not a gimmick.

## The Antagonist — The Headmaster

The school's headmaster is not a minor authority figure to be merely
annoyed — he is **highly placed within the regime itself**. The
"tutorial" moment of provoking a teacher and hacking a school computer is
the player's **first real foothold** into a much larger structure, not an
isolated mechanic: the trail the player is actually following leads
upward through the school's own administration, not away from it.

The headmaster should be written as controlled, procedural, and
unemotional rather than cartoonishly evil — he enforces the system because
to him it simply **is** the correct order of things. This fits the
totalitarian tone better than a mustache-twirling villain would.

## Locations & Visual Language

### The School (Surface / Day)
- Palette: desaturated, washed-out, institutional. Pale greenish-grey
  fluorescent cast. Muted beige/grey surfaces. A single, sparingly used
  authoritarian red accent (signage, insignia) — never a dominant color.
- Mood: symmetry, repetition, silence, surveillance. Every day should
  visually feel identical on purpose — that sameness IS the oppression.

### The Tunnels (Underground / Night)
- Palette: near-black base (concrete, shadow), with high-contrast neon
  accents — **OLED-style saturated neon green and magenta/purple** as the
  primary accent pairing. This is the one place in the world that is
  visually ALIVE.
- Mood: cramped but vivid, lived-in, defiant. Exposed cabling and pipework
  as a recurring visual motif — a deliberate visual echo of network/data
  cabling, tying the physical underground to the act of hacking.
- The terminal's own color language (green glow, CRT feel) should feel
  like it belongs here, native to this space — not imported from
  elsewhere.

### Visual bridge between the two
As the player uncovers more fragments/progress, allow the underground's
color language to subtly bleed into the school (per LoopManager's
glitchLevel scaling, already supported by the engine's FxManager/ambient
tint systems) — the resistance's presence visually creeping into the
regime's sterile space as the player gets closer to the truth. This is a
visual storytelling beat, not just a difficulty indicator.

## Tone

Serious, restrained, quietly tense — not grim-dark, not played for shock,
not comedic. The world's oppression is bureaucratic and procedural rather
than violently dramatic (a vanished student is a filed status change, not
a scene of violence) — that mundane, administrative coldness is scarier
than overt brutality, and is cheaper to depict credibly within a jam's
scope. Avoid real-world national symbols, flags, or identifiable
real-world regimes — keep the setting clearly fictional.

## Suggested Round Structure (adjust to actual available dev time)

1. **Round 1 (tutorial):** the friend's disappearance is fresh; first
   provoked confrontation with a teacher leads to the first hack and
   first fragment — the player learns "Removed" is not what it claims
   to be.
2. **Round 2:** deeper into the tunnels, contact with others in the
   resistance also searching for someone — the player isn't alone in
   this.
3. **Round 3 (if time allows):** the trail leads explicitly toward the
   headmaster; the regime notices the player specifically, raising
   stakes on the next soldier encounter.
4. **Ending:** the truth about where "Removed" people are sent is
   revealed. Avoid a simple, clean rescue — a bittersweet or costly
   revelation fits this tone better than an uncomplicated happy ending;
   leave the exact shape of this to whoever writes the final content pass
   once remaining time is known.

## How this maps onto the existing engine (for whoever implements it)

- **LoopManager** — the reset IS the soldiers-and-tranquilizer event,
  finally giving the existing reset mechanic a real narrative trigger
  (previously a dev-only placeholder) — `startNewLoop()` should be called
  from that specific in-fiction moment, not an arbitrary timer.
- **The cat's inventory** — model as its own small, dedicated inventory
  slot set (separate from or a special flagged subset of the existing
  InventoryManager) that is explicitly exempt from whatever "wipe
  everything on reset" logic gets built for the player's normal
  items/fragments. Everything NOT stored there should be clearable on
  reset by design.
- **Fragments (LoopManager.addFragment)** — reframe as pieces of evidence
  about the friend's location, each with actual short in-fiction text,
  not abstract "exploit fragments."
- **World screen** — needs (at minimum conceptually) two background/tileset
  identities: School (day) and Tunnels (night), likely as two
  BackgroundLoader manifests swapped based on which "phase" the player is
  in, rather than two separate screens if that's cheaper to implement
  under time pressure.
- **Terminal** — stays mechanically as-is; `fakeFileSystem.js` content
  should be written as actual administrative/surveillance-state documents
  (status records, transfer logs, headmaster's correspondence) rather than
  generic "hacker" flavor text.
- **Headmaster as antagonist** — can reuse whatever NPC/interactive-object
  pattern already exists for the "teacher" tutorial moment; no new system
  needed, just consistent characterization across repeated encounters.

## What's intentionally NOT decided yet (do not invent answers for these)

- Whether the cat belonged to the missing friend
- The exact fate/location revealed at the end
- Whether the headmaster is ever confronted directly or only exposed
  remotely through evidence

Treat these as open threads the writer resolves deliberately later, not
gaps to improvise over when generating other content.