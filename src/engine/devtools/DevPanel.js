/**
 * DEV-ONLY progress-skip panel. Not game content: it authors nothing, registers no quest/item/
 * screen, and never runs unless a developer opts in (see `attachDevPanel` below). Everything it
 * does goes through the same public APIs game content already uses — `QuestManager`,
 * `InventoryManager`, `engine.screenManager` — so skipping progress here behaves identically to
 * progress earned normally (events still fire, reward items still get granted, saves still work).
 *
 * USAGE (add to main.js, or wherever `EngineContext` is built, AFTER screenManager exists):
 *
 *   import { attachDevPanel } from './engine/devtools/DevPanel.js';
 *   if (DEV_MODE) attachDevPanel(engine); // DEV_MODE: your own flag, see bottom of this file
 *
 * Toggle in-game with the "<" key. Nothing is created until `attachDevPanel` is called,
 * and the whole thing is one <div> injected into document.body, cleanly removable by calling the
 * returned `destroy()`.
 *
 * @module engine/devtools/DevPanel
 */

import { QuestManager } from '../quest/QuestManager.js';
import { InventoryManager } from '../inventory/InventoryManager.js';

const PANEL_ID = 'devtools-skip-panel';

const STYLE = `
#${PANEL_ID} {
  position: fixed; top: 0; right: 0; width: 340px; max-height: 100vh; overflow-y: auto;
  background: rgba(12, 14, 18, 0.95); color: #d7e0e8; font: 12px/1.4 monospace;
  padding: 10px; z-index: 999999; border-left: 2px solid #4af;
  box-shadow: -4px 0 14px rgba(0,0,0,0.5);
}
#${PANEL_ID} h2 { font-size: 13px; margin: 10px 0 4px; color: #4af; border-bottom: 1px solid #234; }
#${PANEL_ID} h2:first-child { margin-top: 0; }
#${PANEL_ID} .row { display: flex; gap: 4px; margin: 3px 0; align-items: center; flex-wrap: wrap; }
#${PANEL_ID} button {
  background: #1b2430; color: #d7e0e8; border: 1px solid #39506a; border-radius: 3px;
  padding: 3px 6px; cursor: pointer; font: inherit;
}
#${PANEL_ID} button:hover { background: #2a3a4d; }
#${PANEL_ID} input {
  background: #0c0e12; color: #d7e0e8; border: 1px solid #39506a; border-radius: 3px;
  padding: 3px; font: inherit; width: 70px;
}
#${PANEL_ID} .quest { border: 1px solid #234; border-radius: 3px; padding: 4px; margin: 4px 0; }
#${PANEL_ID} .quest .obj { margin: 2px 0 2px 8px; }
#${PANEL_ID} .dim { opacity: 0.6; }
#${PANEL_ID} .hint { font-size: 11px; opacity: 0.55; margin-top: 8px; }
`;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value);
  });
  children.forEach((child) => el.appendChild(child));
  return el;
}

/**
 * Builds and mounts the panel, wired to the given, already-constructed EngineContext.
 * @param {object} engine - the EngineContext from `buildEngineContext()` (needs screenManager
 *   already attached, and engine.assetRegistry for the screen-jump list)
 * @param {{ hotkey?: string }} [options] - `hotkey` defaults to '<'
 * @returns {{ destroy(): void }}
 */
