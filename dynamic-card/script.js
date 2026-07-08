"use strict";

const COLUMN_DEFS = [
  {
    name: "DynCardDef",
    title: "Dynamic card definition",
    type: "Text",
    description: "JSON definition of the dynamic card."
  },
  {
    name: "DynCardData",
    title: "Dynamic card data",
    type: "Text",
    description: "JSON data collected by the dynamic card."
  }
];

const TYPES = new Set(["text", "integer", "numeric", "toggle", "choice"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const AUTOSAVE_MS = 300;

const app = document.getElementById("app");

const state = {
  recordId: null,
  mappings: null,
  def: null,
  data: {},
  defText: "",
  savedJson: "",
  saveTimer: null,
  saving: false,
  pendingSave: false,
  suppress: null
};

grist.ready({
  requiredAccess: "full",
  columns: COLUMN_DEFS
});

grist.onRecord((record, mappings) => {
  state.mappings = mappings;

  if (!record) {
    resetState();
    renderEmpty("Select a record to show the dynamic card.");
    return;
  }

  const isNewRecord = state.recordId !== record.id;

  if (isNewRecord) {
    clearSaveTimer();
    state.pendingSave = false;
    state.suppress = null;
  }

  const mapped = grist.mapColumnNames(record);

  if (!mapped) {
    resetState();
    renderError("Please map both required columns: DynCardDef and DynCardData.");
    return;
  }

  const defText = mapped.DynCardDef == null ? "" : String(mapped.DynCardDef);
  const dataText = mapped.DynCardData == null ? "" : String(mapped.DynCardData);

  try {
    const def = parseDynCardDef(defText);
    const parsedData = parseDynCardData(dataText);
    const defaults = applyDefaults(def, parsedData);
    const data = defaults.data;
    const savedJson = JSON.stringify(data, null, 2);

    const skipRender =
      state.suppress &&
      state.suppress.recordId === record.id &&
      state.suppress.defText === defText &&
      state.suppress.dataText === savedJson &&
      document.activeElement &&
      document.activeElement.dataset &&
      document.activeElement.dataset.key;

    state.recordId = record.id;
    state.def = def;
    state.data = data;
    state.defText = defText;
    state.savedJson = savedJson;

    if (skipRender) {
      state.suppress = null;

      if (defaults.changed) {
        persistDefaults(savedJson);
      }

      return;
    }

    clearSaveTimer();
    state.pendingSave = false;
    renderCard();

    if (defaults.changed) {
      persistDefaults(savedJson);
    }
  } catch (err) {
    resetParsedState();
    renderError(err.message, exampleDynCardDef());
  }
});

window.addEventListener("resize", hideAutocomplete);
window.addEventListener("scroll", hideAutocomplete, true);

function resetState() {
  state.recordId = null;
  state.mappings = null;
  resetParsedState();
}

function resetParsedState() {
  state.def = null;
  state.data = {};
  state.defText = "";
  state.savedJson = "";
  state.saving = false;
  state.pendingSave = false;
  state.suppress = null;
  clearSaveTimer();
  hideAutocomplete();
}

function parseDynCardDef(text) {
  if (!text.trim()) {
    throw new Error("DynCardDef is empty. Add a JSON dynamic card definition.");
  }

  const raw = parseJson(text, "DynCardDef");

  if (!isPlainObject(raw)) {
    throw new Error("DynCardDef must be a JSON object.");
  }

  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    throw new Error("DynCardDef.fields must be a non-empty array.");
  }

  const seen = new Set();

  return {
    title: raw.title == null ? "" : String(raw.title),
    help: raw.help == null ? "" : String(raw.help),
    fields: raw.fields.map((field, index) => parseField(field, index, seen))
  };
}

function parseField(field, index, seen) {
  if (!isPlainObject(field)) {
    throw new Error(`DynCardDef.fields[${index}] must be an object.`);
  }

  const key = String(field.key || "").trim();
  const label = String(field.label || key).trim();
  const type = String(field.type || "text").trim().toLowerCase();

  if (!key) {
    throw new Error(`DynCardDef.fields[${index}] is missing "key".`);
  }

  if (FORBIDDEN_KEYS.has(key)) {
    throw new Error(`DynCardDef field key "${key}" is not allowed.`);
  }

  if (seen.has(key)) {
    throw new Error(`Duplicate field key in DynCardDef: "${key}".`);
  }

  if (!TYPES.has(type)) {
    throw new Error(
      `Unsupported field type "${type}" for "${key}". Use "text", "integer", "numeric", "toggle", or "choice".`
    );
  }

  seen.add(key);

  return {
    key,
    label,
    type,
    multiline: Boolean(field.multiline),
    placeholder: field.placeholder == null ? "" : String(field.placeholder),
    help: field.help == null ? "" : String(field.help),
    unit: field.unit == null ? "" : String(field.unit),
    min: optionalNumber(field.min, `min for "${key}"`),
    max: optionalNumber(field.max, `max for "${key}"`),
    step: field.step == null ? undefined : String(field.step),
    default: field.default,
    autocomplete: normalizeAutocomplete(field.autocomplete, key),
    choices: normalizeChoices(field.choices || field.options, key, type)
  };
}

function parseDynCardData(text) {
  if (!text.trim()) {
    return {};
  }

  const data = parseJson(text, "DynCardData");

  if (!isPlainObject(data)) {
    throw new Error("DynCardData must be a JSON object.");
  }

  return data;
}

function parseJson(text, name) {
  try {
    return JSON.parse(String(text));
  } catch (err) {
    throw new Error(`${name} contains invalid JSON: ${err.message}`);
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function optionalNumber(value, label) {
  if (value == null || value === "") {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value for ${label}.`);
  }

  return number;
}

function normalizeAutocomplete(value, key) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Autocomplete for "${key}" must be an array.`);
  }

  return value.map((item, index) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      return String(item);
    }

    throw new Error(
      `Autocomplete item ${index} for "${key}" must be a string, number, or boolean.`
    );
  });
}

