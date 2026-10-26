# How To Use This Prompt Set — Sequential Build Workflow

## What changed from the original plan
Originally written for 10 fully isolated AI sessions. In practice: build
**sequentially, in order, in one evolving project**, testing after every
step. Each module still gets its own fresh AI session (clean context =
consistent output), but each session also receives the **whole project
as it currently exists**, so nothing is built blind.

## The wrapper prompt (use this exact text, every single time)

Paste this first, then the current module's `.md` file content right after
it, in every new session:

## viz prompt.md

## The per-module loop (repeat for every module, in order)

1. **Zip your current project folder.**
2. Open a **new** AI session/chat (don't reuse the previous module's chat —
   fresh context avoids drift).
3. Attach: the zip from step 1, `01_SHARED_CONTRACTS.md`, the wrapper
   prompt above with that module's `.md` file content pasted in at the
   bottom.
4. Take the returned project zip, unzip it over your project folder
   (overwrite).
5. **Run it before doing anything else:**
   ```bash
   npm install        # only needed the first time, or if deps changed
   npm run dev
   ```
6. Check the specific thing that module should now do (see the test
   checklist below). Open the browser console — zero errors is the bar,
   not "it looks okay."
7. If something's broken: go back into the **same session** (not a new
   one) and describe the exact error/behavior. Fix it there before moving
   to the next module — don't carry a known-broken module forward.
8. Only once it runs clean: zip the project again, this becomes the
   "current files" attachment for the next module's session.
9. Move to the next module in the build order below.

## Build order and what "it works" means at each step

| # | module | run `npm run dev` and confirm |
|---|---|---|
| 1 | `02_display_rendering_core.md` | blank canvas at correct internal resolution, zero console errors |
| 2 | `03_asset_registry_loader.md` | write one throwaway test manifest; confirm `AssetRegistry.scan()` validates it and `getSpriteManifest()` returns it; confirm an intentionally broken manifest throws a clear `AssetValidationError` |
| 3 | `04_sprite_animation_system.md` | swap in your real `mainchar1` sprite manifest; character renders and plays its idle animation |
| 4 | `06_screen_manager_input.md` | `ScreenManager.switchTo('world')` works; arrow keys move something on screen |
| 5 | `05_world_background_system.md` | a background renders; one `InteractiveObject` triggers proximity detection correctly |
| 6 | `08_terminal_cli_subsystem.md` | pressing interact near the PC switches to the terminal; `help`, `ls`, `crack <password>` all respond correctly |
| 7 | `07_ui_window_system.md` | a settings window opens via `ScreenManager.push()`, a slider visibly changes a stored value |
| 8 | `09_loop_glitch_system.md` | `LoopManager.addFragment()` increases `glitchLevel()`; calling `FxManager.shake()` visibly shakes the camera |
| 9 | `10_audio_settings_persistence.md` | moving the volume slider from step 7 actually changes played audio volume; reloading the page keeps your settings (localStorage) |
| 10 | `11_bootstrap_integration.md` | the whole example game (World ↔ Terminal ↔ Settings) runs end-to-end from `npm run dev` with no manual glue code needed |

Do not skip ahead if a step fails its check — every later module assumes
every earlier one actually works, not just that code exists for it.

## Non-negotiable rules (repeat if the AI drifts mid-session)

- **No content coupling.** No engine file may contain a hardcoded
  character/background/screen/window id as a string literal — only in JSON
  manifests or the bootstrap module.
- **Fail loud.** Invalid/missing manifests or assets throw a descriptive
  error naming the exact file and field — never a silent fallback.
- **Exact Phaser syscalls only**, as specified per module — don't let
  different sessions invent different ways to do the same thing.
- **Full JSDoc on every export.**
- **Whole project zip out, every time** — never a diff/patch, so you can
  always just overwrite and run, no manual merging.