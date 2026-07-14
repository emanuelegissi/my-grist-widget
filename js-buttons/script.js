"use strict";

const OPTION_CONFIG_SOURCE = "configSource";
const OPTION_CONFIG_CODE = "configCode";
const OPTION_SHARED_TABLE_ID = "sharedConfigTableId";
const OPTION_SHARED_CONFIG_NAME = "sharedConfigName";

const CONFIG_SOURCE_LOCAL = "local";
const CONFIG_SOURCE_TABLE = "table";

const DEFAULT_SHARED_TABLE_ID = "JS_Button_Configs";
const DEFAULT_SHARED_CONFIG_NAME = "default";
const SHARED_NAME_COLUMN = "Name";
const SHARED_CODE_COLUMN = "Code";

const DEFAULT_CONFIG_CODE = `async function add_records_with_user_actions() {
  const tableId = await widget.getSelectedTableId();
  const countText = prompt("How many empty records should be added?", "2");

  if (countText === null) {
    return;
  }

  const count = Number.parseInt(countText, 10);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error("Enter a positive number of records.");
  }

  await widget.applyUserActions([
    ["BulkAddRecord", tableId, Array(count).fill(null), {}]
  ]);
}

async function update_current_record_with_user_actions() {
  const tableId = await widget.getSelectedTableId();
  const rowId = widget.requireCurrentRowId();
  const columnId = prompt("Column id to update, for example: Status");

  if (!columnId) {
    return;
  }

  const value = prompt("New value for " + columnId + ":", "");
  if (value === null) {
    return;
  }

  await widget.applyUserActions([
    ["UpdateRecord", tableId, rowId, {[columnId]: value}]
  ]);
}

async function remove_current_record_after_confirm() {
  const rowId = widget.requireCurrentRowId();

  if (!confirm("Remove current record " + rowId + "?")) {
    return;
  }

  await widget.removeCurrentRecord();
}

function get_buttons() {
  const currentRowId = widget.getCurrentRowId();
  const hasCurrentRecord = currentRowId != null && currentRowId !== "new";

  return [
    {
      label: "+ Add",
      title: "Create one empty record and select it.",
      background_color: "#16B378",
      color: "#FFFFFF",
      onclick: () => widget.addNewRecord()
    },
    {
      label: "+ Bulk add",
      title: "Create multiple empty records and select the last one.",
      onclick: () => add_records_with_user_actions()
    },
    {
      label: "Update current",
      title: "Prompt for a column id and update the current record.",
      disabled: !hasCurrentRecord,
      onclick: () => update_current_record_with_user_actions()
    },
    {
      label: "Remove current",
      title: "Remove the current record after confirmation.",
      background_color: "#D0021B",
      color: "#FFFFFF",
      disabled: !hasCurrentRecord,
      onclick: () => remove_current_record_after_confirm()
    },
    {
      label: "Widget docs",
      title: "Open Grist custom widget documentation in a new browser window.",
      onclick: () => widget.openUrl("https://support.getgrist.com/widget-custom/")
    },
    {
      label: "Hidden example",
      hidden: true,
      onclick: () => console.log("This button is hidden.")
    }
  ];
}`;

const buttonRow = document.getElementById("buttonRow");
const panelConfigButton = document.getElementById("panelConfigButton");
const statusBox = document.getElementById("status");
const configStatusBox = document.getElementById("configStatus");
const configDialog = document.getElementById("configDialog");
const configSourceSelect = document.getElementById("configSourceSelect");
const sharedConfigControls = document.getElementById("sharedConfigControls");
const sharedConfigTableIdInput = document.getElementById("sharedConfigTableId");
const sharedConfigNameInput = document.getElementById("sharedConfigName");
const loadSharedConfigButton = document.getElementById("loadSharedConfigButton");
const createSharedTableButton = document.getElementById("createSharedTableButton");
const configEditorContainer = document.getElementById("configEditor");
const configCodeFallback = document.getElementById("configCodeFallback");
const closeConfigButton = document.getElementById("closeConfigButton");
const resetConfigButton = document.getElementById("resetConfigButton");
const testConfigButton = document.getElementById("testConfigButton");
const saveConfigButton = document.getElementById("saveConfigButton");