function normalizeChoices(value, key, type) {
  if (type !== "choice") {
    return [];
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Choice field "${key}" must define a non-empty choices array.`);
  }

  return value.map((item, index) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      const text = String(item);
      return { value: text, label: text };
    }

    if (isPlainObject(item)) {
      const itemValue = item.value == null ? "" : String(item.value);
      const itemLabel = item.label == null ? itemValue : String(item.label);

      if (!itemValue) {
        throw new Error(`Choice item ${index} for "${key}" is missing "value".`);
      }

      return { value: itemValue, label: itemLabel };
    }

    throw new Error(
      `Choice item ${index} for "${key}" must be a string, number, boolean, or object.`
    );
  });
}

function applyDefaults(def, data) {
  const nextData = { ...data };
  let changed = false;

  for (const field of def.fields) {
    if (Object.prototype.hasOwnProperty.call(nextData, field.key)) {
      continue;
    }

    if (field.default !== undefined) {
      nextData[field.key] = defaultValueFor(field);
    } else {
      nextData[field.key] = emptyValueFor(field);
    }

    changed = true;
  }

  return {
    data: nextData,
    changed
  };
}

function emptyValueFor(field) {
  if (field.type === "toggle") {
    return false;
  }

  if (field.type === "integer" || field.type === "numeric") {
    return null;
  }

  if (field.type === "choice") {
    return null;
  }

  return "";
}

function defaultValueFor(field) {
  const value = field.default;

  if (field.type === "toggle") {
    return booleanFrom(value);
  }

  if (field.type === "choice") {
    return value == null || value === "" ? null : String(value);
  }

  if (field.type === "integer" || field.type === "numeric") {
    return parseNumberField(value == null ? "" : String(value), field);
  }

  return value == null ? "" : String(value);
}

function booleanFrom(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function renderCard() {
  app.replaceChildren();

  const card = el("section", { className: "card" });

  if (state.def.title) {
    card.appendChild(renderTitle());
  } else {
    card.appendChild(el("div", { className: "title-row hidden" }));
  }

  for (const field of state.def.fields) {
    card.appendChild(renderField(field));
  }

  card.appendChild(el("div", {
    id: "status",
    className: "status"
  }));

  app.appendChild(card);
}

function renderTitle() {
  const row = el("div", { className: "title-row" }, [
    el("span", { textContent: state.def.title })
  ]);

  if (state.def.help) {
    row.appendChild(infoIcon(state.def.help));
  }

  return row;
}

function renderField(field) {
  const label = el("label", {
    className: "label-text",
    htmlFor: inputId(field.key),
    textContent: field.label
  });

  const labelRow = el("div", { className: "label-row" }, [label]);

  if (field.help) {
    labelRow.appendChild(infoIcon(field.help));
  }

  const hasUnit = field.unit && field.type !== "toggle";
  const controlRow = el("div", {
    className: hasUnit ? "control-row has-unit" : "control-row"
  });

  controlRow.appendChild(createControl(field));

  if (hasUnit) {
    controlRow.appendChild(el("span", {
      className: "unit",
      textContent: field.unit
    }));
  }

  return el("div", { className: "field" }, [labelRow, controlRow]);
}

function createControl(field) {
  if (field.type === "toggle") {
    return createToggle(field);
  }

  if (field.type === "choice") {
    return createChoice(field);
  }

  return createTextLike(field);
}

function createTextLike(field) {
  const input = field.type === "text" && field.multiline
    ? document.createElement("textarea")
    : document.createElement("input");

  if (input.tagName === "INPUT") {
    input.type = field.type === "integer" || field.type === "numeric"
      ? "number"
      : "text";
  }

  input.id = inputId(field.key);
  input.name = field.key;
  input.dataset.key = field.key;
  input.placeholder = field.placeholder;
  input.value = valueFor(field);

  if (field.type === "integer" || field.type === "numeric") {
    input.step = field.step || (field.type === "integer" ? "1" : "any");

    if (field.min !== undefined) {
      input.min = String(field.min);
    }

    if (field.max !== undefined) {
      input.max = String(field.max);
    }
  }

  input.addEventListener("input", () => {
    scheduleSave();

    if (field.autocomplete.length) {
      showAutocomplete(input, field);
    }
  });

  input.addEventListener("focus", () => {
    if (field.autocomplete.length) {
      showAutocomplete(input, field);
    }
  });

  input.addEventListener("keydown", (event) => {
    if (field.autocomplete.length) {
      handleAutocompleteKeys(event, input);
    }
  });

  input.addEventListener("change", flushSave);

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      hideAutocomplete();
      flushSave();
    }, 120);
  });

  return input;
}

function createChoice(field) {
  const select = el("select", {
    id: inputId(field.key),
    name: field.key
  });

  select.dataset.key = field.key;

  select.appendChild(el("option", {
    value: "",
    textContent: field.placeholder || ""
  }));

  for (const choice of field.choices) {
    select.appendChild(el("option", {
      value: choice.value,
      textContent: choice.label
    }));
  }

  select.value = valueFor(field);
  select.addEventListener("change", saveNow);

  return select;
}

function createToggle(field) {
  const input = el("input", {
    type: "checkbox",
    id: inputId(field.key),
    name: field.key,
    checked: booleanValueFor(field)
  });

  input.dataset.key = field.key;
  input.setAttribute("aria-label", field.label);

  input.addEventListener("change", saveNow);

  const switchEl = el("span", { className: "toggle-switch" }, [
    el("span", { className: "toggle-switch-track" }),
    el("span", { className: "toggle-switch-pill" })
  ]);

  return el("label", { className: "toggle" }, [
    input,
    switchEl
  ]);
}

function valueFor(field) {
  const value = state.data[field.key];

  if ((value === undefined || value === null) && field.default !== undefined) {
    return defaultValueFor(field);
  }

  return value == null ? "" : String(value);
}

function booleanValueFor(field) {
  const value = state.data[field.key];

  if ((value === undefined || value === null) && field.default !== undefined) {
    return booleanFrom(field.default);
  }

  return booleanFrom(value);
}

function scheduleSave() {
  clearSaveTimer();
  setStatus("Editing…");

  state.saveTimer = window.setTimeout(() => {
    state.saveTimer = null;
    save();
  }, AUTOSAVE_MS);
}

function flushSave() {
  if (!state.saveTimer) {
    return;
  }

  clearSaveTimer();
  save();
}

function saveNow() {
  if (state.saveTimer) {
    flushSave();
    return;
  }

  save();
}

function clearSaveTimer() {
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
}

async function save() {
  if (!state.recordId || !state.def) {
    return;
  }

  if (state.saving) {
    state.pendingSave = true;
    return;
  }

  const recordId = state.recordId;
  const defText = state.defText;

  let nextData;
  let nextJson;

  try {
    nextData = {
      ...state.data,
      ...collectValues()
    };
    nextJson = JSON.stringify(nextData, null, 2);

    if (nextJson === state.savedJson) {
      clearStatus();
      return;
    }
  } catch (err) {
    setStatus(err.message || String(err), "error");
    return;
  }

  try {
    state.saving = true;
    setStatus("Saving…");

    state.suppress = {
      recordId,
      defText,
      dataText: nextJson
    };

    await grist.selectedTable.update({
      id: recordId,
      fields: {
        [mappedColumn("DynCardData")]: nextJson
      }
    });

    if (state.recordId === recordId && state.defText === defText) {
      state.data = nextData;
      state.savedJson = nextJson;
      setStatus("Saved.");
      window.setTimeout(clearStatus, 900);
    }
  } catch (err) {
    state.suppress = null;
    setStatus(err.message || String(err), "error");
  } finally {
    state.saving = false;

    if (state.pendingSave && state.recordId === recordId) {
      state.pendingSave = false;
      save();
    } else if (state.recordId === recordId) {
      state.pendingSave = false;
    }
  }
}

async function persistDefaults(jsonText) {
  if (!state.recordId || !state.def) {
    return;
  }

  if (state.saving) {
    state.pendingSave = true;
    return;
  }

  const recordId = state.recordId;
  const defText = state.defText;

  try {
    state.saving = true;

    state.suppress = {
      recordId,
      defText,
      dataText: jsonText
    };

    await grist.selectedTable.update({
      id: recordId,
      fields: {
        [mappedColumn("DynCardData")]: jsonText
      }
    });

    if (state.recordId === recordId && state.defText === defText) {
      state.savedJson = jsonText;
    }
  } catch (err) {
    state.suppress = null;
    setStatus(`Could not persist default values: ${err.message || String(err)}`, "error");
  } finally {
    state.saving = false;

    if (state.pendingSave && state.recordId === recordId) {
      state.pendingSave = false;
      save();
    } else if (state.recordId === recordId) {
      state.pendingSave = false;
    }
  }
}

function collectValues() {
  const values = {};

  for (const field of state.def.fields) {
    const input = document.querySelector(`[data-key="${cssEscape(field.key)}"]`);

    if (!input) {
      continue;
    }

    if (field.type === "toggle") {
      values[field.key] = Boolean(input.checked);
      continue;
    }

    const raw = input.value == null ? "" : String(input.value).trim();

    if (field.type === "choice") {
      values[field.key] = raw === "" ? null : raw;
      continue;
    }

    if (field.type === "integer" || field.type === "numeric") {
      values[field.key] = parseNumberField(raw, field);
      continue;
    }

    values[field.key] = input.value;
  }

  return values;
}

function parseNumberField(raw, field) {
  if (raw === "") {
    return null;
  }

  const number = Number(raw);

  if (!Number.isFinite(number)) {
    throw new Error(`"${field.label}" must be a valid number.`);
  }

  if (field.type === "integer" && !Number.isInteger(number)) {
    throw new Error(`"${field.label}" must be an integer.`);
  }

  if (field.min !== undefined && number < field.min) {
    throw new Error(`"${field.label}" must be at least ${field.min}.`);
  }

  if (field.max !== undefined && number > field.max) {
    throw new Error(`"${field.label}" must be at most ${field.max}.`);
  }

  return number;
}

function getMenu() {
  let menu = document.getElementById("autocomplete-menu");

  if (!menu) {
    menu = el("div", {
      id: "autocomplete-menu",
      className: "autocomplete-menu"
    });
    document.body.appendChild(menu);
  }

  return menu;
}

function showAutocomplete(input, field) {
  const query = input.value.trim().toLowerCase();
  const matches = field.autocomplete
    .filter((value) => !query || value.toLowerCase().includes(query))
    .slice(0, 30);

  if (!matches.length) {
    hideAutocomplete();
    return;
  }

  const menu = getMenu();
  menu.replaceChildren();

  for (const value of matches) {
    const item = el("div", {
      className: "autocomplete-item",
      textContent: value
    });

    item.dataset.value = value;

    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      input.value = value;
      hideAutocomplete();
      saveNow();
    });

    menu.appendChild(item);
  }

  const rect = input.getBoundingClientRect();
  const pad = 4;
  const width = Math.max(0, Math.min(rect.width, window.innerWidth - pad * 2));

  menu.style.left = `${Math.max(pad, rect.left)}px`;
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.width = `${width}px`;
  menu.className = "autocomplete-menu visible";

  const menuRect = menu.getBoundingClientRect();

  if (menuRect.right > window.innerWidth - pad) {
    menu.style.left = `${Math.max(pad, window.innerWidth - menuRect.width - pad)}px`;
  }

  if (menuRect.bottom > window.innerHeight - pad) {
    menu.style.top = `${Math.max(pad, rect.top - menuRect.height - 2)}px`;
  }

  setActiveAutocomplete(-1);
}

function hideAutocomplete() {
  const menu = document.getElementById("autocomplete-menu");

  if (!menu) {
    return;
  }

  menu.className = "autocomplete-menu";
  menu.replaceChildren();
}

function handleAutocompleteKeys(event, input) {
  const menu = document.getElementById("autocomplete-menu");

  if (!menu || !menu.classList.contains("visible")) {
    return;
  }

  const items = Array.from(menu.querySelectorAll(".autocomplete-item"));

  if (!items.length) {
    return;
  }

  const active = items.findIndex((item) => item.classList.contains("active"));

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveAutocomplete(active < items.length - 1 ? active + 1 : 0);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveAutocomplete(active > 0 ? active - 1 : items.length - 1);
    return;
  }

  if (event.key === "Enter" && active >= 0) {
    event.preventDefault();
    input.value = items[active].dataset.value;
    hideAutocomplete();
    saveNow();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideAutocomplete();
  }
}

function setActiveAutocomplete(index) {
  const items = Array.from(document.querySelectorAll(".autocomplete-item"));

  items.forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
  });

  if (index >= 0 && items[index]) {
    items[index].scrollIntoView({ block: "nearest" });
  }
}

function infoIcon(text) {
  return el("span", {
    className: "info-icon",
    textContent: "i",
    title: text,
    tabIndex: 0,
    ariaLabel: text
  });
}

function renderEmpty(message) {
  app.replaceChildren(el("div", {
    className: "empty",
    textContent: message
  }));
}

function renderError(message, example) {
  const box = el("div", { className: "error-box" }, [
    el("strong", { textContent: "Dynamic card configuration error" }),
    el("p", { textContent: message })
  ]);

  if (example) {
    const details = el("details", { open: true }, [
      el("summary", { textContent: "Example DynCardDef" }),
      el("pre", { textContent: example })
    ]);

    box.appendChild(details);
  }

  app.replaceChildren(box);
}

function setStatus(message, type = "info") {
  const status = document.getElementById("status");

  if (!status) {
    return;
  }

  status.textContent = message || "";
  status.className = `status ${type}`;
}

function clearStatus() {
  setStatus("");
}

function mappedColumn(name) {
  const mapped = state.mappings && state.mappings[name];
  return Array.isArray(mapped) ? mapped[0] : mapped || name;
}

function inputId(key) {
  return `field-${String(key).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key === "className") {
      node.className = value;
    } else if (key === "textContent") {
      node.textContent = value;
    } else if (key === "htmlFor") {
      node.htmlFor = value;
    } else if (key === "ariaLabel") {
      node.setAttribute("aria-label", value);
    } else {
      node[key] = value;
    }
  }

  for (const child of children) {
    node.appendChild(child);
  }

  return node;
}

