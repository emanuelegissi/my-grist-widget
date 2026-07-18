"use strict";

const buttonRow = document.getElementById("buttonRow");
let buttons = [];
let busy = false;

function fail(error) {
  const msg = error instanceof Error
    ? error.message
    : String(error).replace(/^Error:\s*/, "");
  console.error(msg);
  alert(msg);
}

function isPlainObject(x) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function isUserAction(action) {
  return Array.isArray(action) &&
    typeof action[0] === "string" &&
    action.length >= 2 &&
    action[0] !== "NewRecord" &&
    action[0] !== "Link";
}

function normalizeButtonsCell(cell) {
  if (cell == null) return [];
  if (Array.isArray(cell)) return cell;
  if (isPlainObject(cell)) return [cell];
  throw new Error(`The actionCol cell must be null, a button object, or an array of button objects.`);
}

async function getSelectedTableId() {
  if (typeof grist.getSelectedTableId === "function") return await grist.getSelectedTableId();
  if (grist.selectedTable && typeof grist.selectedTable.getTableId === "function") return await grist.selectedTable.getTableId();
  const table = grist.getTable?.();
  if (table && typeof table.getTableId === "function") return await table.getTableId();
  throw new Error("Unable to determine the selected table id.");
}

async function fetchSelectedTableData() {
  if (typeof grist.fetchSelectedTable === "function") return await grist.fetchSelectedTable();
  if (typeof grist.docApi?.fetchSelectedTable === "function") return await grist.docApi.fetchSelectedTable();
  throw new Error("Unable to read the selected table.");
}

function findClosestRowIdAfterRemoval(beforeIds, afterIdSet, removedRowId) {
  const removedIndex = beforeIds.indexOf(removedRowId);
  if (removedIndex === -1) return null;
  for (let i = removedIndex + 1; i < beforeIds.length; i++) {
    const rowId = beforeIds[i];
    if (afterIdSet.has(rowId)) return rowId;
  }
  for (let i = removedIndex - 1; i >= 0; i--) {
    const rowId = beforeIds[i];
    if (afterIdSet.has(rowId)) return rowId;
  }
  return null;
}

function getCursorTarget(action, selectedTableId) {
  if (action[1] !== selectedTableId) return null;

  const actionName = action[0];
  const records = action[2];
  const rowId = Array.isArray(records)
    ? records[records.length - 1]
    : records;

  if (actionName === "AddRecord" || actionName === "BulkAddRecord") {
    return { type: "added", rowId };
  }
  if (actionName === "UpdateRecord" || actionName === "BulkUpdateRecord") {
    return rowId == null ? null : { type: "row", rowId };
  }
  if (actionName === "RemoveRecord" || actionName === "BulkRemoveRecord") {
    return rowId == null ? null : { type: "removed", rowId };
  }
  return null;
}

function getReturnedRowId(result) {
  let value = result?.retValues?.[0];
  if (Array.isArray(value)) value = value[value.length - 1];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.id === "number" && Number.isFinite(value.id)) return value.id;
  return null;
}

async function applyUserAction(action) {
  const cursorTarget = getCursorTarget(action, await getSelectedTableId());
  const beforeIds = cursorTarget?.type === "removed"
    ? (await fetchSelectedTableData()).id || []
    : [];
  const result = await grist.docApi.applyUserActions([action]);
  if (!cursorTarget) return;

  let nextCursorRowId = null;

  if (cursorTarget.type === "added") {
    nextCursorRowId = cursorTarget.rowId ?? getReturnedRowId(result);
  } else if (cursorTarget.type === "row") {
    nextCursorRowId = cursorTarget.rowId;
  } else {
    const afterIds = (await fetchSelectedTableData()).id || [];
    const afterIdSet = new Set(afterIds);
    nextCursorRowId = findClosestRowIdAfterRemoval(beforeIds, afterIdSet, cursorTarget.rowId);
  }

  if (nextCursorRowId != null) await grist.setCursorPos({ rowId: nextCursorRowId });
}

async function runActions(actions) {
  for (const action of actions) {
    if (!isUserAction(action)) {
      throw new Error(
        `Invalid action item. Expected a Grist UserAction tuple ["Action","Table",...].`
      );
    }
  }

  for (const action of actions) await applyUserAction(action);
}

async function onClickButton(model) {
  if (busy || model.disabled) return;

  setBusy(true);
  try {
    await runActions(model.actions);
  } catch (e) {
    fail(e);
  } finally {
    setBusy(false);
  }
}

function buildButtons(cellValue) {
  return normalizeButtonsCell(cellValue).map((b) => {
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

    for (const a of b.actions) {
      if (!isUserAction(a)) {
        throw new Error(
          `Button "${b.button}" has an invalid action item. ` +
          `Expected a Grist UserAction tuple ["Action","Table",...].`
        );
      }
    }

    return {
      label: b.button,
      description: b.description ?? "",
      color: b.color ?? "",
      disabled: b.actions.length === 0,
      actions: b.actions,
    };
  });
}

function createButtonElement(model) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.textContent = model.label;
  button.disabled = busy || model.disabled;

  if (model.description) {
    button.title = model.description;
  }
  if (model.color) {
    button.style.backgroundColor = model.color;
  }
  if (!model.disabled) button.addEventListener("click", () => onClickButton(model));
  return button;
}

function renderButtons() {
  buttonRow.replaceChildren(...buttons.map(createButtonElement));
}

function setButtons(nextButtons) {
  buttons = nextButtons;
  renderButtons();
}

function setBusy(nextBusy) {
  busy = nextBusy;
  [...buttonRow.querySelectorAll("button")].forEach((button, index) => {
    button.disabled = busy || Boolean(buttons[index]?.disabled);
  });
}

function onRecord(record, mappings) {
  try {
    const colId = mappings?.actionCol;
    if (!colId) throw new Error(`Missing column mapping in widget settings (actionCol).`);

    if (!record || typeof record !== "object") {
      setButtons([]);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(record, colId)) {
      throw new Error(`Mapped column "${colId}" is not visible in the current view.`);
    }

    setButtons(buildButtons(record[colId]));
  } catch (e) {
    setButtons([]);
    fail(e);
  }
}

function onNewRecord() {
  setButtons([]);
}

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
        "Actions: Grist UserAction tuples.",
      allowMultiple: false,
    },
  ],
});
