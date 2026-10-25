import { ScreenController } from '../../engine/screens/ScreenController.js';
import { QuestManager } from '../../engine/quest/QuestManager.js';

/**
 * "Quest Log" screen: a read-only, always-current view of the quest system (module `engine/quest/
 * QuestManager.js`), toggled between an "Active" tab (live progress on every assigned, unfinished
 * quest) and a "Completed" tab (the permanent trace of every quest ever finished, most recent
 * first). Built the same way `TerminalScreenController` composes `scrollable-text` (this screen's
 * one `ui_window`, `quest_log_panel`): the window is static (two tab buttons, a close button, one
 * `scrollable-text` output panel); everything dynamic is redrawn into that one element.
 *
 * TAB SWITCHING: the two tab buttons are plain `WindowManifest` button elements (`action:
 * "quest-log-tab:active"` / `"quest-log-tab:completed"`) that go through `ActionRegistry`, same as
 * every other button in this project — `ActionRegistry` has no notion of "the current screen", so
 * `game/bootstrap/registerControllers.js`'s caller (module 11-equivalent, `main.js`) registers the
 * `quest-log-tab` verb once at boot, closing over `engine.screenManager` to reach whichever
 * controller instance is currently on top (`engine.screenManager.topController`) and call
 * `setTab()` on it.
 *
 * SELECTING THE TRACKED QUEST: on the Active tab, one quest is always highlighted (`\u25b6`) —
 * `menu-up`/`menu-down` (profile `quest-log`, UP/DOWN) move the highlight, `confirm` (ENTER) calls
 * `QuestManager.setTrackedQuest()` on whichever quest is highlighted, which is what the World
 * screen's top-left HUD line always shows (see `WorldScreenController._refreshQuestHud`). The
 * currently tracked quest is marked `(tracked)` regardless of which one is highlighted.
 *
 * LIVE UPDATES: subscribes to `QuestManager.events`' `'quest:updated'` for the lifetime of this
 * screen, so progress made in the World (collecting an item, reaching a spot) while this screen
 * is NOT open is already reflected the moment it's opened (onEnter always redraws first), and any
 * progress that could still happen while it IS open stays in sync live.
 * @module game/controllers/QuestLogScreenController
 */
export class QuestLogScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const outputHandle = this.windows[0];
    this.output = outputHandle.getElement('output');

    /** @type {'active'|'completed'} */
    this.tab = 'active';
    /** Index into `QuestManager.getActiveQuests()` currently highlighted (Active tab only). @type {number} */
    this.selectedIndex = 0;

    /** Parallel to `output`'s committed `lines`: which quest (by index into the tab's current
     * list) line N belongs to, or `null` for a blank/footer line that selects nothing. Rebuilt by
     * every `_redraw()`. @type {Array<number|null>} */
    this._lineQuestIndex = [];

    // CLICKING A QUEST: mouse-equivalent of [UP/DOWN]+[ENTER] — a click anywhere inside a quest's
    // block (title, description, or an objective line) selects AND immediately tracks it, since
    // there's no separate "confirm" gesture for a pointer the way ENTER is for the keyboard.
    this.output.onLineClick = (lineIndex) => {
      if (this.tab !== 'active') return;
      const questIndex = this._lineQuestIndex[lineIndex];
      if (questIndex === null || questIndex === undefined) return;
      const quests = QuestManager.getActiveQuests();
      if (questIndex >= quests.length) return; // stale click racing a live update; ignore it
      this.selectedIndex = questIndex;
      QuestManager.setTrackedQuest(quests[questIndex].id);
      // No explicit _redraw() here either, same reasoning as the ENTER branch in onInput below:
      // setTrackedQuest emits 'quest:updated', which _onQuestsUpdated already redraws for.
    };

    this._onQuestsUpdated = () => this._redraw();
    QuestManager.events.on('quest:updated', this._onQuestsUpdated);

    this._redraw();
  }

  /**
   * Switches which tab is shown and redraws. Called by the `quest-log-tab` action registered in
   * `main.js` (see class docstring).
   * @param {'active'|'completed'} tab
   * @returns {void}
   */
  setTab(tab) {
    if (tab !== 'active' && tab !== 'completed') return;
    this.tab = tab;
    this.selectedIndex = 0;
    this._redraw();
  }

  /**
   * Rebuilds the output panel's full contents from current `QuestManager` state.
   * @private
   * @returns {void}
   */
  _redraw() {
    this.output.clear();
    this._lineQuestIndex = [];

    /**
     * `output.appendLine`, but also records which quest (if any) this line belongs to so
     * `onLineClick` (set in `onEnter`) can map a click straight back to a quest. `questIndex:
     * null` for separator/footer lines, which select nothing.
     * @param {string} text
     * @param {number|null} questIndex
     * @returns {void}
     */
    const appendLine = (text, questIndex) => {
      this.output.appendLine(text);
      this._lineQuestIndex.push(questIndex);
    };

    const quests = this.tab === 'active' ? QuestManager.getActiveQuests() : QuestManager.getCompletedQuests();

    if (quests.length === 0) {
      appendLine(this.tab === 'active' ? '(no active quests)' : '(no quests completed yet)', null);
      return;
    }

    if (this.tab === 'active') this.selectedIndex = Math.min(this.selectedIndex, quests.length - 1);
    const trackedId = QuestManager.getTrackedQuestId();
    // Only the Active tab supports selecting/tracking a quest (by keyboard or by click); on the
    // Completed tab every line maps to `null` so a click there is just inert, same as before.
    const clickableIndex = (index) => (this.tab === 'active' ? index : null);

    quests.forEach((quest, index) => {
      if (index > 0) appendLine('', null);

      if (this.tab === 'active') {
        const cursor = index === this.selectedIndex ? '\u25b6' : ' ';
        const trackedTag = quest.id === trackedId ? ' (tracked)' : '';
        appendLine(`${cursor} ${quest.title}${trackedTag}`, clickableIndex(index));
      } else {
        appendLine(`* ${quest.title}`, clickableIndex(index));
      }
      if (quest.description) appendLine(`  ${quest.description}`, clickableIndex(index));
      for (const objective of quest.objectives) {
        const mark = objective.done ? '[x]' : '[ ]';
        appendLine(`  ${mark} ${objective.description} (${objective.current}/${objective.count})`, clickableIndex(index));
      }
      if (this.tab === 'completed') {
        appendLine(`  completed ${new Date(quest.completedAt).toLocaleString()}`, clickableIndex(index));
      }
    });

    if (this.tab === 'active') {
      appendLine('', null);
      appendLine('[UP/DOWN] or click a quest   [ENTER] track', null);
    }
  }

  /**
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {
    if (action === 'cancel') {
      this.engine.screenManager.pop();
      return;
    }
    if (this.tab !== 'active') return;

    const quests = QuestManager.getActiveQuests();
    if (quests.length === 0) return;

    if (action === 'menu-up') {
      this.selectedIndex = (this.selectedIndex - 1 + quests.length) % quests.length;
      this._redraw();
    } else if (action === 'menu-down') {
      this.selectedIndex = (this.selectedIndex + 1) % quests.length;
      this._redraw();
    } else if (action === 'confirm') {
      QuestManager.setTrackedQuest(quests[this.selectedIndex].id);
      // No explicit _redraw() call here: QuestManager.setTrackedQuest() emits 'quest:updated',
      // which this screen is already subscribed to (see onEnter) and which redraws for us.
    }
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /** @returns {void} */
  onExit() {
    QuestManager.events.off('quest:updated', this._onQuestsUpdated);
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}