function exampleDynCardDef() {
  return JSON.stringify(
    {
      title: "Dettaglio prestazione",
      help: "Help text for the whole dynamic card.",
      fields: [
        {
          key: "comune_partenza",
          label: "Comune partenza",
          type: "text",
          help: "Comune di partenza della prestazione.",
          autocomplete: [
            "Sassari",
            "Alghero",
            "Olbia",
            "Tempio Pausania",
            "Porto Torres"
          ]
        },
        {
          key: "mezzo_proprio",
          label: "Mezzo proprio",
          type: "toggle",
          help: "Indica se è stato utilizzato il mezzo proprio."
        },
        {
          key: "tipo_veicolo",
          label: "Tipo veicolo",
          type: "choice",
          help: "Seleziona la tipologia di veicolo.",
          choices: ["APS", "ABP", "CA", "AF"]
        },
        {
          key: "km",
          label: "Chilometri",
          type: "integer",
          min: 0,
          step: 1,
          unit: "km",
          help: "Distanza percorsa.",
          autocomplete: [10, 25, 50, 100]
        },
        {
          key: "importo",
          label: "Importo",
          type: "numeric",
          min: 0,
          step: 0.01,
          unit: "€",
          help: "Importo in euro."
        },
        {
          key: "nota",
          label: "Nota",
          type: "text",
          multiline: true,
          help: "Eventuali note aggiuntive."
        }
      ]
    },
    null,
    2
  );
}
