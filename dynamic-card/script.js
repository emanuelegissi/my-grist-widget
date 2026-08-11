"use strict";

const AUTOSAVE_DELAY_MS = 350;
const MAPPING_NAME = "Fields";
const SUPPORTED_TYPES = new Set([
  "Text",
  "Numeric",
  "Int",
  "Bool",
  "Date",
  "DateTime",
  "Choice",
  "ChoiceList"
]);

const app = document.getElementById("app");
const state = {
  record: null,
  mapping: null,
  metadata: new Map(),
  tableId: null,
  definitionKey: "",
  renderedRecordId: null,
  fullRecordCache: null,
  controls: new Map(),
  timers: new Map(),
  pending: new Map(),
  saveSequence: 0,
  eventSequence: 0,
  activeSaves: 0
};

function element(tagName, properties = {}, children = []) {
  const node = document.createElement(tagName);

  for (const [name, value] of Object.entries(properties)) {
    if (name === "className") {
      node.className = value;
    } else if (name === "textContent") {
      node.textContent = value;
    } else if (name === "htmlFor") {
      node.htmlFor = value;
    } else if (name.startsWith("aria")) {
      const attribute = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      node.setAttribute(attribute, value);
    } else {
      node[name] = value;
    }
  }

  for (const child of children) {
    node.appendChild(child);
  }

  return node;
}

function showMessage(message) {
  state.controls.clear();
  app.replaceChildren(element("div", {
    className: "message",
    textContent: message
  }));
}

