# Instructions for AI Assistants — Content & Gameplay Phase

## Where this project is right now
The engine itself is **done**. All 10 engine modules (display, assets,
sprites/animation, world/background, screen manager + input, UI windows,
terminal/CLI, loop/glitch, audio/settings, bootstrap) exist, are wired
together, and run. From here on, work is **content and gameplay polish**,
not engine architecture — new features should be added as game-layer code
(`/src/game/...`) or data (manifests, JSON), not by rewriting engine
internals, unless something is a genuine bug in the engine itself.

## Project overview (read this before touching anything)

**What it is:** a Phaser 3 + vanilla JS top-down pixel-art game for a school
game jam (Ostravsky Game Jam, Oct 27–28 2026). Lore: the player is a
student trapped inside a simulation of their own school, resetting in a
loop, who hacks their way out through a fake-Kali terminal reached by
interacting with a PC in the world.

**Folder structure:**
```
/src/engine       <- generic engine systems, content-agnostic, avoid editing
/src/game         <- game-specific code: screen controllers, companions, bootstrap
/graphics         <- sprites, backgrounds, UI skins (manifest.json + PNGs per folder)
/screens          <- screen manifests (world, terminal, settings_modal)
/config           <- settings.default.json, controls.default.json
```

**Key systems already working:**
- `Actor` (module 04) — any manifest-driven sprite, 8-direction idle/walk
- `main_char` — the player, full 8-dir idle + walk
- `cat_companion` — a follower pet that trails the player with lag (see
  `/src/game/companions/Companion.js`); half-size, keeps distance, built to
  later support more states via `Companion.playAction(stateName)` once a
  manifest defines them (e.g. an `attack` state)
- World ↔ Terminal ↔ Settings, all via `ScreenManager` (stack-based, push/pop)
- Terminal: `CLIParser` + `fakeFileSystem.example.js` (placeholder content,
  meant to be replaced with real jam-theme content) + CRT overlay
- `LoopManager` / `FxManager` — fragment-collection progress + glitch visuals

**Known content gaps (not bugs, just not made yet):**
- `example_room` background has no real art (Phaser shows its default
  missing-texture checkerboard until a real PNG/tilemap is added)
- No collision tilemap yet — player currently walks through everything
- No real level-reset trigger (nothing calls `LoopManager.startNewLoop()`
  automatically yet — see `WorldScreenController.onInput`'s `cancel` case,
  currently a placeholder ESC-to-reset for testing)
- No audio files yet (AudioManager works, nothing is loaded)

## How to request changes (rules for every session from here on)

1. **State the project overview above** (or attach this whole file) at the
   start of a new session so the AI has full context without guessing.
2. **Attach the current project zip** every time — never assume the AI
   remembers earlier sessions.
3. **Say how big the change is**, and expect output sized accordingly:
   - Small change (a handful of files: tune a constant, fix one bug, tweak
     one manifest) → AI should return **only the changed files**, named
     exactly as their project path, ready to drop in individually.
   - Large change (new module, restructuring, first pass on a new content
     area) → AI should return the **whole project zipped**.
   - If genuinely unsure which this is, ask the AI to default to "only
     changed files" and say explicitly if a return to full-zip is needed.
4. **Be specific about symptoms, not guesses at causes** — e.g. "the cat
   stands on top of the player" rather than "fix the follow distance math"
   — let the AI diagnose; it has the actual code, you're describing the
   visible behavior.
5. **One request, one theme.** Don't bundle five unrelated asks into one
   message if they'd touch unrelated files — easier to verify each fix in
   isolation, especially under jam time pressure.

## Game-specific instructions (fill this in as decisions get made)

Use this section to paste anything that should guide **every** future
session — lore decisions, tone, naming conventions chosen, things to never
do. Keep it updated as you decide things, and attach it alongside the
project zip in every session from here on.

```
[JAM THEME, once revealed]:

[CONFIRMED LORE / TONE DECISIONS]:

[CHARACTER NAMES / FINAL ASSET NAMING]:

[THINGS THAT ARE INTENTIONAL, DON'T "FIX" THEM]:
- e.g. "the cat is slower than the player on purpose — don't speed it up"

[THINGS STILL UNDECIDED — DON'T GUESS, ASK]:
```

## Testing checklist (run after every change, however small)
- `npm run dev`, check browser console for errors
- Move the player, confirm the cat follows at a visible distance
- Interact with the PC, confirm the terminal opens centered and the prompt
  line is attached directly under the output (not drifted)
- Open settings via confirm/menu action, confirm it also opens centered
- Exit back to World, confirm nothing was destroyed twice / left dangling
  (check console for errors on scene transitions specifically)