let currentConfigOptions = normalizeOptions({});
let activeConfigCode = DEFAULT_CONFIG_CODE;
let getButtonsFunction = null;
let renderedButtons = [];
let busy = false;
let renderToken = 0;
let optionsToken = 0;
let currentAccessLevel = null;
let currentRecord = null;
let monacoEditor = null;
let monacoEditorPromise = null;

const widget = Object.freeze({
  getCurrentRecord() {
    return currentRecord;
  },

  getCurrentRowId() {
    return currentRecord?.id ?? null;
  },

  async getSelectedTableId() {
    if (typeof grist.getSelectedTableId === "function") {
      return await grist.getSelectedTableId();
    }

    const table = grist.getTable?.();
    if (table && typeof table.getTableId === "function") {
      return await table.getTableId();
    }

    throw new Error("Unable to determine the selected table id.");
  },

  requireCurrentRowId() {
    const rowId = widget.getCurrentRowId();

    if (rowId == null || rowId === "new") {
      throw new Error("Select an existing record first.");
    }

    return rowId;
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async applyUserActions(userActions) {
    if (!Array.isArray(userActions)) {
      throw new Error("userActions must be an array.");
    }

    const selectedTableId = await widget.getSelectedTableId();

    // Snapshot before running the actions.
    // This allows us to discover automatically assigned ids from AddRecord actions
    // and to choose a nearby cursor position after RemoveRecord actions.
    const before = await fetchSelectedTableData();
    const beforeIds = before.id || [];
    const beforeIdSet = new Set(beforeIds);

    let cursorTarget = null;

    for (const action of userActions) {
      if (!Array.isArray(action) || action.length < 2) {
        continue;
      }

      const actionName = action[0];
      const tableId = action[1];

      // Only move the cursor for records in the selected table.
      if (tableId !== selectedTableId) {
        continue;
      }

      if (actionName === "AddRecord") {
        const rowId = action[2];
        cursorTarget = rowId == null
          ? {type: "autoAdd"}
          : {type: "row", rowId};
      }

      if (actionName === "BulkAddRecord") {
        const rowIds = Array.isArray(action[2]) ? action[2] : [];
        const lastRowId = rowIds.length > 0 ? rowIds[rowIds.length - 1] : null;
        cursorTarget = lastRowId == null
          ? {type: "autoAdd"}
          : {type: "row", rowId: lastRowId};
      }

      if (actionName === "UpdateRecord") {
        const rowId = action[2];
        if (rowId != null) {
          cursorTarget = {type: "row", rowId};
        }
      }

      if (actionName === "BulkUpdateRecord") {
        const rowIds = Array.isArray(action[2]) ? action[2] : [];
        if (rowIds.length > 0) {
          cursorTarget = {type: "row", rowId: rowIds[rowIds.length - 1]};
        }
      }

      if (actionName === "RemoveRecord") {
        const rowId = action[2];
        if (rowId != null) {
          cursorTarget = {type: "removed", rowId};
        }
      }

      if (actionName === "BulkRemoveRecord") {
        const rowIds = Array.isArray(action[2]) ? action[2] : [];
        if (rowIds.length > 0) {
          cursorTarget = {type: "removed", rowId: rowIds[rowIds.length - 1]};
        }
      }
    }

    const result = await applyDocUserActions(userActions);

    // Snapshot after running the actions.
    const after = await fetchSelectedTableData();
    const afterIds = after.id || [];
    const afterIdSet = new Set(afterIds);
    const createdIds = afterIds.filter((id) => !beforeIdSet.has(id));

    let nextCursorRowId = null;

    if (cursorTarget?.type === "autoAdd") {
      nextCursorRowId = createdIds[createdIds.length - 1] ?? null;
    } else if (cursorTarget?.type === "row" && afterIdSet.has(cursorTarget.rowId)) {
      nextCursorRowId = cursorTarget.rowId;
    } else if (cursorTarget?.type === "removed") {
      nextCursorRowId = findClosestRowIdAfterRemoval(beforeIds, afterIdSet, cursorTarget.rowId);
    }

    // Fallback for AddRecord/BulkAddRecord with automatic ids in older examples.
    if (nextCursorRowId == null && createdIds.length > 0) {
      nextCursorRowId = createdIds[createdIds.length - 1];
    }

    if (nextCursorRowId != null) {
      await grist.setCursorPos({rowId: nextCursorRowId});
    }

    return result;
  },

  async addNewRecord() {
    const tableId = await widget.getSelectedTableId();

    await widget.applyUserActions([
      ["AddRecord", tableId, null, {}]
    ]);
  },

  async removeCurrentRecord() {
    const tableId = await widget.getSelectedTableId();
    const rowId = widget.requireCurrentRowId();

    await widget.applyUserActions([
      ["RemoveRecord", tableId, rowId]
    ]);
  },

  openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

function normalizeOptions(options) {
  const rawSource = options?.[OPTION_CONFIG_SOURCE];
  const configSource = rawSource === CONFIG_SOURCE_TABLE
    ? CONFIG_SOURCE_TABLE
    : CONFIG_SOURCE_LOCAL;

  return {
    configSource,
    configCode: typeof options?.[OPTION_CONFIG_CODE] === "string"
      ? options[OPTION_CONFIG_CODE]
      : DEFAULT_CONFIG_CODE,
    sharedTableId: typeof options?.[OPTION_SHARED_TABLE_ID] === "string" && options[OPTION_SHARED_TABLE_ID].trim()
      ? options[OPTION_SHARED_TABLE_ID].trim()
      : DEFAULT_SHARED_TABLE_ID,
    sharedConfigName: typeof options?.[OPTION_SHARED_CONFIG_NAME] === "string" && options[OPTION_SHARED_CONFIG_NAME].trim()
      ? options[OPTION_SHARED_CONFIG_NAME].trim()
      : DEFAULT_SHARED_CONFIG_NAME
  };
}

function persistMissingDefaultOptions(options) {
  const updates = [];

  if (!options || typeof options[OPTION_CONFIG_SOURCE] !== "string") {
    updates.push([OPTION_CONFIG_SOURCE, CONFIG_SOURCE_LOCAL]);
  }
  if (!options || typeof options[OPTION_CONFIG_CODE] !== "string") {
    updates.push([OPTION_CONFIG_CODE, DEFAULT_CONFIG_CODE]);
  }
  if (!options || typeof options[OPTION_SHARED_TABLE_ID] !== "string") {
    updates.push([OPTION_SHARED_TABLE_ID, DEFAULT_SHARED_TABLE_ID]);
  }
  if (!options || typeof options[OPTION_SHARED_CONFIG_NAME] !== "string") {
    updates.push([OPTION_SHARED_CONFIG_NAME, DEFAULT_SHARED_CONFIG_NAME]);
  }

  for (const [key, value] of updates) {
    grist.setOption(key, value).catch(error => {
      setStatus(formatError(error), "error", "main");
    });
  }
}

async function loadActiveConfigCode(options) {
  if (options.configSource !== CONFIG_SOURCE_TABLE) {
    return options.configCode;
  }

  const tableExists = await sharedConfigTableExists(options.sharedTableId);
  if (!tableExists) {
    throw new Error(`Shared button configuration table "${options.sharedTableId}" does not exist. Open Configure and click Create table.`);
  }

  const record = await fetchSharedConfigRecord(options.sharedTableId, options.sharedConfigName);
  if (!record) {
    throw new Error(`Shared button configuration "${options.sharedConfigName}" was not found in "${options.sharedTableId}". Open Configure, edit the code, and Save to create it.`);
  }

  return record.code || "";
}

async function fetchSelectedTableData() {
  if (typeof grist.fetchSelectedTable === "function") {
    return await grist.fetchSelectedTable();
  }
  if (typeof grist.docApi?.fetchSelectedTable === "function") {
    return await grist.docApi.fetchSelectedTable();
  }
  throw new Error("Unable to read the selected table.");
}

async function applyDocUserActions(userActions) {
  if (!window.grist?.docApi?.applyUserActions) {
    throw new Error("grist.docApi.applyUserActions is not available. Grant the widget full document access.");
  }
  return await grist.docApi.applyUserActions(userActions);
}

function validateSharedTableId(tableId) {
  const value = String(tableId || "").trim();

  if (!value) {
    throw new Error("Shared table id is required.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("Shared table id may contain only letters, numbers, and underscores, and must not start with a number.");
  }

  return value;
}

function validateSharedConfigName(name) {
  const value = String(name || "").trim();

  if (!value) {
    throw new Error("Shared configuration name is required.");
  }

  return value;
}

async function sharedConfigTableExists(tableId) {
  const cleanTableId = validateSharedTableId(tableId);

  if (typeof grist.docApi?.listTables === "function") {
    const tables = await grist.docApi.listTables();
    const tableIds = Array.isArray(tables)
      ? tables.map(table => typeof table === "string" ? table : table?.id || table?.tableId).filter(Boolean)
      : [];
    return tableIds.includes(cleanTableId);
  }

  try {
    await grist.docApi.fetchTable(cleanTableId);
    return true;
  } catch (error) {
    return false;
  }
}

async function fetchSharedConfigTable(tableId) {
  const cleanTableId = validateSharedTableId(tableId);

  if (!await sharedConfigTableExists(cleanTableId)) {
    const error = new Error(`Shared button configuration table "${cleanTableId}" does not exist.`);
    error.tableMissing = true;
    throw error;
  }

  const table = await grist.docApi.fetchTable(cleanTableId);

  if (!Array.isArray(table?.id)) {
    throw new Error(`Table "${cleanTableId}" is not readable.`);
  }
  if (!Array.isArray(table[SHARED_NAME_COLUMN]) || !Array.isArray(table[SHARED_CODE_COLUMN])) {
    throw new Error(`Table "${cleanTableId}" must have Text columns named "${SHARED_NAME_COLUMN}" and "${SHARED_CODE_COLUMN}".`);
  }

  return table;
}

async function fetchSharedConfigRecord(tableId, configName) {
  const cleanName = validateSharedConfigName(configName);
  const table = await fetchSharedConfigTable(tableId);
  const names = table[SHARED_NAME_COLUMN] || [];
  const codes = table[SHARED_CODE_COLUMN] || [];
  const index = names.findIndex(name => String(name) === cleanName);

  if (index < 0) {
    return null;
  }

  return {
    rowId: table.id[index],
    name: names[index],
    code: codes[index] || ""
  };
}

async function createSharedConfigTable(tableId, configName, code) {
  const cleanTableId = validateSharedTableId(tableId);
  const cleanName = validateSharedConfigName(configName);

  if (await sharedConfigTableExists(cleanTableId)) {
    throw new Error(`Table "${cleanTableId}" already exists.`);
  }

  await applyDocUserActions([
    ["AddTable", cleanTableId, [
      {id: SHARED_NAME_COLUMN, type: "Text"},
      {id: SHARED_CODE_COLUMN, type: "Text"}
    ]]
  ]);

  await applyDocUserActions([
    ["AddRecord", cleanTableId, null, {
      [SHARED_NAME_COLUMN]: cleanName,
      [SHARED_CODE_COLUMN]: String(code || "")
    }]
  ]);
}

async function saveSharedConfigCode(tableId, configName, code) {
  const cleanTableId = validateSharedTableId(tableId);
  const cleanName = validateSharedConfigName(configName);
  const record = await fetchSharedConfigRecord(cleanTableId, cleanName);

  if (record) {
    await applyDocUserActions([
      ["UpdateRecord", cleanTableId, record.rowId, {
        [SHARED_CODE_COLUMN]: String(code || "")
      }]
    ]);
  } else {
    await applyDocUserActions([
      ["AddRecord", cleanTableId, null, {
        [SHARED_NAME_COLUMN]: cleanName,
        [SHARED_CODE_COLUMN]: String(code || "")
      }]
    ]);
  }
}

function findClosestRowIdAfterRemoval(beforeIds, afterIdSet, removedRowId) {
  const removedIndex = beforeIds.indexOf(removedRowId);

  if (removedIndex === -1) {
    return null;
  }

  // Prefer the next record that occupied a position after the removed one.
  for (let index = removedIndex + 1; index < beforeIds.length; index += 1) {
    const rowId = beforeIds[index];
    if (afterIdSet.has(rowId)) {
      return rowId;
    }
  }

  // If the removed record was near the end, fall back to the previous one.
  for (let index = removedIndex - 1; index >= 0; index -= 1) {
    const rowId = beforeIds[index];
    if (afterIdSet.has(rowId)) {
      return rowId;
    }
  }

  return null;
}

function getEditorValue() {
  if (monacoEditor) {
    return monacoEditor.getValue();
  }
  return configCodeFallback.value;
}

function setEditorValue(value) {
  const nextValue = String(value ?? "");
  configCodeFallback.value = nextValue;
  if (monacoEditor) {
    monacoEditor.setValue(nextValue);
  }
}

function showFallbackEditor() {
  configEditorContainer.hidden = true;
  configCodeFallback.hidden = false;
  configCodeFallback.focus();
}

function ensureMonacoEditor() {
  if (monacoEditor) {
    requestAnimationFrame(() => monacoEditor.layout());
    return Promise.resolve(monacoEditor);
  }

  if (monacoEditorPromise) {
    return monacoEditorPromise;
  }

  if (typeof window.require !== "function") {
    showFallbackEditor();
    return Promise.resolve(null);
  }

  configEditorContainer.hidden = false;
  configCodeFallback.hidden = true;

  monacoEditorPromise = new Promise(resolve => {
    try {
      window.require.config({
        paths: {
          vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs"
        }
      });

      window.require(
        ["vs/editor/editor.main"],
        () => {
          monacoEditor = window.monaco.editor.create(configEditorContainer, {
            value: configCodeFallback.value,
            language: "javascript",
            automaticLayout: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            insertSpaces: true,
            wordWrap: "on"
          });
          resolve(monacoEditor);
        },
        () => {
          showFallbackEditor();
          resolve(null);
        }
      );
    } catch (error) {
      showFallbackEditor();
      resolve(null);
    }
  });

  return monacoEditorPromise;
}

async function openConfigDialog() {
  setDialogOptions(currentConfigOptions);
  clearStatus("all");

  if (currentConfigOptions.configSource === CONFIG_SOURCE_TABLE) {
    await loadSharedConfigIntoEditor({quietOnSuccess: true});
  } else {
    setEditorValue(currentConfigOptions.configCode);
  }

  if (typeof configDialog.showModal === "function") {
    configDialog.showModal();
  } else {
    configDialog.setAttribute("open", "");
  }

  await ensureMonacoEditor();
  if (monacoEditor) {
    monacoEditor.focus();
    monacoEditor.layout();
  }
}

function closeConfigDialog() {
  configDialog.close();
}

function setDialogOptions(options) {
  configSourceSelect.value = options.configSource === CONFIG_SOURCE_TABLE
    ? CONFIG_SOURCE_TABLE
    : CONFIG_SOURCE_LOCAL;
  sharedConfigTableIdInput.value = options.sharedTableId || DEFAULT_SHARED_TABLE_ID;
  sharedConfigNameInput.value = options.sharedConfigName || DEFAULT_SHARED_CONFIG_NAME;
  updateSharedControlsVisibility();
}

function getDialogOptions() {
  const configSource = configSourceSelect.value === CONFIG_SOURCE_TABLE
    ? CONFIG_SOURCE_TABLE
    : CONFIG_SOURCE_LOCAL;

  if (configSource === CONFIG_SOURCE_TABLE) {
    return {
      configSource,
      sharedTableId: validateSharedTableId(sharedConfigTableIdInput.value),
      sharedConfigName: validateSharedConfigName(sharedConfigNameInput.value)
    };
  }

  return {
    configSource,
    sharedTableId: String(sharedConfigTableIdInput.value || DEFAULT_SHARED_TABLE_ID).trim() || DEFAULT_SHARED_TABLE_ID,
    sharedConfigName: String(sharedConfigNameInput.value || DEFAULT_SHARED_CONFIG_NAME).trim() || DEFAULT_SHARED_CONFIG_NAME
  };
}

function updateSharedControlsVisibility() {
  const shared = configSourceSelect.value === CONFIG_SOURCE_TABLE;
  sharedConfigControls.hidden = !shared;
  createSharedTableButton.hidden = true;
}

async function handleConfigSourceChange() {
  updateSharedControlsVisibility();
  clearStatus("config");

  if (configSourceSelect.value === CONFIG_SOURCE_TABLE) {
    await loadSharedConfigIntoEditor();
  } else {
    setEditorValue(currentConfigOptions.configCode);
    setStatus("Editing local widget options.", "info", "config");
  }
}

async function loadSharedConfigIntoEditor({quietOnSuccess = false} = {}) {
  try {
    const tableId = validateSharedTableId(sharedConfigTableIdInput.value);
    const configName = validateSharedConfigName(sharedConfigNameInput.value);

    createSharedTableButton.hidden = true;

    if (!await sharedConfigTableExists(tableId)) {
      setEditorValue(DEFAULT_CONFIG_CODE);
      createSharedTableButton.hidden = false;
      setStatus(`Shared table "${tableId}" does not exist. Click Create table to add it with columns "${SHARED_NAME_COLUMN}" and "${SHARED_CODE_COLUMN}".`, "info", "config");
      return;
    }

    const record = await fetchSharedConfigRecord(tableId, configName);
    if (!record) {
      setEditorValue(DEFAULT_CONFIG_CODE);
      setStatus(`No shared configuration named "${configName}" exists yet. Edit the code and Save to create it.`, "info", "config");
      return;
    }

    setEditorValue(record.code);
    if (!quietOnSuccess) {
      setStatus(`Loaded shared configuration "${configName}" from "${tableId}".`, "info", "config");
    }
  } catch (error) {
    createSharedTableButton.hidden = true;
    setStatus(formatError(error), "error", "config");
  }
}

async function createSharedTableFromDialog() {
  try {
    const tableId = validateSharedTableId(sharedConfigTableIdInput.value);
    const configName = validateSharedConfigName(sharedConfigNameInput.value);
    const code = getEditorValue() || DEFAULT_CONFIG_CODE;

    await createSharedConfigTable(tableId, configName, code);
    await saveWidgetOptions({
      [OPTION_CONFIG_SOURCE]: CONFIG_SOURCE_TABLE,
      [OPTION_SHARED_TABLE_ID]: tableId,
      [OPTION_SHARED_CONFIG_NAME]: configName
    });

    createSharedTableButton.hidden = true;
    setStatus(`Created shared table "${tableId}" and configuration "${configName}".`, "info", "config");
  } catch (error) {
    setStatus(formatError(error), "error", "config");
  }
}

function setStatus(message, kind = "error", target = "all") {
  if (!message) {
    clearStatus(target);
    return;
  }

  for (const box of getStatusTargets(target)) {
    box.textContent = message;
    box.classList.toggle("info", kind === "info");
    box.hidden = false;
  }
}

function clearStatus(target = "all") {
  for (const box of getStatusTargets(target)) {
    box.textContent = "";
    box.classList.remove("info");
    box.hidden = true;
  }
}

function getStatusTargets(target) {
  if (target === "main") {
    return [statusBox];
  }
  if (target === "config") {
    return [configStatusBox];
  }
  return [statusBox, configStatusBox];
}

function formatError(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function compileConfig(code) {
  const source = String(code || "");
  const factory = new Function(
    "grist",
    "widget",
    `"use strict";\n${source}\n\nreturn (typeof get_buttons === "function") ? get_buttons : null;`
  );
  const fn = factory(window.grist, widget);
  if (typeof fn !== "function") {
    throw new Error("Configuration must define function get_buttons().");
  }
  return fn;
}

async function loadButtons(fn) {
  const result = await Promise.resolve(fn());
  if (result === null || result === undefined) {
    return [];
  }
  if (!Array.isArray(result)) {
    throw new Error("get_buttons() must return an array, null, or a Promise resolving to either.");
  }
  return result;
}

function normalizeButtons(buttons) {
  const normalized = [];

  buttons.forEach((button, index) => {
    if (!button || typeof button !== "object") {
      throw new Error(`Button ${index + 1} must be an object.`);
    }

    if (button.hidden === true) {
      return;
    }

    const label = String(button.label ?? "").trim();
    if (!label) {
      throw new Error(`Button ${index + 1} is missing label.`);
    }

    const disabled = button.disabled === true;
    if (!disabled && typeof button.onclick !== "function") {
      throw new Error(`Button "${label}" must define onclick, unless disabled or hidden.`);
    }

    normalized.push({
      label,
      title: button.title == null ? "" : String(button.title),
      color: button.color == null ? "" : String(button.color),
      backgroundColor: button.background_color == null ? "" : String(button.background_color),
      disabled,
      onclick: button.onclick
    });
  });

  return normalized;
}

async function renderButtons() {
  const token = ++renderToken;
  clearStatus("main");
  buttonRow.replaceChildren();

  if (!getButtonsFunction) {
    renderedButtons = [];
    return;
  }

  try {
    setBusy(true);
    const buttons = normalizeButtons(await loadButtons(getButtonsFunction));
    if (token !== renderToken) {
      return;
    }

    renderedButtons = buttons;
    buttonRow.replaceChildren(...buttons.map(createButtonElement));
    clearStatus("main");
  } catch (error) {
    if (token === renderToken) {
      renderedButtons = [];
      buttonRow.replaceChildren();
      setStatus(formatError(error), "error", "main");
    }
  } finally {
    if (token === renderToken) {
      setBusy(false);
    }
  }
}

function createButtonElement(button) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "action-button";
  element.textContent = button.label;
  element.disabled = busy || button.disabled;

  if (button.title) {
    element.title = button.title;
    element.setAttribute("aria-label", button.title);
  }
  if (button.color) {
    element.style.color = button.color;
    element.classList.add("custom-colored");
  }
  if (button.backgroundColor) {
    element.style.backgroundColor = button.backgroundColor;
    element.classList.add("custom-colored");
  }

  if (!button.disabled) {
    element.addEventListener("click", () => runButton(button));
  }

  return element;
}

async function runButton(button) {
  if (busy || button.disabled || typeof button.onclick !== "function") {
    return;
  }

  let failed = false;
  clearStatus("main");
  setBusy(true);
  try {
    await Promise.resolve(button.onclick());
  } catch (error) {
    failed = true;
    setStatus(formatError(error), "error", "main");
  } finally {
    setBusy(false);
  }

  if (!failed) {
    await renderButtons();
  }
}

function setBusy(nextBusy) {
  busy = nextBusy;
  [...buttonRow.querySelectorAll("button")].forEach((element, index) => {
    const button = renderedButtons[index];
    element.disabled = busy || Boolean(button?.disabled);
  });
  testConfigButton.disabled = busy;
  saveConfigButton.disabled = busy;
  resetConfigButton.disabled = busy;
  loadSharedConfigButton.disabled = busy;
  createSharedTableButton.disabled = busy;
}

async function saveConfig() {
  try {
    const dialogOptions = getDialogOptions();
    const nextCode = getEditorValue();
    const nextFunction = compileConfig(nextCode);
    await loadButtons(nextFunction);

    if (dialogOptions.configSource === CONFIG_SOURCE_TABLE) {
      if (!await sharedConfigTableExists(dialogOptions.sharedTableId)) {
        createSharedTableButton.hidden = false;
        setStatus(`Shared table "${dialogOptions.sharedTableId}" does not exist. Click Create table first.`, "info", "config");
        return;
      }

      await saveSharedConfigCode(dialogOptions.sharedTableId, dialogOptions.sharedConfigName, nextCode);
      await saveWidgetOptions({
        [OPTION_CONFIG_SOURCE]: CONFIG_SOURCE_TABLE,
        [OPTION_SHARED_TABLE_ID]: dialogOptions.sharedTableId,
        [OPTION_SHARED_CONFIG_NAME]: dialogOptions.sharedConfigName
      });
    } else {
      await saveWidgetOptions({
        [OPTION_CONFIG_SOURCE]: CONFIG_SOURCE_LOCAL,
        [OPTION_CONFIG_CODE]: nextCode,
        [OPTION_SHARED_TABLE_ID]: dialogOptions.sharedTableId,
        [OPTION_SHARED_CONFIG_NAME]: dialogOptions.sharedConfigName
      });
    }

    currentConfigOptions = {
      ...currentConfigOptions,
      configSource: dialogOptions.configSource,
      configCode: dialogOptions.configSource === CONFIG_SOURCE_LOCAL ? nextCode : currentConfigOptions.configCode,
      sharedTableId: dialogOptions.sharedTableId,
      sharedConfigName: dialogOptions.sharedConfigName
    };
    activeConfigCode = nextCode;
    getButtonsFunction = nextFunction;
    closeConfigDialog();
    await renderButtons();
  } catch (error) {
    setStatus(formatError(error), "error", "config");
  }
}

async function testConfig() {
  try {
    const testFunction = compileConfig(getEditorValue());
    const buttons = normalizeButtons(await loadButtons(testFunction));
    setStatus(`OK: ${buttons.length} visible button${buttons.length === 1 ? "" : "s"}.`, "info", "config");
  } catch (error) {
    setStatus(formatError(error), "error", "config");
  }
}

async function resetConfig() {
  setEditorValue(DEFAULT_CONFIG_CODE);
  await testConfig();
}

async function saveWidgetOptions(updates) {
  const entries = Object.entries(updates);

  // Save source last, so switching from local to table does not briefly try to
  // load a shared config before the table/name options have been saved.
  entries.sort(([a], [b]) => {
    if (a === OPTION_CONFIG_SOURCE) {
      return 1;
    }
    if (b === OPTION_CONFIG_SOURCE) {
      return -1;
    }
    return 0;
  });

  for (const [key, value] of entries) {
    await grist.setOption(key, value);
  }
}

async function handleOptions(options, interaction) {
  const token = ++optionsToken;
  currentAccessLevel = interaction?.access_level || null;
  const nextOptions = normalizeOptions(options || {});
  currentConfigOptions = nextOptions;
  persistMissingDefaultOptions(options || {});

  try {
    const codeFromOptions = await loadActiveConfigCode(nextOptions);
    if (token !== optionsToken) {
      return;
    }

    activeConfigCode = codeFromOptions;
    getButtonsFunction = compileConfig(activeConfigCode);
    await renderButtons();
  } catch (error) {
    if (token !== optionsToken) {
      return;
    }

    getButtonsFunction = null;
    renderedButtons = [];
    buttonRow.replaceChildren();
    setStatus(formatError(error), "error", "main");
  }

  if (currentAccessLevel && currentAccessLevel !== "full") {
    setStatus(`Current access level is "${currentAccessLevel}". Some actions may require full document access.`, "error", "main");
  }
}

function insertTabInTextarea(event) {
  if (event.key !== "Tab") {
    return;
  }
  event.preventDefault();
  const start = configCodeFallback.selectionStart;
  const end = configCodeFallback.selectionEnd;
  const value = configCodeFallback.value;
  configCodeFallback.value = `${value.slice(0, start)}  ${value.slice(end)}`;
  configCodeFallback.selectionStart = configCodeFallback.selectionEnd = start + 2;
}

panelConfigButton.addEventListener("click", openConfigDialog);
closeConfigButton.addEventListener("click", closeConfigDialog);
configSourceSelect.addEventListener("change", handleConfigSourceChange);
loadSharedConfigButton.addEventListener("click", () => loadSharedConfigIntoEditor());
createSharedTableButton.addEventListener("click", createSharedTableFromDialog);
resetConfigButton.addEventListener("click", resetConfig);
testConfigButton.addEventListener("click", testConfig);
saveConfigButton.addEventListener("click", saveConfig);
configCodeFallback.addEventListener("keydown", insertTabInTextarea);

for (const input of [sharedConfigTableIdInput, sharedConfigNameInput]) {
  input.addEventListener("change", () => {
    if (configSourceSelect.value === CONFIG_SOURCE_TABLE) {
      createSharedTableButton.hidden = true;
      setStatus("Click Load to read this shared configuration, or edit and Save to write it.", "info", "config");
    }
  });
}

configDialog.addEventListener("click", event => {
  if (event.target === configDialog) {
    closeConfigDialog();
  }
});

grist.ready({
  requiredAccess: "full",
  onEditOptions: openConfigDialog
});

grist.onOptions(handleOptions);

grist.onRecord(record => {
  currentRecord = record || null;
  if (getButtonsFunction) {
    renderButtons();
  }
});
