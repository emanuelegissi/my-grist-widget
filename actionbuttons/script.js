"use strict";

const config = {  // configuration: stores widget mapping 
  actionsCol: null, // real column id of the mapped "actionsCol"
};

const data = {  // reactive UI state for Vue 3
  btns: Vue.reactive([]), // list of {id,label,desc,color,onclick}
  busy: Vue.ref(false),   // disables buttons while applying actions
  err: Vue.ref(""),       // single error text shown in the widget
};

function clearErr() {
  data.err.value = "";
}

function handleErr(text) {
  const msg = String(text);
  console.error(msg);
  data.err.value = msg;
}

/**
 * Grist UserAction tuple looks like [Action name, Table, Records, Values]
 *  - Action name: the name of the action
 *  - Table: the name (id) of the table
 *  - Records: an id or an array of ids of the records (corresponds to $id)
 *  - Values: a dictionary of column names and their new values
 * See all actions in: grist-core/app/common/DocActions.ts
 * Examples:
 *   ["AddRecord", "Table1", null, {"Name": "Alice", "Age": 20}],
 *   ["RemoveRecord", "Table1", 18]
 *   ["BulkUpdateRecord", "Table1", [1, 2, 3], {"Name": ["A","B","C"], "Age": [1, 2, 3]}]
 */
function isUserActionTuple(x) {
  return Array.isArray(x) && typeof x[0] === "string" && x.length >= 2;
}

/**
 * Cell can be:
 *  - null/undefined => []
 *  - object => [object]
 *  - array => array
 */
function normalizeBtnsCell(cell) {
  if (cell == null) return [];
  if (Array.isArray(cell)) return cell;
  if (typeof cell === "object") return [cell];
  return [];
}

/**
 * Apply UserActions and select the last AddRecord row if present.
 */
async function applyActions(actions) {
  // Prevent double-click / concurrent runs
  if (data.busy.value) return;
  data.busy.value = true;

  // Clear any previous error only when we actually start
  clearErr();

  // Record indexes of AddRecord actions to find created row ids afterwards
  const addRecordIndexes = [];
  for (let i = 0; i < (actions || []).length; i++) {
    const a = actions[i];
    if (Array.isArray(a) && a[0] === "AddRecord") addRecordIndexes.push(i);
  }

  try {
    const res = await grist.docApi.applyUserActions(actions);
    const retValues = res && Array.isArray(res.retValues) ? res.retValues : null;

    // If AddRecord happened, try to select the last created row
    if (retValues && addRecordIndexes.length) {
      const idx = addRecordIndexes[addRecordIndexes.length - 1];
      const rv = retValues[idx];

      // retValues entry might be a number or {id: number} depending on API behavior
      const newRowId =
        (typeof rv === "number" && Number.isFinite(rv)) ? rv :
          (rv && typeof rv === "object" && typeof rv.id === "number") ? rv.id :
            null;

      if (newRowId != null) {
        await grist.setCursorPos({ rowId: newRowId });
      }
    }
  } catch (e) {
    handleErr(`Grant full access for writing. (${String(e).replace(/^Error:\s*/, "")})`);
  } finally {
    data.busy.value = false;
  }
}

/**
 * Valid button object shape (description/color optional):
 * {
 *   button: "Label",                  // required
 *   actions: [["UpdateRecord",...]],  // required
 *   description: "Tooltip",           // optional
 *   color: "#1486ff"                // optional
 * }
 */
async function updateBtns(record, mappings) {
  try {
    const row = record;

    // Resolve the real table column id from mapping.
    // mappings: { actionsCol: "<actualColumnId>" }
    const mappedColId = (mappings && mappings.actionsCol) ? mappings.actionsCol : config.actionsCol;

    // No mapping set yet => cannot proceed
    if (!mappedColId) {
      data.btns.length = 0;
      handleErr("Missing column mapping in widget settings.");
      return;
    }

    // No record selected (or not an object) => no buttons, no error
    if (!row || typeof row !== "object") {
      data.btns.length = 0;
      clearErr();
      return;
    }

    // Column not visible in current view => error (and no buttons)
    if (!Object.prototype.hasOwnProperty.call(row, mappedColId)) {
      data.btns.length = 0;
      handleErr(`Mapped column "${mappedColId}" is not visible.`);
      return;
    }

    // Read and normalize the cell value into a list
    const rawBtns = normalizeBtnsCell(row[mappedColId]);

    // Validate + build UI model
    const built = [];

    for (let i = 0; i < rawBtns.length; i++) {
      const btn = rawBtns[i];

      // Require only: button + actions
      if (!btn || typeof btn !== "object" || !btn.button || !btn.actions) {
        throw new Error(
          `Each item must be an object with required keys "button" and "actions".`
        );
      }

      // Validate actions list
      if (!Array.isArray(btn.actions) || !btn.actions.every(isUserActionTuple)) {
        throw new Error(
          `Invalid "actions". Expected an array of UserActions like [["AddRecord","Table1",null,{...}]]`
        );
      }

      // Optional description
      if (btn.description != null && typeof btn.description !== "string") {
        throw new Error(`Optional "description" must be a string.`);
      }

      // Optional color
      if (btn.color != null && typeof btn.color !== "string") {
        throw new Error(`Optional "color" must be a string (e.g. "#1486ff").`);
      }

      // Build the object your HTML expects
      built.push({
        id: `${row.id || "row"}-${i}`,                 // stable enough for v-for key
        label: String(btn.button),
        desc: btn.description == null ? "" : String(btn.description),
        color: btn.color == null ? "" : String(btn.color),
        onclick: () => applyActions(btn.actions),
      });
    }

    // Replace reactive array contents (keeps Vue reactivity)
    data.btns.length = 0;
    data.btns.push(...built);

    // Success => clear stale error
    clearErr();
  } catch (e) {
    data.btns.length = 0;
    handleErr(String(e).replace(/^Error:\s*/, ""));
  }
}

async function loadVueApp() {
  const { createApp } = Vue;

  const app = createApp({
    data() {
      return {
        btns: data.btns,
        busy: data.busy,
        err: data.err,
      };
    },
  });

  app.mount("#app");
}

function onRecord(record, mappings) {
  // Store mapping for later calls
  if (mappings && mappings.actionsCol) {
    config.actionsCol = mappings.actionsCol;
  }

  updateBtns(record, mappings);
}

function onNewRecord() {
  data.btns.length = 0;
  data.busy.value = false;
  clearErr();
}

function ready(fn) {
  if (document.readyState !== "loading") fn();
  else document.addEventListener("DOMContentLoaded", fn);
}

ready(async function () {
  loadVueApp();

  grist.onRecord(onRecord);
  grist.onNewRecord(onNewRecord);
  grist.ready({
    columns: [
      {
        name: "actionsCol",
        title: "Actions",
        optional: false,
        type: "Any",
        description: "Button object or array of button objects (with UserActions).",
        allowMultiple: false,
      },
    ],
    requiredAccess: "full",
    allowSelectBy: true,
  });
});
