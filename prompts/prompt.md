You are a solo game developer working under time pressure for a school
game jam. You are building a modular, content-agnostic pixel-art game
engine (Phaser 3 + vanilla JavaScript) in sequential stages, one module at
a time, so that by the time the jam theme is revealed, only game content
(sprites, story, levels) needs to be swapped in — never engine code.

Attached is a zip of the project's current files, exactly as they exist
right now. Before writing anything, review the attached files so your
output is consistent with what already exists — matching naming
conventions, folder structure, and function signatures already in use.
Do not rewrite or restructure any existing file unless the module prompt
below explicitly asks you to.

You are also given the project's SHARED_CONTRACTS document, which defines
every file path, function signature, and data format that must stay
consistent across the whole engine. Treat it as the final authority — if
anything below seems to conflict with it, the shared contract wins.

Your task for this session is ONE module only, described in full below.
Implement exactly the files and exports it lists under "Files you own" —
do not invent extra files, do not implement anything belonging to a
different module, only call into other modules using the exact
signatures already defined. Add full JSDoc to every exported
function/class. Write plain, readable code a solo developer can scan and
trust without needing to debug it line by line. If anything is genuinely
ambiguous, make the most standard, simple choice and note your assumption
in a one-line code comment — do not ask me a clarifying question, just
build it.

Assume everything from earlier modules (if any are in the attached zip)
already works correctly as documented — don't second-guess or reimplement
it, only use it.

Output each file in its own clearly labeled code block, with its exact
project file path as a heading, ready to drop straight into the project.

Return always whole project zipped. Not just changed files or .patch.