"use strict";

/* =========================
   STATE (Vue 3)
========================= */

const state = {
  btns: Vue.reactive([]),
  busy: Vue.ref(false),
};

/* =========================
   ERRORS
========================= */

function fail(text) {
  const msg = String(text);
  console.error(msg);
  alert(msg);
}

/* =========================
   TYPE CHECKS
========================= */

function isPlainObject(x) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function isUserActionTuple(x) {
  return Array.isArray(x) && typeof x[0] === "string" && x.length >= 2;
}

function isNewRecordAction(x) {
  return Array.isArray(x) && x[0] === "NewRecord";
}

function isLinkAction(x) {
  return (
    Array.isArray(x) &&
    x[0] === "Link" &&
    typeof x[1] === "string" &&
    (x[2] == null || typeof x[2] === "string")
  );
}

function isSupportedActionItem(x) {
  return isUserActionTuple(x) || isNewRecordAction(x) || isLinkAction(x);
}

/* =========================
   NORMALIZE CELL -> [buttons]
========================= */

function normalizeButtonsCell(cell) {
  if (cell == null) return [];
  if (Array.isArray(cell)) return cell;
  if (isPlainObject(cell)) return [cell];
  throw new Error(`The actionCol cell must be null, a button object, or an array of button objects.`);
}

/* =========================
   EXECUTION
========================= */

function execLink(url, target) {
  if (!target) window.location.href = url;
  else window.open(url, target);
}

async function applyUserActionsOnce(userActions) {
  if (!userActions.length) return;

  // table linked to this widget
  let selectedTableId = null;
  try {
    selectedTableId = await grist.selectedTable.getTableId();
  } catch {
    selectedTableId = null;
  }

  // last AddRecord that targets selected table
  let addRecordIndex = null;
  for (let i = userActions.length - 1; i >= 0; i--) {
    const a = userActions[i];
    if (Array.isArray(a) && a[0] === "AddRecord" && a[1] === selectedTableId) {
      addRecordIndex = i;
      break;
    }
  }

  const res = await grist.docApi.applyUserActions(userActions);
  const retValues = res && Array.isArray(res.retValues) ? res.retValues : null;

  // select last created record (only if it was in the widget-linked table)
  if (retValues && addRecordIndex != null) {
    const rv = retValues[addRecordIndex];

    const newRowId =
      (typeof rv === "number" && Number.isFinite(rv)) ? rv :
      (rv && typeof rv === "object" && typeof rv.id === "number") ? rv.id :
      null;

    if (newRowId != null) {
      await grist.setCursorPos({ rowId: newRowId });
    }
  }
}

/**
 * Simplified rule:
 * 1) Run ALL user actions in ONE batch (if any).
 * 2) Then run remaining actions in order: NewRecord / Link.
 */
async function runActions(actions) {
  const userActions = [];
  const postActions = [];

  for (const a of actions) {
    if (!isSupportedActionItem(a)) {
      throw new Error(
        `Invalid action item. Allowed: UserAction tuple ["Action","Table",...], ["NewRecord"], ["Link", url, target?].`
      );
    }
    if (isNewRecordAction(a) || isLinkAction(a)) postActions.push(a);
    else userActions.push(a); // user action tuple
  }

  await applyUserActionsOnce(userActions);

  for (const a of postActions) {
    if (isNewRecordAction(a)) {
      await grist.setCursorPos({ rowId: "new" });
    } else if (isLinkAction(a)) {
      execLink(a[1], a[2]);
    }
  }
}

async function onClickButton(model) {
  if (state.busy.value || model.disabled) return;

  state.busy.value = true;
  try {
    await runActions(model._actions);
  } catch (e) {
    fail(String(e).replace(/^Error:\s*/, ""));
  } finally {
    state.busy.value = false;
  }
}

/* =========================
   VALIDATE + BUILD UI MODELS
========================= */

function buildButtons(cellValue, rowId) {
  const raw = normalizeButtonsCell(cellValue);
  const built = [];

  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];

    if (!isPlainObject(b)) throw new Error(`Each button must be an object.`);

    if (typeof b.button !== "string" || !b.button.trim()) {
      throw new Error(`Each button must have a non-empty string key "button".`);
    }

    if (!Array.isArray(b.actions)) {
      throw new Error(`Button "${b.button}" must have key "actions" as an array.`);
    }

    if (b.description != null && typeof b.description !== "string") {
      throw new Error(`Button "${b.button}": optional "description" must be a string.`);
    }

    if (b.color != null && typeof b.color !== "string") {
      throw new Error(`Button "${b.button}": optional "color" must be a string.`);
    }

    // Validate action items
    for (const a of b.actions) {
      if (!isSupportedActionItem(a)) {
        throw new Error(
          `Button "${b.button}" has an invalid action item. ` +
          `Allowed: UserAction tuple ["Action","Table",...], ["NewRecord"], ["Link", url, target?].`
        );
      }
    }

    const model = {
      id: `${rowId || "row"}-${i}`,
      label: b.button,
      desc: b.description ?? "",
      color: b.color ?? "",
      disabled: b.actions.length === 0,
      _actions: b.actions,
      onclick: null,
    };

    model.onclick = () => onClickButton(model);
    built.push(model);
  }

  return built;
}

/* =========================
   GRIST -> UI
========================= */

function onRecord(record, mappings) {
  try {
    const colId = mappings?.actionCol;
    if (!colId) throw new Error(`Missing column mapping in widget settings (actionCol).`);

    if (!record || typeof record !== "object") {
      state.btns.length = 0;
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(record, colId)) {
      throw new Error(`Mapped column "${colId}" is not visible in the current view.`);
    }

    const built = buildButtons(record[colId], record.id);
    state.btns.length = 0;
    state.btns.push(...built);
  } catch (e) {
    state.btns.length = 0;
    fail(String(e).replace(/^Error:\s*/, ""));
  }
}

function onNewRecord() {
  state.btns.length = 0;
}

/* =========================
   VUE APP
========================= */

function loadVueApp() {
  const { createApp } = Vue;
  createApp({
    data() {
      return { btns: state.btns, busy: state.busy };
    },
  }).mount("#app");
}

/* =========================
   BOOTSTRAP
========================= */

function ready(fn) {
  if (document.readyState !== "loading") fn();
  else document.addEventListener("DOMContentLoaded", fn);
}

ready(() => {
  loadVueApp();

  grist.onRecord(onRecord);
  grist.onNewRecord(onNewRecord);

  grist.ready({
    requiredAccess: "full",
    allowSelectBy: true,
    columns: [
      {
        name: "actionCol",
        title: "Actions",
        optional: false,
        type: "Any",
        description:
          "Null, a button object, or an array of button objects. " +
          'Button: {button, actions, description?, color?}. ' +
          'Actions: UserAction tuples, ["NewRecord"], ["Link", url, target?].',
        allowMultiple: false,
      },
    ],
  });
});