function showAlert(message) {
  state.controls.clear();
  const panel = element("div", {
    className: "alert-panel",
    role: "alert"
  }, [
    element("strong", {
      className: "alert-title",
      textContent: "Dynamic card configuration error"
    }),
    element("p", { textContent: message })
  ]);

  app.replaceChildren(element("div", { className: "alert" }, [panel]));
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

function normalizeMapping(mapping) {
  if (Array.isArray(mapping)) {
    return mapping[0] || null;
  }
  return mapping || null;
}

function parseFieldList(value) {
  let parsed = value;

  if (typeof parsed === "string") {
    if (!parsed.trim()) {
      throw new Error("The mapped Fields column is empty.");
    }

    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      throw new Error("The mapped Fields column must contain a JSON array or a Grist Choice List.");
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("The mapped Fields column must contain a JSON array or a Grist Choice List.");
  }

  if (!parsed.length) {
    throw new Error("The mapped Fields column must list at least one field.");
  }

  const names = parsed.map((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Field ${index + 1} in the mapped list must be a non-empty string.`);
    }
    return value.trim();
  });

  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`The field list contains the duplicate name "${duplicate}".`);
  }

  return names;
}

function parseWidgetOptions(rawOptions) {
  if (!rawOptions) {
    return {};
  }
  if (typeof rawOptions === "object") {
    return rawOptions;
  }

  try {
    return JSON.parse(rawOptions);
  } catch (error) {
    return {};
  }
}

function baseType(type) {
  return String(type || "").split(":", 1)[0];
}

async function getSelectedTableId() {
  if (typeof grist.getSelectedTableId === "function") {
    return grist.getSelectedTableId();
  }

  const table = typeof grist.getTable === "function"
    ? grist.getTable()
    : grist.selectedTable;

  if (table && typeof table.getTableId === "function") {
    return table.getTableId();
  }

  if (table?._platform && typeof table._platform.getTableId === "function") {
    return table._platform.getTableId();
  }

  throw new Error("The selected table could not be identified.");
}

async function fetchMetadata(record) {
  const fallback = new Map(
    Object.keys(record)
      .filter(columnId => columnId !== "id")
      .map(columnId => [columnId, {
        colId: columnId,
        label: columnId,
        description: "",
        type: inferType(record[columnId]),
        isFormula: false,
        options: {}
      }])
  );

  try {
    const tableId = await getSelectedTableId();

    if (state.tableId === tableId && state.metadata.size) {
      return state.metadata;
    }

    if (state.tableId !== tableId) {
      state.fullRecordCache = null;
    }
    state.tableId = tableId;

    const [tables, columns] = await Promise.all([
      grist.docApi.fetchTable("_grist_Tables"),
      grist.docApi.fetchTable("_grist_Tables_column")
    ]);
    const tableIndex = tables.tableId.indexOf(tableId);

    if (tableIndex < 0) {
      throw new Error(`Metadata for table "${tableId}" was not found.`);
    }

    const tableRef = tables.id[tableIndex];
    const metadata = new Map();

    for (let index = 0; index < columns.id.length; index += 1) {
      if (columns.parentId[index] !== tableRef) {
        continue;
      }

      const colId = columns.colId[index];
      metadata.set(colId, {
        colId,
        label: columns.label?.[index] || colId,
        description: columns.description?.[index] || "",
        type: columns.type?.[index] || inferType(record[colId]),
        isFormula: Boolean(columns.isFormula?.[index]),
        options: parseWidgetOptions(columns.widgetOptions?.[index])
      });
    }

    return metadata.size ? metadata : fallback;
  } catch (error) {
    console.warn("Dynamic Card could not read column metadata; using record values as a fallback.", error);
    return fallback;
  }
}

function inferType(value) {
  if (typeof value === "boolean") {
    return "Bool";
  }
  if (typeof value === "number") {
    return "Numeric";
  }
  if (Array.isArray(value)) {
    return "ChoiceList";
  }
  return "Text";
}

function resolveFields(names, metadata) {
  const labelMatches = new Map();

  for (const column of metadata.values()) {
    const matches = labelMatches.get(column.label) || [];
    matches.push(column);
    labelMatches.set(column.label, matches);
  }

  return names.map(name => {
    let column = metadata.get(name);

    if (!column) {
      const matches = labelMatches.get(name) || [];
      if (matches.length > 1) {
        throw new Error(`The label "${name}" matches more than one column. Use a column ID instead.`);
      }
      column = matches[0];
    }

    if (!column) {
      throw new Error(`Field "${name}" does not exist in the linked table.`);
    }

    const type = baseType(column.type);
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(`Field "${column.label}" has unsupported Grist type "${column.type || "unknown"}".`);
    }

    return { ...column, baseType: type };
  });
}

function decodeCellValue(value) {
  if (typeof grist.decodeObject === "function") {
    return grist.decodeObject(value);
  }

  if (Array.isArray(value) && value[0] === "L") {
    return value.slice(1);
  }

  return value;
}

async function fetchFullRecord(rowId) {
  const tableId = state.tableId || await getSelectedTableId();
  const cached = state.fullRecordCache;

  // Grist often emits an onRecord callback immediately after this widget
  // saves. Reuse the just-fetched row briefly instead of downloading the
  // selected table again for that echo event.
  if (cached && cached.tableId === tableId && cached.rowId === rowId &&
      Date.now() - cached.fetchedAt < 1000) {
    return { ...cached.record };
  }

  const table = await grist.docApi.fetchTable(tableId);
  const rowIndex = Array.isArray(table.id)
    ? table.id.findIndex(id => String(id) === String(rowId))
    : -1;

  if (rowIndex < 0) {
    throw new Error(`Record ${rowId} was not found in the linked table.`);
  }

  const fullRecord = { id: rowId };
  for (const [columnId, values] of Object.entries(table)) {
    if (columnId !== "id" && Array.isArray(values)) {
      fullRecord[columnId] = decodeCellValue(values[rowIndex]);
    }
  }

  state.fullRecordCache = {
    tableId,
    rowId,
    fetchedAt: Date.now(),
    record: fullRecord
  };
  return { ...fullRecord };
}

async function includeMissingFields(record, fields) {
  const missing = fields.filter(field =>
    !Object.prototype.hasOwnProperty.call(record, field.colId)
  );

  if (!missing.length) {
    return record;
  }

  let fullRecord;
  try {
    fullRecord = await fetchFullRecord(record.id);
  } catch (error) {
    const names = missing.map(field => `"${field.label}"`).join(", ");
    throw new Error(
      `The following fields exist but could not be read from the linked table: ${names}. ` +
      `${error.message || error}`
    );
  }

  const stillMissing = missing.filter(field =>
    !Object.prototype.hasOwnProperty.call(fullRecord, field.colId)
  );
  if (stillMissing.length) {
    throw new Error(
      `The following fields are not available under the current access rules: ` +
      `${stillMissing.map(field => `"${field.label}"`).join(", ")}.`
    );
  }

  // Values from onRecord are the freshest for columns exposed by the section;
  // full-table values fill only the columns omitted from that payload.
  return { ...fullRecord, ...record };
}

function choiceValues(column, currentValue) {
  const configured = Array.isArray(column.options.choices)
    ? column.options.choices.map(String)
    : [];
  const current = column.baseType === "ChoiceList"
    ? normalizeChoiceList(currentValue)
    : currentValue == null || currentValue === "" ? [] : [String(currentValue)];

  return Array.from(new Set([...configured, ...current]));
}

function normalizeChoiceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String);
}

function inputId(columnId) {
  return `dynamic-card-${columnId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function makeLabel(column, id) {
  const label = element("div", {
    className: "field-label"
  }, [
    element("label", {
      className: "field-label-text",
      htmlFor: id,
      textContent: column.label
    })
  ]);

  if (column.label !== column.colId) {
    label.appendChild(element("span", {
      className: "field-id",
      textContent: `(${column.colId})`
    }));
  }

  if (column.description) {
    label.appendChild(element("button", {
      className: "info",
      type: "button",
      textContent: "i",
      title: column.description,
      ariaLabel: column.description
    }));
  }

  if (column.isFormula) {
    label.appendChild(element("span", {
      className: "read-only",
      textContent: "read-only"
    }));
  }

  return label;
}

function commonControl(column, id) {
  return {
    id,
    className: "control",
    disabled: column.isFormula,
    ariaLabel: column.label
  };
}

function createControl(column, value) {
  const id = inputId(column.colId);
  let control;

  switch (column.baseType) {
    case "Text": {
      const multiline = column.options.widget === "TextBox" || column.options.multiline === true;
      const properties = {
        ...commonControl(column, id),
        value: value == null ? "" : String(value)
      };
      control = multiline
        ? element("textarea", properties)
        : element("input", { ...properties, type: "text" });
      bindTextLike(control, column);
      break;
    }

    case "Numeric":
    case "Int":
      control = element("input", {
        ...commonControl(column, id),
        type: "number",
        step: column.baseType === "Int" ? "1" : "any",
        value: value == null ? "" : String(value)
      });
      bindTextLike(control, column);
      break;

    case "Bool":
      control = createToggle(column, id, Boolean(value));
      break;

    case "Date":
      control = element("input", {
        ...commonControl(column, id),
        type: "date",
        value: dateInputValue(value)
      });
      bindImmediate(control, column);
      break;

    case "DateTime":
      control = element("input", {
        ...commonControl(column, id),
        type: "datetime-local",
        step: "1",
        value: dateTimeInputValue(value)
      });
      bindImmediate(control, column);
      break;

    case "Choice":
      control = createChoice(column, id, value);
      break;

    case "ChoiceList":
      control = createChoiceList(column, id, value);
      break;
  }

  control.dataset.columnId = column.colId;
  state.controls.set(column.colId, { control, column });
  return { id, control };
}

function createToggle(column, id, checked) {
  const input = element("input", {
    id,
    type: "checkbox",
    checked,
    disabled: column.isFormula,
    ariaLabel: column.label
  });
  const wrapper = element("label", {
    className: "toggle-control",
    htmlFor: id
  }, [input, element("span", { className: "toggle-track", ariaHidden: "true" })]);

  input.addEventListener("change", () => saveFromControl(column, wrapper));
  wrapper.valueInput = input;
  return wrapper;
}

function createChoice(column, id, value) {
  const select = element("select", commonControl(column, id));
  select.appendChild(element("option", { value: "", textContent: "" }));

  for (const choice of choiceValues(column, value)) {
    select.appendChild(element("option", {
      value: choice,
      textContent: choice,
      selected: String(value ?? "") === choice
    }));
  }

  bindImmediate(select, column);
  return select;
}

function createChoiceList(column, id, value) {
  const selected = new Set(normalizeChoiceList(value));
  const wrapper = element("div", {
    id,
    className: column.isFormula ? "choice-list disabled" : "choice-list",
    role: "group",
    ariaLabel: column.label
  });
  const choices = choiceValues(column, value);

  if (!choices.length) {
    wrapper.appendChild(element("span", {
      className: "empty-choice-list",
      textContent: "No choices configured"
    }));
  }

  for (const choice of choices) {
    const checkbox = element("input", {
      type: "checkbox",
      value: choice,
      checked: selected.has(choice),
      disabled: column.isFormula,
      ariaLabel: choice
    });
    checkbox.addEventListener("change", () => saveFromControl(column, wrapper));
    wrapper.appendChild(element("label", { className: "choice-option" }, [
      checkbox,
      element("span", { className: "choice-chip", textContent: choice })
    ]));
  }

  return wrapper;
}

function bindTextLike(control, column) {
  control.addEventListener("input", () => scheduleSave(column, control));
  control.addEventListener("change", () => saveFromControl(column, control));
  control.addEventListener("blur", () => saveFromControl(column, control));
}

function bindImmediate(control, column) {
  control.addEventListener("change", () => saveFromControl(column, control));
}

function renderCard(record, fields) {
  state.controls.clear();
  const card = element("form", {
    className: "card",
    ariaLabel: "Dynamic card"
  });
  card.addEventListener("submit", event => event.preventDefault());

  for (const column of fields) {
    const { id, control } = createControl(column, record[column.colId]);
    card.appendChild(element("div", {
      className: "field"
    }, [makeLabel(column, id), control]));
  }

  card.appendChild(element("div", {
    id: "status",
    className: "status",
    role: "status",
    ariaLive: "polite"
  }));
  app.replaceChildren(card);
}

function controlInput(control) {
  return control.valueInput || control;
}

function readControl(column, control) {
  const input = controlInput(control);

  switch (column.baseType) {
    case "Text":
      return input.value;
    case "Numeric":
    case "Int": {
      if (input.value === "") {
        return null;
      }
      const numeric = Number(input.value);
      if (!Number.isFinite(numeric) || (column.baseType === "Int" && !Number.isInteger(numeric))) {
        throw new Error(`${column.label} must be ${column.baseType === "Int" ? "an integer" : "a number"}.`);
      }
      return numeric;
    }
    case "Bool":
      return input.checked;
    case "Date":
      if (!input.value) {
        return null;
      }
      return validTimestamp(Date.parse(`${input.value}T00:00:00Z`) / 1000, column);
    case "DateTime": {
      if (!input.value) {
        return null;
      }
      return validTimestamp(new Date(input.value).getTime() / 1000, column);
    }
    case "Choice":
      return input.value;
    case "ChoiceList": {
      const choices = Array.from(control.querySelectorAll("input:checked"), item => item.value);
      return choices.length ? ["L", ...choices] : null;
    }
    default:
      return null;
  }
}

function validTimestamp(value, column) {
  if (!Number.isFinite(value)) {
    throw new Error(`${column.label} must contain a valid date${column.baseType === "DateTime" ? " and time" : ""}.`);
  }
  return value;
}

function scheduleSave(column, control) {
  let value;
  try {
    value = readControl(column, control);
    controlInput(control).setAttribute("aria-invalid", "false");
  } catch (error) {
    controlInput(control).setAttribute("aria-invalid", "true");
    setStatus(error.message, true);
    return;
  }

  clearScheduledSave(column.colId);
  const rowId = state.record?.id;
  const timeout = window.setTimeout(() => {
    state.timers.delete(column.colId);
    void saveValue(rowId, column, value);
  }, AUTOSAVE_DELAY_MS);

  state.timers.set(column.colId, { timeout, rowId, column, value });
  setStatus("Unsaved changes…");
}

function clearScheduledSave(columnId) {
  const scheduled = state.timers.get(columnId);
  if (scheduled) {
    window.clearTimeout(scheduled.timeout);
    state.timers.delete(columnId);
  }
}

function saveFromControl(column, control) {
  clearScheduledSave(column.colId);
  let value;

  try {
    value = readControl(column, control);
    controlInput(control).setAttribute("aria-invalid", "false");
  } catch (error) {
    controlInput(control).setAttribute("aria-invalid", "true");
    setStatus(error.message, true);
    return;
  }

  void saveValue(state.record?.id, column, value);
}

async function flushScheduledSaves() {
  const saves = Array.from(state.timers.values());
  state.timers.clear();

  for (const save of saves) {
    window.clearTimeout(save.timeout);
  }

  await Promise.allSettled(
    saves.map(save => saveValue(save.rowId, save.column, save.value))
  );
}

async function saveValue(rowId, column, value) {
  if (column.isFormula || rowId == null || rowId === "new") {
    return;
  }

  const existing = state.pending.get(column.colId);
  if (existing?.rowId === rowId && valuesEqual(column, existing.value, value)) {
    return;
  }
  if (!existing && state.record?.id === rowId && valuesEqual(column, state.record[column.colId], value)) {
    setStatus("Saved");
    return;
  }

  const sequence = ++state.saveSequence;
  state.pending.set(column.colId, { sequence, rowId, value });
  state.activeSaves += 1;
  setStatus("Saving…");

  try {
    await grist.selectedTable.update({
      id: rowId,
      fields: { [column.colId]: value }
    });

    if (state.record?.id === rowId) {
      state.record[column.colId] = decodedSavedValue(column, value);
    }
    if (state.fullRecordCache?.rowId === rowId) {
      state.fullRecordCache.record[column.colId] = decodedSavedValue(column, value);
      state.fullRecordCache.fetchedAt = Date.now();
    }

    const pending = state.pending.get(column.colId);
    if (pending?.sequence === sequence) {
      state.pending.delete(column.colId);
    }
  } catch (error) {
    const pending = state.pending.get(column.colId);
    if (pending?.sequence === sequence) {
      state.pending.delete(column.colId);
    }
    console.error(`Could not save ${column.colId}`, error);
    setStatus(`Could not save ${column.label}: ${error.message || error}`, true);
  } finally {
    state.activeSaves -= 1;
    if (!state.activeSaves && !document.querySelector(".status.error")) {
      setStatus("Saved");
    }
  }
}

function decodedSavedValue(column, value) {
  if (column.baseType === "ChoiceList") {
    return Array.isArray(value) && value[0] === "L"
      ? value.slice(1).map(String)
      : [];
  }
  return value;
}

function valuesEqual(column, currentValue, nextValue) {
  if (column.baseType === "ChoiceList") {
    const current = normalizeChoiceList(currentValue);
    const next = Array.isArray(nextValue) && nextValue[0] === "L"
      ? nextValue.slice(1).map(String)
      : normalizeChoiceList(nextValue);
    return JSON.stringify(current) === JSON.stringify(next);
  }
  return Object.is(currentValue, nextValue);
}

function dateInputValue(value) {
  const milliseconds = timestampMilliseconds(value);
  return milliseconds == null ? "" : new Date(milliseconds).toISOString().slice(0, 10);
}

function dateTimeInputValue(value) {
  const milliseconds = timestampMilliseconds(value);
  if (milliseconds == null) {
    return "";
  }

  const date = new Date(milliseconds);
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function timestampMilliseconds(value) {
  if (value == null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reconcileControls(record) {
  for (const [columnId, entry] of state.controls) {
    if (state.pending.has(columnId) || state.timers.has(columnId)) {
      continue;
    }

    const control = entry.control;
    const input = controlInput(control);
    if (input === document.activeElement || control.contains(document.activeElement)) {
      continue;
    }

    const value = record[columnId];
    switch (entry.column.baseType) {
      case "Text":
      case "Numeric":
      case "Int":
        input.value = value == null ? "" : String(value);
        break;
      case "Bool":
        input.checked = Boolean(value);
        break;
      case "Date":
        input.value = dateInputValue(value);
        break;
      case "DateTime":
        input.value = dateTimeInputValue(value);
        break;
      case "Choice":
        input.value = value == null ? "" : String(value);
        break;
      case "ChoiceList": {
        const selected = new Set(normalizeChoiceList(value));
        for (const checkbox of control.querySelectorAll("input[type=checkbox]")) {
          checkbox.checked = selected.has(checkbox.value);
        }
        break;
      }
    }
  }
}

async function handleRecord(record, mappings) {
  const eventSequence = ++state.eventSequence;
  const mapping = normalizeMapping(mappings?.[MAPPING_NAME]);

  if (state.record && record?.id !== state.record.id) {
    await flushScheduledSaves();
  }
  if (eventSequence !== state.eventSequence) {
    return;
  }

  if (!record || record.id == null || record.id === "new") {
    state.record = null;
    state.renderedRecordId = null;
    showMessage("Select an existing record to display its dynamic card.");
    return;
  }

  if (!mapping) {
    state.record = record;
    state.renderedRecordId = null;
    showAlert("Map a table column to Fields in the widget configuration.");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(record, mapping)) {
    state.record = record;
    state.renderedRecordId = null;
    showAlert(`The mapped Fields column "${mapping}" is not available in the linked table.`);
    return;
  }

  try {
    const names = parseFieldList(record[mapping]);
    const metadata = await fetchMetadata(record);
    if (eventSequence !== state.eventSequence) {
      return;
    }

    const fields = resolveFields(names, metadata);
    record = await includeMissingFields(record, fields);
    if (eventSequence !== state.eventSequence) {
      return;
    }
    const definitionKey = JSON.stringify(fields.map(field => [
      field.colId,
      field.type,
      field.label,
      field.description,
      field.isFormula,
      field.options
    ]));
    const canReconcile = state.renderedRecordId === record.id &&
      state.mapping === mapping && state.definitionKey === definitionKey;

    state.record = record;
    state.mapping = mapping;
    state.metadata = metadata;
    state.definitionKey = definitionKey;

    if (canReconcile) {
      reconcileControls(record);
    } else {
      state.renderedRecordId = record.id;
      renderCard(record, fields);
    }
  } catch (error) {
    state.record = record;
    state.renderedRecordId = null;
    showAlert(error.message || String(error));
  }
}

grist.onRecord((record, mappings) => {
  void handleRecord(record, mappings);
});

grist.onNewRecord(() => {
  void flushScheduledSaves().finally(() => {
    state.record = null;
    state.renderedRecordId = null;
    showMessage("Select an existing record to display its dynamic card.");
  });
});

grist.ready({
  requiredAccess: "full",
  columns: [
    {
      name: MAPPING_NAME,
      title: "Fields",
      type: "Any",
      optional: false,
      allowMultiple: false,
      description: "A Choice List or JSON array containing the column IDs or unique labels to show."
    }
  ]
});