export function attachDevPanel(engine, options = {}) {
  const hotkey = options.hotkey ?? '<';

  if (document.getElementById(PANEL_ID)) {
    console.warn('[DevPanel] already attached; ignoring second attachDevPanel() call.');
    return { destroy() {} };
  }

  const styleEl = h('style', { text: STYLE });
  document.head.appendChild(styleEl);

  const panel = h('div', { id: PANEL_ID });
  panel.style.display = 'none';
  document.body.appendChild(panel);

  function render() {
    panel.innerHTML = '';
    panel.appendChild(h('h2', { text: 'DEV PANEL (press < to hide)' }));

    // --- Quests -----------------------------------------------------------
    panel.appendChild(h('h2', { text: 'Active quests' }));
    const activeQuests = QuestManager.getActiveQuests();
    if (activeQuests.length === 0) {
      panel.appendChild(h('div', { class: 'dim', text: '(none active)' }));
    }
    activeQuests.forEach((quest) => {
      const questEl = h('div', { class: 'quest' });
      questEl.appendChild(h('div', { text: `${quest.title} (${quest.id})` }));
      quest.objectives.forEach((objective) => {
        const line = h('div', { class: 'obj' });
        line.appendChild(h('span', {
          text: `${objective.done ? '✓' : '…'} ${objective.description ?? objective.id} [${objective.current}/${objective.count}]  `,
        }));
        if (!objective.done) {
          line.appendChild(h('button', {
            text: 'complete',
            onclick: () => {
              QuestManager.completeObjective(quest.id, objective.id);
              render();
            },
          }));
        }
        questEl.appendChild(line);
      });
      questEl.appendChild(h('button', {
        text: 'skip whole quest',
        onclick: () => {
          quest.objectives.forEach((objective) => {
            if (!objective.done) QuestManager.completeObjective(quest.id, objective.id);
          });
          render();
        },
      }));
      panel.appendChild(questEl);
    });

    const availableQuests = QuestManager.getAvailableQuests();
    if (availableQuests.length > 0) {
      panel.appendChild(h('h2', { text: 'Assign quest' }));
      const row = h('div', { class: 'row' });
      availableQuests.forEach((def) => {
        row.appendChild(h('button', {
          text: def.id,
          onclick: () => {
            QuestManager.assignQuest(def.id);
            render();
          },
        }));
      });
      panel.appendChild(row);
    }

    // --- Inventory ----------------------------------------------------------
    panel.appendChild(h('h2', { text: 'Give item' }));
    const giveRow = h('div', { class: 'row' });
    const itemInput = h('input', { placeholder: 'item_id' });
    const amountInput = h('input', { placeholder: 'amount', value: '1', style: 'width:45px' });
    giveRow.appendChild(itemInput);
    giveRow.appendChild(amountInput);
    giveRow.appendChild(h('button', {
      text: 'give',
      onclick: () => {
        const id = itemInput.value.trim();
        const amount = Number.parseInt(amountInput.value, 10) || 1;
        if (!id) return;
        QuestManager.collectItem(id, amount); // also progresses any matching collect_item objective
        render();
      },
    }));
    panel.appendChild(giveRow);
    const heldSlots = InventoryManager.getSlots().filter((s) => s.itemId !== null);
    panel.appendChild(h('div', {
      class: 'dim',
      text: 'current slots: ' + (heldSlots.length ? heldSlots.map((s) => `${s.itemId}x${s.count}`).join(', ') : '(empty)'),
    }));

    // --- Screens --------------------------------------------------------
    panel.appendChild(h('h2', { text: 'Jump to screen' }));
    const screenRow = h('div', { class: 'row' });
    const screenIds = engine.assetRegistry?.listScreenIds?.() ?? [];
    screenIds.forEach((id) => {
      screenRow.appendChild(h('button', {
        text: id,
        onclick: () => engine.screenManager.switchTo(id),
      }));
    });
    panel.appendChild(screenRow);

    // --- World -------------------------------------------------------------
    panel.appendChild(h('h2', { text: 'World' }));
    panel.appendChild(h('button', {
      text: 'teleport to underworld',
      onclick: () => {
        const worldController = engine.worldController;
        if (typeof worldController?.teleportToUnderworld !== 'function') {
          console.warn('[DevPanel] the world screen is not active; cannot teleport to underworld.');
          return;
        }
        worldController.teleportToUnderworld();
      },
    }));

    // --- Reset ------------------------------------------------------------
    panel.appendChild(h('h2', { text: 'Danger' }));
    panel.appendChild(h('button', {
      text: 'reset ALL progress (quests + inventory)',
      onclick: () => {
        if (!window.confirm('Reset all quest and inventory progress?')) return;
        QuestManager.resetAll();
        render();
      },
    }));

    panel.appendChild(h('div', { class: 'hint', text: 'Dev tool — calls the real QuestManager/InventoryManager/ScreenManager APIs. Nothing here edits game content.' }));
  }

  let visible = false;
  function setVisible(next) {
    visible = next;
    panel.style.display = visible ? 'block' : 'none';
    if (visible) render();
  }

  function onKeydown(event) {
    if (event.key !== hotkey) return;
    // Don't toggle the panel while the player is typing into a text field.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    setVisible(!visible);
  }
  window.addEventListener('keydown', onKeydown);

  // Keep the quest panel fresh if progress changes elsewhere while it's open.
  const onQuestUpdated = () => { if (visible) render(); };
  QuestManager.events.on('quest:updated', onQuestUpdated);

  console.info(`[DevPanel] attached. Press "${hotkey}" to toggle.`);

  return {
    destroy() {
      window.removeEventListener('keydown', onKeydown);
      QuestManager.events.off('quest:updated', onQuestUpdated);
      panel.remove();
      styleEl.remove();
    },
  };
}
