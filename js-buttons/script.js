/* global grist, CodeMirror */

(() => {
  "use strict";

  const OPTIONS_KEY = "getButtonsCode";

  const COLUMN_MAPPINGS = [
    {
      name: "Input",
      title: "Buttons input",
      type: "Any",
      description: "Value passed to get_buttons(input)."
    }
  ];

  const DEFAULT_CODE = `function show_input(input) {
  alert(JSON.stringify(input, null, 2));
}

function log_input(input) {
  console.log("Input from Grist:", input);
}

async function get_selected_table_id() {
  if (typeof grist.getSelectedTableId === "function") {
    return await grist.getSelectedTableId();
  }

  throw new Error("Cannot get the selected table id.");
}

function get_input_column_id(context) {
  if (context && context.mappings && context.mappings.Input) {
    return context.mappings.Input;
  }

  return "Input";
}

function get_current_row_id(context) {
  const rowId =
    context && context.rowId != null
      ? context.rowId
      : context && context.record
        ? context.record.id
        : null;

  if (rowId == null) {
    throw new Error("No selected record.");
  }

  return rowId;
}

async function run_user_actions(userActions) {
  if (!Array.isArray(userActions)) {
    throw new Error("userActions must be an array.");
  }

  const selectedTableId = await get_selected_table_id();

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
}

async function add_new_record() {
  const table = grist.getTable();

  const newRecord = await table.create({
    fields: {}
  });

  if (newRecord && newRecord.id != null) {
    await grist.setCursorPos({
      rowId: newRecord.id
    });
  }
}

async function add_records_with_user_actions(context) {
  const tableId = await get_selected_table_id();
  const inputColumnId = get_input_column_id(context);
  const now = new Date().toISOString();

  const userActions = [
    [
      "AddRecord",
      tableId,
      null,
      {
        [inputColumnId]: "Created with applyUserActions - 1 - " + now
      }
    ],
    [
      "AddRecord",
      tableId,
      null,
      {
        [inputColumnId]: "Created with applyUserActions - 2 - " + now
      }
    ]
  ];

  await run_user_actions(userActions);
}

async function update_current_record_with_user_actions(context) {
  const tableId = await get_selected_table_id();
  const rowId = get_current_row_id(context);
  const inputColumnId = get_input_column_id(context);

  const userActions = [
    [
      "UpdateRecord",
      tableId,
      rowId,
      {
        [inputColumnId]: "Updated with applyUserActions at " + new Date().toISOString()
      }
    ]
  ];

  await run_user_actions(userActions);
}

async function remove_current_record_with_user_actions(context) {
  const tableId = await get_selected_table_id();
  const rowId = get_current_row_id(context);

  if (!confirm("Remove the selected record?")) {
    return;
  }

  const userActions = [
    [
      "RemoveRecord",
      tableId,
      rowId
    ]
  ];

  await run_user_actions(userActions);
}

function open_url_browser_window() {
  window.open("https://www.getgrist.com", "_blank", "noopener,noreferrer");
}

async function wait_one_second() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

function get_buttons(input) {
  return [
    {
      label: "+",
      title: "Add a new blank record using grist.getTable().create()",
      color: "#ffffff",
      background_color: "#16a34a",
      onclick: async () => add_new_record()
    },
    {
      label: "Add records",
      title: "Add records using run_user_actions(userActions)",
      color: "#ffffff",
      background_color: "#2563eb",
      onclick: async (event, context) => add_records_with_user_actions(context)
    },
    {
      label: "Update record",
      title: "Update the selected record using run_user_actions(userActions)",
      color: "#ffffff",
      background_color: "#7c3aed",
      onclick: async (event, context) => update_current_record_with_user_actions(context)
    },
    {
      label: "Remove record",
      title: "Remove the selected record using run_user_actions(userActions)",
      color: "#ffffff",
      background_color: "#dc2626",
      onclick: async (event, context) => remove_current_record_with_user_actions(context)
    },
    {
      label: "Open URL",
      title: "Open a URL in a new browser tab",
      onclick: () => open_url_browser_window()
    },
    {
      label: "Show input",
      title: "Show the mapped input value",
      onclick: () => show_input(input)
    },
    {
      label: "Log input",
      title: "Write the mapped input to the browser console",
      color: "#ffffff",
      background_color: "#16a34a",
      onclick: () => log_input(input)
    },
    {
      label: "Async example",
      title: "This button is disabled while running",
      onclick: async () => {
        await wait_one_second();
        alert("Done");
      }
    },
    {
      label: "Disabled",
      title: "This button is disabled",
      disabled: true
    }
  ];
}`;

  const state = {
    record: null,
    mappedRecord: null,
    mappings: null,

    code: DEFAULT_CODE,
    getButtons: null,
    compiledError: null,

    recordLoaded: false,
    renderToken: 0,

    codeEditor: null,
    editorFallback: false
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.buttonRow = document.getElementById("buttonRow");
    els.status = document.getElementById("status");

    els.openConfigButton = document.getElementById("openConfigButton");
    els.configPanel = document.getElementById("configPanel");
    els.editorHost = document.getElementById("editorHost");
    els.configEditor = document.getElementById("configEditor");
    els.configError = document.getElementById("configError");

    els.resetConfigButton = document.getElementById("resetConfigButton");
    els.cancelConfigButton = document.getElementById("cancelConfigButton");
    els.saveConfigButton = document.getElementById("saveConfigButton");

    els.openConfigButton.addEventListener("click", openConfigPanel);
    els.cancelConfigButton.addEventListener("click", closeConfigPanel);
    els.saveConfigButton.addEventListener("click", saveConfig);
    els.resetConfigButton.addEventListener("click", resetConfigExample);

    document.addEventListener("keydown", handleKeydown);

    if (typeof grist === "undefined") {
      showStatus("Grist API not found. Open this file as a Grist custom widget.", "error");
      return;
    }

    try {
      grist.ready({
        requiredAccess: "full",
        allowSelectBy: true,
        columns: COLUMN_MAPPINGS,
        onEditOptions: openConfigPanel
      });

      grist.onOptions(handleOptions);
      grist.onRecord(handleRecord);
    } catch (error) {
      showStatus(formatError(error), "error");
    }

    compileConfiguredFunction();
    renderButtons();
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && !els.configPanel.classList.contains("hidden")) {
      closeConfigPanel();
    }
  }

  function handleOptions(options) {
    state.code =
      options && typeof options[OPTIONS_KEY] === "string"
        ? options[OPTIONS_KEY]
        : DEFAULT_CODE;

    compileConfiguredFunction();

    if (!els.configPanel.classList.contains("hidden")) {
      setEditorValue(state.code);
      refreshEditor();
    }

    renderButtons();
  }

  function handleRecord(record, mappings) {
    state.recordLoaded = true;
    state.record = record;
    state.mappings = mappings;
    state.mappedRecord = getMappedRecord(record, mappings);

    renderButtons();
  }

  function getMappedRecord(record, mappings) {
    if (!record) {
      return null;
    }

    let mapped = null;

    try {
      mapped = grist.mapColumnNames(record);
    } catch (_) {
      mapped = null;
    }

    if (!mapped && mappings) {
      try {
        mapped = grist.mapColumnNames(record, mappings);
      } catch (_) {
        mapped = null;
      }
    }

    if (mapped) {
      return mapped;
    }

    if (mappings && mappings.Input && hasOwn(record, mappings.Input)) {
      return {
        ...record,
        Input: record[mappings.Input]
      };
    }

    if (hasOwn(record, "Input")) {
      return record;
    }

    return null;
  }

  function compileConfiguredFunction() {
    try {
      state.getButtons = compileCode(state.code);
      state.compiledError = null;
    } catch (error) {
      state.getButtons = null;
      state.compiledError = error;
    }
  }

  function compileCode(code) {
    const factory = new Function(
      "grist",
      `
"use strict";

${code}

if (typeof get_buttons !== "function") {
  throw new Error("The configuration must define a function named get_buttons(input).");
}

return get_buttons;
`
    );

    return factory(grist);
  }

  function renderButtons() {
    const token = ++state.renderToken;

    clearButtons();
    hideStatus();

    if (state.compiledError) {
      showStatus(formatError(state.compiledError), "error");
      return;
    }

    if (!state.recordLoaded) {
      showStatus("Waiting for the selected Grist record…");
      return;
    }

    if (!state.record) {
      showStatus("No selected record.");
      return;
    }

    if (!state.mappedRecord) {
      showStatus(
        'Please map a table column to "Buttons input" in the widget column mapping panel.',
        "error"
      );
      return;
    }

    const input = state.mappedRecord.Input;
    const context = makeContext();

    try {
      const result = state.getButtons.call(context, input);

      if (result && typeof result.then === "function") {
        showStatus("Loading buttons…");

        result
          .then((buttons) => {
            if (token !== state.renderToken) {
              return;
            }

            hideStatus();
            renderButtonList(buttons);
          })
          .catch((error) => {
            if (token !== state.renderToken) {
              return;
            }

            showStatus(formatError(error), "error");
          });

        return;
      }

      renderButtonList(result);
    } catch (error) {
      showStatus(formatError(error), "error");
    }
  }

  function renderButtonList(value) {
    clearButtons();

    const buttons = normalizeButtons(value);

    if (buttons.length === 0) {
      showStatus("get_buttons(input) returned no buttons.");
      return;
    }

    for (let index = 0; index < buttons.length; index += 1) {
      els.buttonRow.appendChild(createButton(buttons[index], index));
    }
  }

  function normalizeButtons(value) {
    if (value == null) {
      return [];
    }

    const list = Array.isArray(value) ? value : [value];

    return list.map((buttonDef, index) => {
      if (!buttonDef || typeof buttonDef !== "object") {
        throw new Error(`Button ${index + 1} is not an object.`);
      }

      if (!hasOwn(buttonDef, "label")) {
        throw new Error(`Button ${index + 1} is missing the "label" property.`);
      }

      if (!isButtonDisabled(buttonDef) && typeof buttonDef.onclick !== "function") {
        throw new Error(
          `Button "${String(buttonDef.label)}" is missing an onclick function.`
        );
      }

      return buttonDef;
    });
  }

  function createButton(buttonDef, index) {
    const buttonEl = document.createElement("button");

    buttonEl.type = "button";
    buttonEl.className = "grist-button";
    buttonEl.textContent = String(buttonDef.label);
    buttonEl.disabled = isButtonDisabled(buttonDef);

    if (buttonDef.title != null && String(buttonDef.title).trim() !== "") {
      buttonEl.title = String(buttonDef.title);
    }

    applyButtonStyle(buttonEl, buttonDef);

    buttonEl.addEventListener("click", (event) => {
      runButtonAction(buttonDef, buttonEl, index, event);
    });

    return buttonEl;
  }

  async function runButtonAction(buttonDef, buttonEl, index, event) {
    if (isButtonDisabled(buttonDef) || buttonEl.disabled || typeof buttonDef.onclick !== "function") {
      return;
    }

    const context = makeContext({
      button: buttonDef,
      element: buttonEl,
      index,
      event
    });

    try {
      hideStatus();

      buttonEl.disabled = true;
      buttonEl.dataset.running = "true";

      const result = buttonDef.onclick.call(context, event, context);

      if (result && typeof result.then === "function") {
        await result;
      }
    } catch (error) {
      showStatus(formatError(error), "error");
    } finally {
      delete buttonEl.dataset.running;
      buttonEl.disabled = isButtonDisabled(buttonDef);
    }
  }

  function applyButtonStyle(buttonEl, buttonDef) {
    const textColor = readStyleValue(buttonDef.color);
    const backgroundColor = readStyleValue(buttonDef.background_color);

    if (backgroundColor) {
      buttonEl.classList.add("custom-color");
      buttonEl.style.backgroundColor = backgroundColor;
      buttonEl.style.borderColor = backgroundColor;
    }

    if (textColor) {
      buttonEl.style.color = textColor;
    } else if (backgroundColor) {
      const automaticTextColor = getReadableTextColor(backgroundColor);

      if (automaticTextColor) {
        buttonEl.style.color = automaticTextColor;
      }
    }
  }

  function isButtonDisabled(buttonDef) {
    return buttonDef.disabled === true;
  }

  function readStyleValue(value) {
    return value == null ? "" : String(value).trim();
  }

  function getReadableTextColor(color) {
    const rgb = parseHexColor(color);

    if (!rgb) {
      return "";
    }

    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness >= 150 ? "#000000" : "#ffffff";
  }

  function parseHexColor(color) {
    const value = String(color).trim();

    const shortMatch = value.match(/^#([0-9a-f]{3})$/i);
    if (shortMatch) {
      const hex = shortMatch[1];

      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    }

    const longMatch = value.match(/^#([0-9a-f]{6})$/i);
    if (longMatch) {
      const hex = longMatch[1];

      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }

    return null;
  }

  function makeContext(extra = {}) {
    return {
      grist,
      input: state.mappedRecord ? state.mappedRecord.Input : undefined,
      record: state.record,
      mappedRecord: state.mappedRecord,
      mappings: state.mappings,
      rowId: state.record ? state.record.id : undefined,
      refresh: renderButtons,
      setStatus: showStatus,
      clearStatus: hideStatus,
      ...extra
    };
  }

  function openConfigPanel() {
    hideConfigError();
    els.configPanel.classList.remove("hidden");

    requestAnimationFrame(() => {
      setupConfigEditor();
      setEditorValue(state.code || DEFAULT_CODE);
      refreshEditor();

      requestAnimationFrame(refreshEditor);
    });
  }

  function closeConfigPanel() {
    els.configPanel.classList.add("hidden");
    hideConfigError();
  }

  function setupConfigEditor() {
    if (state.codeEditor || state.editorFallback) {
      return;
    }

    if (typeof CodeMirror === "undefined") {
      state.editorFallback = true;
      els.editorHost.classList.add("hidden");
      els.configEditor.classList.remove("hidden");
      els.configEditor.value = state.code || DEFAULT_CODE;
      els.configEditor.focus();

      showConfigError(
        "CodeMirror was not loaded. The plain text editor is being used instead."
      );

      return;
    }

    state.codeEditor = CodeMirror(els.editorHost, {
      value: state.code || DEFAULT_CODE,
      mode: "javascript",
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      matchBrackets: true,
      styleActiveLine: true,
      viewportMargin: Infinity,
      extraKeys: {
        Tab: (cm) => {
          if (cm.somethingSelected()) {
            cm.indentSelection("add");
          } else {
            cm.replaceSelection("  ", "end");
          }
        },
        "Ctrl-S": saveConfig,
        "Cmd-S": saveConfig
      }
    });
  }

  function getEditorValue() {
    if (state.codeEditor) {
      return state.codeEditor.getValue();
    }

    return els.configEditor.value;
  }

  function setEditorValue(value) {
    if (state.codeEditor) {
      state.codeEditor.setValue(value);
      return;
    }

    els.configEditor.value = value;
  }

  function refreshEditor() {
    if (state.codeEditor) {
      state.codeEditor.refresh();
      state.codeEditor.focus();
      return;
    }

    els.configEditor.focus();
  }

  async function saveConfig() {
    const newCode = getEditorValue();

    try {
      const compiled = compileCode(newCode);

      await grist.setOption(OPTIONS_KEY, newCode);

      state.code = newCode;
      state.getButtons = compiled;
      state.compiledError = null;

      closeConfigPanel();
      renderButtons();
      showStatus("Configuration saved.", "success");
    } catch (error) {
      showConfigError(formatError(error));
    }
  }

  function resetConfigExample() {
    setEditorValue(DEFAULT_CODE);
    hideConfigError();
    refreshEditor();
  }

  function clearButtons() {
    els.buttonRow.replaceChildren();
  }

  function showStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = "status";

    if (kind) {
      els.status.classList.add(kind);
    }
  }

  function hideStatus() {
    els.status.textContent = "";
    els.status.className = "status hidden";
  }

  function showConfigError(message) {
    els.configError.textContent = message;
    els.configError.classList.remove("hidden");
  }

  function hideConfigError() {
    els.configError.textContent = "";
    els.configError.classList.add("hidden");
  }

  function formatError(error) {
    if (!error) {
      return "Unknown error.";
    }

    return error.stack || error.message || String(error);
  }

  function hasOwn(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }
})();
