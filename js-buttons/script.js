"use strict";

const OPTION_CONFIG_CODE = "configCode";

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
const configEditorContainer = document.getElementById("configEditor");
const configCodeFallback = document.getElementById("configCodeFallback");
const closeConfigButton = document.getElementById("closeConfigButton");
const resetConfigButton = document.getElementById("resetConfigButton");
const testConfigButton = document.getElementById("testConfigButton");
const saveConfigButton = document.getElementById("saveConfigButton");

let savedConfigCode = DEFAULT_CONFIG_CODE;
let getButtonsFunction = null;
let renderedButtons = [];
let busy = false;
let renderToken = 0;
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

    const table = grist.getTable();
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
    // This allows us to discover automatically assigned ids from AddRecord actions.
    const before = await grist.fetchSelectedTable();
    const beforeIds = new Set(before.id || []);

    let lastTargetRowId = null;

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

        if (rowId != null) {
          lastTargetRowId = rowId;
        }
      }

      if (actionName === "BulkAddRecord") {
        const rowIds = action[2] || [];
        const knownRowIds = rowIds.filter((rowId) => rowId != null);

        if (knownRowIds.length > 0) {
          lastTargetRowId = knownRowIds[knownRowIds.length - 1];
        }
      }

      if (actionName === "UpdateRecord") {
        const rowId = action[2];

        if (rowId != null) {
          lastTargetRowId = rowId;
        }
      }

      if (actionName === "BulkUpdateRecord") {
        const rowIds = action[2] || [];

        if (rowIds.length > 0) {
          lastTargetRowId = rowIds[rowIds.length - 1];
        }
      }
    }

    if (!window.grist?.docApi?.applyUserActions) {
      throw new Error("grist.docApi.applyUserActions is not available. Grant the widget full document access.");
    }

    await grist.docApi.applyUserActions(userActions);

    // Snapshot after running the actions.
    // If new records were created with automatic ids, find them now.
    const after = await grist.fetchSelectedTable();
    const createdIds = (after.id || []).filter((id) => !beforeIds.has(id));

    if (createdIds.length > 0) {
      lastTargetRowId = createdIds[createdIds.length - 1];
    }

    if (lastTargetRowId != null) {
      await grist.setCursorPos({
        rowId: lastTargetRowId
      });
    }
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
  setEditorValue(savedConfigCode);
  clearStatus("all");

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
}

async function saveConfig() {
  try {
    const nextCode = getEditorValue();
    const nextFunction = compileConfig(nextCode);
    await loadButtons(nextFunction);
    await grist.setOption(OPTION_CONFIG_CODE, nextCode);
    savedConfigCode = nextCode;
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


function handleOptions(options, interaction) {
  currentAccessLevel = interaction?.access_level || null;

  const codeFromOptions = options && typeof options[OPTION_CONFIG_CODE] === "string"
    ? options[OPTION_CONFIG_CODE]
    : DEFAULT_CONFIG_CODE;

  savedConfigCode = codeFromOptions;

  try {
    getButtonsFunction = compileConfig(savedConfigCode);
    renderButtons();
  } catch (error) {
    getButtonsFunction = null;
    renderedButtons = [];
    buttonRow.replaceChildren();
    setStatus(formatError(error), "error", "main");
  }

  if (!options || typeof options[OPTION_CONFIG_CODE] !== "string") {
    grist.setOption(OPTION_CONFIG_CODE, DEFAULT_CONFIG_CODE).catch(error => {
      setStatus(formatError(error), "error", "main");
    });
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
resetConfigButton.addEventListener("click", resetConfig);
testConfigButton.addEventListener("click", testConfig);
saveConfigButton.addEventListener("click", saveConfig);
configCodeFallback.addEventListener("keydown", insertTabInTextarea);

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
