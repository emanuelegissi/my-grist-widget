"use strict";

const AUTOSAVE_DELAY_MS = 350;
const FIELDS_MAPPING = "Fields";
const TWO_DIGIT_YEAR_THRESHOLD = 10;
const AVAILABLE_DATEPICKER_LOCALES = new Set(
  ("ar-tn ar az bg bm bn br bs ca cs cy da de el en-AU en-CA en-GB en-IE en-NZ en-ZA " +
  "eo es et eu fa fi fo fr-CH fr gl he hi hr hu hy id is it-CH it ja ka kh kk km ko kr " +
  "lt lv me mk mn ms nl-BE nl no oc pl pt-BR pt ro rs-latin rs ru si sk sl sq sr-latin " +
  "sr sv sw ta tg th tk tr uk uz-cyrl uz-latn vi zh-CN zh-TW").split(/\s+/)
);
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
const DEFAULT_ALIGNMENTS = Object.freeze({
  Text: "left",
  Numeric: "right",
  Int: "right",
  Bool: "center",
  Date: "left",
  DateTime: "left",
  Choice: "left",
  ChoiceList: "left"
});
const REGION_CURRENCIES = Object.freeze({
  AU: "AUD", BR: "BRL", CA: "CAD", CH: "CHF", CN: "CNY", CZ: "CZK",
  DK: "DKK", GB: "GBP", HK: "HKD", HU: "HUF", ID: "IDR", IL: "ILS",
  IN: "INR", IS: "ISK", JP: "JPY", KR: "KRW", MX: "MXN", MY: "MYR",
  NO: "NOK", NZ: "NZD", PL: "PLN", RO: "RON", RU: "RUB", SE: "SEK",
  SG: "SGD", TH: "THB", TR: "TRY", TW: "TWD", UA: "UAH", US: "USD",
  ZA: "ZAR"
});

const app = document.getElementById("app");
const state = {
  record: null,
  mapping: null,
  metadata: new Map(),
  docSettings: {
    locale: navigator.language || "en-US",
    currency: undefined,
    timezone: "UTC"
  },
  tableId: null,
  definitionKey: "",
  renderedRecordId: null,
  controls: new Map(),
  timers: new Map(),
  saveChains: new Map(),
  lastQueuedValues: new Map(),
  fullRecordCache: null,
  eventSequence: 0,
  datePickers: new Set()
};
const datepickerLocalePromises = new Map();

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
      node.setAttribute(attribute, String(value));
    } else {
      node[name] = value;
    }
  }

  for (const child of children) {
    node.appendChild(child);
  }

  return node;
}

function clearRenderedState() {
  destroyDatePickers();
  state.controls.clear();
  state.definitionKey = "";
  state.renderedRecordId = null;
}

function showEmptyPanel() {
  clearRenderedState();
  app.replaceChildren(element("div", {
    className: "card",
    ariaLabel: "Dynamic card"
  }));
}

function showAlert(message) {
  clearRenderedState();
  const titleId = "dynamic-card-alert-title";
  const panel = element("div", {
    className: "alert-panel",
    role: "alertdialog",
    tabIndex: -1,
    ariaModal: "false",
    ariaLabelledby: titleId
  }, [
    element("strong", {
      id: titleId,
      className: "alert-title",
      textContent: "Dynamic card configuration error"
    }),
    element("p", { textContent: message })
  ]);

  app.replaceChildren(element("div", { className: "alert" }, [panel]));
  panel.focus();
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
  return Array.isArray(mapping) ? mapping[0] || null : mapping || null;
}

function parseFieldList(value) {
  if (value == null || value === "") {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("The mapped Fields column must be a Grist Choice List of column IDs.");
  }
  return value;
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

function columnAlignment(column) {
  const alignment = column?.options?.alignment;
  return ["left", "center", "right"].includes(alignment)
    ? alignment
    : DEFAULT_ALIGNMENTS[column.baseType] || "left";
}

function applyColumnAlignment(control, column) {
  const alignment = columnAlignment(column);
  control.dataset.alignment = alignment;
  if (column.baseType === "Bool" || column.baseType === "Choice" || column.baseType === "ChoiceList") {
    control.style.justifyContent = alignment === "right" ? "flex-end" : alignment;
    if (control.choiceDisplay) {
      control.choiceDisplay.style.justifyContent = alignment === "right" ? "flex-end" : alignment;
    }
  } else {
    control.style.textAlign = alignment;
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function documentCurrency() {
  if (state.docSettings.currency) {
    return state.docSettings.currency;
  }
  try {
    const locale = new Intl.Locale(state.docSettings.locale).maximize();
    return REGION_CURRENCIES[locale.region] || "USD";
  } catch (error) {
    return "USD";
  }
}

function numberFormatOptions(column) {
  const options = column.baseType === "Int"
    ? { decimals: 0, ...column.options }
    : column.options;
  let intlOptions;

  switch (options.numMode) {
    case "currency":
      intlOptions = {
        style: "currency",
        currency: options.currency || documentCurrency(),
        currencyDisplay: "narrowSymbol"
      };
      break;
    case "decimal":
      intlOptions = { useGrouping: true };
      break;
    case "percent":
      intlOptions = { style: "percent" };
      break;
    case "scientific":
      intlOptions = { notation: "scientific" };
      break;
    default:
      intlOptions = { useGrouping: false };
  }

  if (options.decimals !== undefined && options.decimals !== null) {
    intlOptions.minimumFractionDigits = clamp(options.decimals, 0, 20);
  }
  const resolved = new Intl.NumberFormat(state.docSettings.locale, intlOptions).resolvedOptions();
  if (options.maxDecimals !== undefined && options.maxDecimals !== null) {
    intlOptions.maximumFractionDigits = clamp(
      options.maxDecimals,
      resolved.minimumFractionDigits || 0,
      20
    );
  } else if (!options.numMode) {
    intlOptions.maximumFractionDigits = clamp(10, resolved.minimumFractionDigits || 0, 20);
  }
  return intlOptions;
}

function numberFormatter(column) {
  return new Intl.NumberFormat(state.docSettings.locale, numberFormatOptions(column));
}

function formatNumber(value, column) {
  if (value == null || value === "") {
    return "";
  }
  const formatted = numberFormatter(column).format(Number(value));
  if (column.options.numSign !== "parens") {
    return formatted;
  }
  return Number(value) >= 0
    ? ` ${formatted} `
    : `(${numberFormatter(column).format(-Number(value))})`;
}

function numericEditValue(value) {
  if (value == null || value === "") {
    return "";
  }
  return new Intl.NumberFormat(state.docSettings.locale, {
    useGrouping: false,
    maximumFractionDigits: 20
  }).format(Number(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Adapted from grist-core's NumberParse. It accepts the symbols and digits used by the document locale.
function parseLocalizedNumber(input, column) {
  const locale = state.docSettings.locale;
  const currency = column.options.currency || documentCurrency();
  const modes = {
    decimal: { useGrouping: true },
    currency: { style: "currency", currency, currencyDisplay: "narrowSymbol" },
    percent: { style: "percent" },
    scientific: { notation: "scientific" }
  };
  const partsByMode = Object.fromEntries(Object.entries(modes).map(([mode, options]) => [
    mode,
    new Intl.NumberFormat(locale, options).formatToParts(-1234567.5678)
  ]));
  const part = (type, mode = "decimal") =>
    partsByMode[mode].find(item => item.type === type)?.value || "";
  const currencySymbol = part("currency", "currency");
  const percentSymbol = part("percentSign", "percent");
  const exponentSeparator = part("exponentSeparator", "scientific");
  const decimalSeparator = part("decimal");
  const minusSign = part("minusSign");
  const separators = new Set([part("group"), part("group", "currency")].filter(Boolean));
  const digits = new Map();
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  for (let digit = 0; digit < 10; digit += 1) {
    digits.set(digitFormatter.format(digit), String(digit));
  }

  let value = String(input);
  const hadCurrency = currencySymbol && value.includes(currencySymbol);
  const hadPercent = percentSymbol && value.includes(percentSymbol);
  if (hadCurrency) {
    value = value.replace(currencySymbol, "");
  }
  if (hadPercent) {
    value = value.replace(percentSymbol, "");
  }
  value = value.replace(/[\s\u200e\u200f\u061c]/g, "");
  const parenthesized = value.startsWith("(") && value.endsWith(")");
  if (parenthesized) {
    value = value.slice(1, -1);
  }
  if (!value) {
    return null;
  }

  if (exponentSeparator) {
    value = value.replace(new RegExp(escapeRegExp(exponentSeparator), "i"), "e");
  }
  for (const [localizedDigit, plainDigit] of digits) {
    if (localizedDigit !== plainDigit) {
      value = value.split(localizedDigit).join(plainDigit);
    }
  }
  for (const separator of separators) {
    value = value.split(separator).join("");
  }
  if (decimalSeparator && decimalSeparator !== ".") {
    value = value.replace(decimalSeparator, ".");
  }
  if (minusSign && minusSign !== "-") {
    value = value.split(minusSign).join("-");
  }
  if (hadCurrency && value.endsWith("-")) {
    value = `-${value.slice(0, -1)}`;
  }

  let result = Number(value);
  if (!Number.isFinite(result) || (parenthesized && result <= 0)) {
    return null;
  }
  if (parenthesized) {
    result = -result;
  }
  if (hadPercent) {
    result *= 0.01;
  }
  return result;
}

async function getSelectedTableId() {
  if (typeof grist.getSelectedTableId === "function") {
    return grist.getSelectedTableId();
  }
  if (grist.selectedTable && typeof grist.selectedTable.getTableId === "function") {
    return grist.selectedTable.getTableId();
  }

  const table = typeof grist.getTable === "function" ? grist.getTable() : null;
  if (table && typeof table.getTableId === "function") {
    return table.getTableId();
  }
  if (table?._platform && typeof table._platform.getTableId === "function") {
    return table._platform.getTableId();
  }
  throw new Error("The selected table could not be identified.");
}

async function fetchMetadata() {
  const tableId = await getSelectedTableId();

  if (state.tableId === tableId && state.metadata.size) {
    return state.metadata;
  }
  if (state.tableId !== tableId) {
    state.fullRecordCache = null;
  }
  state.tableId = tableId;

  const [tables, columns, docInfo] = await Promise.all([
    grist.docApi.fetchTable("_grist_Tables"),
    grist.docApi.fetchTable("_grist_Tables_column"),
    grist.docApi.fetchTable("_grist_DocInfo")
  ]);
  const tableIndex = tables.tableId.indexOf(tableId);

  if (tableIndex < 0) {
    throw new Error(`Metadata for table "${tableId}" was not found.`);
  }

  const tableRef = tables.id[tableIndex];
  const metadata = new Map();
  const documentSettings = parseWidgetOptions(docInfo.documentSettings?.[0]);
  state.docSettings = {
    locale: documentSettings.locale || navigator.language || "en-US",
    currency: documentSettings.currency,
    timezone: docInfo.timezone?.[0] || "UTC"
  };

  for (let index = 0; index < columns.id.length; index += 1) {
    if (columns.parentId[index] !== tableRef) {
      continue;
    }

    const colId = columns.colId[index];
    metadata.set(colId, {
      colId,
      label: columns.label?.[index] || colId,
      description: columns.description?.[index] || "",
      type: columns.type?.[index] || "",
      isFormula: Boolean(columns.isFormula?.[index]),
      options: parseWidgetOptions(columns.widgetOptions?.[index])
    });
  }

  if (!metadata.size) {
    throw new Error(`No column metadata was found for table "${tableId}".`);
  }
  state.metadata = metadata;
  return metadata;
}

function resolveFields(fieldIds, metadata) {
  return fieldIds.map(fieldId => {
    const column = metadata.get(fieldId);

    if (!column) {
      throw new Error(`Field "${fieldId}" does not exist in the linked table. Use column IDs, not labels.`);
    }

    const type = baseType(column.type);
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(
        `Field "${column.label}" (${column.colId}) has unsupported Grist type ` +
        `"${column.type || "unknown"}".`
      );
    }
    return { ...column, baseType: type };
  });
}

async function fetchFullRecord(rowId) {
  const tableId = state.tableId || await getSelectedTableId();
  const cached = state.fullRecordCache;

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

  const record = { id: rowId };
  for (const [columnId, values] of Object.entries(table)) {
    if (columnId !== "id" && Array.isArray(values)) {
      record[columnId] = values[rowIndex];
    }
  }

  state.fullRecordCache = {
    tableId,
    rowId,
    fetchedAt: Date.now(),
    record
  };
  return { ...record };
}

async function includeColumns(record, columnIds) {
  const missing = columnIds.filter(columnId =>
    !Object.prototype.hasOwnProperty.call(record, columnId)
  );

  if (!missing.length) {
    return record;
  }

  const fullRecord = await fetchFullRecord(record.id);
  const unavailable = missing.filter(columnId =>
    !Object.prototype.hasOwnProperty.call(fullRecord, columnId)
  );

  if (unavailable.length) {
    throw new Error(
      `The following fields are unavailable under the current access rules: ` +
      `${unavailable.map(columnId => `"${columnId}"`).join(", ")}.`
    );
  }
  return { ...fullRecord, ...record };
}

function normalizeChoiceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const values = value[0] === "L" ? value.slice(1) : value;
  return values.map(String);
}

function configuredChoices(column) {
  return Array.isArray(column.options.choices)
    ? column.options.choices.map(String)
    : [];
}

function choiceValues(column, currentValue) {
  const current = column.baseType === "ChoiceList"
    ? normalizeChoiceList(currentValue)
    : currentValue == null || currentValue === "" ? [] : [String(currentValue)];
  return Array.from(new Set([...configuredChoices(column), ...current]));
}

function inputId(columnId) {
  return `dynamic-card-${columnId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function makeLabel(column, id) {
  const label = element("div", {
    className: "field-label g_record_detail_label_container"
  }, [
    element("label", {
      className: "field-label-text g_record_detail_label",
      htmlFor: id,
      textContent: column.label
    })
  ]);

  if (column.description) {
    label.appendChild(element("button", {
      className: "info",
      type: "button",
      title: column.description,
      ariaLabel: column.description
    }, [
      element("span", { className: "info_toggle_icon", ariaHidden: "true" })
    ]));
  }
  return label;
}

function commonControl(column, id) {
  return {
    id,
    className: "field_clip control",
    disabled: column.isFormula,
    ariaLabel: column.label
  };
}

function createControl(column, value) {
  const id = inputId(column.colId);
  let control;

  switch (column.baseType) {
    case "Text": {
      const properties = {
        ...commonControl(column, id),
        rows: 1,
        value: value == null ? "" : String(value)
      };
      control = element("textarea", properties);
      bindTextLike(control, column);
      break;
    }

    case "Numeric":
    case "Int":
      control = element("input", {
        ...commonControl(column, id),
        type: "text",
        inputMode: "decimal",
        autoComplete: "off",
        spellcheck: false,
        value: formatNumber(value, column)
      });
      bindNumericControl(control, column);
      break;

    case "Bool":
      control = createToggle(column, id, Boolean(value));
      break;

    case "Date": {
      const format = fullDateFormat(column);
      control = element("input", {
        ...commonControl(column, id),
        type: "text",
        inputMode: /MMM|ddd|dd/.test(format) ? "text" : "numeric",
        autoComplete: "off",
        spellcheck: false,
        placeholder: datePlaceholder(format),
        value: dateInputValue(value, column)
      });
      bindDateControl(control, column);
      break;
    }

    case "DateTime":
      control = createDateTimeControl(column, id, value);
      break;

    case "Choice":
      control = createChoice(column, id, value);
      break;

    case "ChoiceList":
      control = createChoiceList(column, id, value);
      break;
  }

  control.dataset.columnId = column.colId;
  applyColumnAlignment(control, column);
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
  const useSwitch = column.options.widget === "Switch";
  let indicator;
  if (useSwitch) {
    indicator = element("span", { className: "switch-shell", ariaHidden: "true" }, [
      element("span", { className: "switch-slider" }),
      element("span", { className: "switch-circle" })
    ]);
  } else {
    indicator = element("span", { className: "widget_checkbox", ariaHidden: "true" }, [
      element("span", { className: "widget_checkmark" }, [
        element("span", { className: "checkmark_kick" }),
        element("span", { className: "checkmark_stem" })
      ])
    ]);
  }
  const toggle = element("label", {
    className: `bool-toggle ${useSwitch ? "bool-switch" : "bool-checkbox"}`,
    htmlFor: id
  }, [input, indicator]);
  const wrapper = element("div", {
    className: "field_clip bool-control"
  }, [toggle]);

  if (!column.isFormula) {
    input.addEventListener("change", () => saveFromControl(column, wrapper));
  }
  wrapper.valueInput = input;
  return wrapper;
}

function choiceStyle(column, choice) {
  const options = column.options.choiceOptions;
  return options && typeof options === "object" && options[choice]
    ? options[choice]
    : {};
}

function readableChoiceText(fillColor) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fillColor || "");
  if (!match) {
    return "var(--grist-theme-choice-token-fg, #262633)";
  }
  let hex = match[1];
  if (hex.length === 3) {
    hex = Array.from(hex, character => character + character).join("");
  }
  const rgb = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = rgb.map(value => value <= 0.03928
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const shades = ["#e8e8e8", "#bfbfbf", "#959595", "#70707d", "#44444c", "#242428", "#000000"];
  let best = shades[0];
  let bestContrast = 0;
  for (const shade of shades) {
    const value = Number.parseInt(shade.slice(1, 3), 16) / 255;
    const shadeLinear = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    const contrast = (Math.max(luminance, shadeLinear) + 0.05) /
      (Math.min(luminance, shadeLinear) + 0.05);
    if (contrast > bestContrast) {
      best = shade;
      bestContrast = contrast;
    }
    if (contrast > 7) {
      break;
    }
  }
  return best;
}

function applyChoiceStyle(node, column, choice, isConfigured) {
  if (choice === "") {
    node.style.backgroundColor = "inherit";
    node.style.color = "inherit";
    node.style.fontWeight = "";
    node.style.fontStyle = "";
    node.style.textDecoration = "";
    node.classList.remove("invalid-choice");
    return;
  }
  const style = choiceStyle(column, choice);
  const fillColor = style.fillColor || "var(--grist-theme-choice-token-bg, #e8e8e8)";
  const textColor = style.textColor || (style.fillColor
    ? readableChoiceText(style.fillColor)
    : "var(--grist-theme-choice-token-fg, #262633)");
  node.style.backgroundColor = fillColor;
  node.style.color = textColor;
  node.style.fontWeight = style.fontBold ? "bold" : "";
  node.style.fontStyle = style.fontItalic ? "italic" : "";
  node.style.textDecoration = [
    style.fontUnderline ? "underline" : "",
    style.fontStrikethrough ? "line-through" : ""
  ].filter(Boolean).join(" ");
  node.classList.toggle("invalid-choice", !isConfigured);
}

function choiceTokenElement(column, choice, isConfigured) {
  const isBlank = String(choice).trim() === "";
  const token = element("span", {
    className: isBlank ? "choice-token blank-choice" : "choice-token",
    textContent: isBlank ? "[Blank]" : String(choice)
  });
  applyChoiceStyle(token, column, String(choice), isConfigured);
  return token;
}

function appendSingleChoiceOption(wrapper, column, choice, isConfigured) {
  const option = element("button", {
    className: "choice-option choice-single-option",
    type: "button",
    disabled: column.isFormula,
    role: "option",
    ariaSelected: String(wrapper.valueInput.value === choice)
  }, [
    choiceTokenElement(column, choice, isConfigured)
  ]);
  option.dataset.value = choice;
  option.dataset.configured = String(isConfigured);
  if (!column.isFormula) {
    option.addEventListener("click", () => {
      wrapper.valueInput.value = choice;
      updateChoiceDisplay(wrapper, column, choice);
      for (const item of wrapper.choiceMenu.querySelectorAll(".choice-single-option")) {
        item.setAttribute("aria-selected", String(item.dataset.value === choice));
      }
      wrapper.classList.remove("open");
      wrapper.choiceDisplay.setAttribute("aria-expanded", "false");
      wrapper.choiceDisplay.focus();
      saveFromControl(column, wrapper);
    });
  }
  wrapper.choiceMenu.appendChild(option);
}

function createChoice(column, id, value) {
  const current = value == null ? "" : String(value);
  const configured = new Set(configuredChoices(column));
  const hidden = element("input", {
    type: "hidden",
    value: current,
    disabled: column.isFormula
  });
  const display = element("button", {
    id,
    className: "choice-display",
    type: "button",
    disabled: column.isFormula,
    ariaLabel: column.label,
    ariaExpanded: "false",
    ariaHaspopup: "listbox"
  });
  const menu = element("div", {
    className: "choice-menu",
    role: "listbox"
  });
  const wrapper = element("div", {
    className: column.isFormula
      ? "field_clip control choice-control disabled"
      : "field_clip control choice-control"
  }, [hidden, display, menu]);
  wrapper.valueInput = hidden;
  wrapper.choiceDisplay = display;
  wrapper.choiceMenu = menu;
  appendSingleChoiceOption(wrapper, column, "", true);
  for (const choice of choiceValues(column, current)) {
    appendSingleChoiceOption(wrapper, column, choice, configured.has(choice));
  }
  updateChoiceDisplay(wrapper, column, value);
  if (!column.isFormula) {
    display.addEventListener("click", event => {
      event.stopPropagation();
      const open = wrapper.classList.toggle("open");
      display.setAttribute("aria-expanded", String(open));
    });
    wrapper.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        wrapper.classList.remove("open");
        display.setAttribute("aria-expanded", "false");
        display.focus();
      }
    });
  }
  return wrapper;
}

function updateChoiceDisplay(wrapper, column, value) {
  const choice = value == null ? "" : String(value);
  const configured = new Set(configuredChoices(column));
  wrapper.choiceDisplay.replaceChildren();
  if (choice) {
    wrapper.choiceDisplay.appendChild(
      choiceTokenElement(column, choice, configured.has(choice))
    );
  }
}

function appendChoiceMenuOption(wrapper, column, choice, checked, isConfigured) {
  const checkbox = element("input", {
    type: "checkbox",
    value: choice,
    checked,
    disabled: column.isFormula,
    ariaLabel: choice
  });
  const option = element("label", { className: "choice-option" }, [
    checkbox,
    choiceTokenElement(column, choice, isConfigured)
  ]);
  option.dataset.configured = String(isConfigured);

  if (!column.isFormula) {
    checkbox.addEventListener("change", () => {
      rebuildChoiceListDisplay(wrapper, column);
      saveFromControl(column, wrapper);
    });
  }
  wrapper.choiceMenu.appendChild(option);
}

function rebuildChoiceListDisplay(wrapper, column) {
  const configured = new Set(configuredChoices(column));
  const selected = Array.from(
    wrapper.querySelectorAll(".choice-menu input:checked"),
    checkbox => checkbox.value
  );
  wrapper.choiceDisplay.replaceChildren();
  for (const choice of selected) {
    wrapper.choiceDisplay.appendChild(
      choiceTokenElement(column, choice, configured.has(choice))
    );
  }
}

function createChoiceList(column, id, value) {
  const selected = new Set(normalizeChoiceList(value));
  const configured = new Set(configuredChoices(column));
  const wrapper = element("div", {
    id,
    className: column.isFormula
      ? "field_clip choice-list disabled"
      : "field_clip choice-list",
    role: "group",
    ariaLabel: column.label
  });
  const display = element("button", {
    className: "choice-list-display",
    type: "button",
    disabled: column.isFormula,
    ariaExpanded: "false",
    ariaHaspopup: "listbox"
  });
  const menu = element("div", {
    className: "choice-menu",
    role: "listbox",
    ariaMultiselectable: "true"
  });
  wrapper.choiceDisplay = display;
  wrapper.choiceMenu = menu;
  wrapper.append(display, menu);
  const choices = choiceValues(column, value);

  if (!choices.length) {
    menu.appendChild(element("span", {
      className: "empty-choice-list",
      textContent: "No choices configured"
    }));
  }
  for (const choice of choices) {
    appendChoiceMenuOption(wrapper, column, choice, selected.has(choice), configured.has(choice));
  }
  rebuildChoiceListDisplay(wrapper, column);
  if (!column.isFormula) {
    display.addEventListener("click", event => {
      event.stopPropagation();
      const open = wrapper.classList.toggle("open");
      display.setAttribute("aria-expanded", String(open));
    });
    wrapper.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        wrapper.classList.remove("open");
        display.setAttribute("aria-expanded", "false");
        display.focus();
      }
    });
  }
  return wrapper;
}

function resizeTextArea(control) {
  control.style.height = "auto";
  const borderHeight = control.offsetHeight - control.clientHeight;
  control.style.height = `${control.scrollHeight + borderHeight}px`;
}

function resizeTextControls() {
  for (const { control, column } of state.controls.values()) {
    if (column.baseType === "Text") {
      resizeTextArea(controlInput(control));
    }
  }
}

function bindTextLike(control, column) {
  if (control.tagName === "TEXTAREA") {
    control.addEventListener("input", () => resizeTextArea(control));
  }
  if (column.isFormula) {
    return;
  }
  control.addEventListener("input", () => scheduleSave(column, control));
  control.addEventListener("change", () => saveFromControl(column, control));
  control.addEventListener("blur", () => saveFromControl(column, control));
}

function bindNumericControl(control, column) {
  if (column.isFormula) {
    return;
  }
  control.addEventListener("focus", () => {
    const currentValue = state.record?.[column.colId];
    control.value = numericEditValue(currentValue);
    control.dataset.editing = "true";
    control.select();
  });
  control.addEventListener("input", () => scheduleSave(column, control));
  control.addEventListener("change", () => saveFromControl(column, control));
  control.addEventListener("blur", () => {
    const result = saveFromControl(column, control);
    if (result.ok) {
      control.value = formatNumber(result.value, column);
      control.dataset.editing = "false";
    }
  });
}

function bindImmediate(control, column) {
  if (!column.isFormula) {
    control.addEventListener("change", () => saveFromControl(column, control));
  }
}

function bindDateControl(control, column) {
  if (column.isFormula) {
    return;
  }
  control.addEventListener("change", () => saveFromControl(column, control));
  void attachDatePicker(control, column).catch(error => {
    console.error(`Could not initialize the calendar for ${column.colId}`, error);
    setStatus(`Could not initialize the calendar for ${column.label}.`, true);
  });
}

function createDateTimeControl(column, id, value) {
  const timezone = dateTimeZone(column);
  const dateInput = element("input", {
    id,
    className: "datetime-date",
    type: "text",
    inputMode: /MMM|ddd|dd/.test(fullDateFormat(column)) ? "text" : "numeric",
    autoComplete: "off",
    spellcheck: false,
    disabled: column.isFormula,
    ariaLabel: `${column.label} date`,
    placeholder: datePlaceholder(fullDateFormat(column)),
    value: dateTimeParts(value, column).date
  });
  const timeInput = element("input", {
    className: "datetime-time",
    type: "text",
    inputMode: "text",
    autoComplete: "off",
    spellcheck: false,
    disabled: column.isFormula,
    ariaLabel: `${column.label} time`,
    placeholder: moment.tz("0", "H", timezone).format(timeFormat(column)),
    value: dateTimeParts(value, column).time
  });
  const wrapper = element("div", {
    className: "field_clip control datetime-control",
    ariaLabel: column.label
  }, [
    dateInput,
    timeInput
  ]);
  wrapper.valueInput = dateInput;
  wrapper.dateInput = dateInput;
  wrapper.timeInput = timeInput;

  if (!column.isFormula) {
    dateInput.addEventListener("change", () => saveFromControl(column, wrapper));
    timeInput.addEventListener("change", () => saveFromControl(column, wrapper));
    timeInput.addEventListener("blur", () => saveFromControl(column, wrapper));
    void attachDatePicker(dateInput, column, wrapper).catch(error => {
      console.error(`Could not initialize the calendar for ${column.colId}`, error);
      setStatus(`Could not initialize the calendar for ${column.label}.`, true);
    });
  }
  return wrapper;
}

function renderCard(record, fields) {
  destroyDatePickers();
  state.controls.clear();
  const card = element("form", {
    className: "card detail_theme_record_form detailview_record_single",
    ariaLabel: "Dynamic card"
  });
  card.addEventListener("submit", event => event.preventDefault());

  for (const column of fields) {
    const { id, control } = createControl(column, record[column.colId]);
    const value = element("div", {
      className: column.isFormula
        ? "field-value g_record_detail_value formula-field formula_field"
        : "field-value g_record_detail_value"
    });
    if (column.isFormula) {
      value.appendChild(element("span", {
        className: "formula-indicator field-icon",
        role: "img",
        ariaLabel: "Formula field",
        title: "Formula field"
      }));
    }
    value.appendChild(control);
    card.appendChild(element("div", {
      className: "field g_record_detail_el detail_theme_field_form"
    }, [
      makeLabel(column, id),
      value
    ]));
  }
  card.appendChild(element("div", {
    id: "status",
    className: "status",
    role: "status",
    ariaLive: "polite"
  }));
  app.replaceChildren(card);
  resizeTextControls();
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
      const numeric = parseLocalizedNumber(input.value, column);
      if (numeric === null ||
          (column.baseType === "Int" && !Number.isInteger(numeric))) {
        throw new Error(
          `${column.label} must be ${column.baseType === "Int" ? "an integer" : "a number"}.`
        );
      }
      return numeric;
    }
    case "Bool":
      return input.checked;
    case "Date":
      return input.value
        ? parseDateInput(input.value, column)
        : null;
    case "DateTime":
      return parseDateTimeControl(control, column);
    case "Choice":
      return input.value;
    case "ChoiceList": {
      const choices = Array.from(
        control.querySelectorAll("input:checked"),
        checkbox => checkbox.value
      );
      return choices.length ? ["L", ...choices] : null;
    }
    default:
      return null;
  }
}

function validTimestamp(value, column) {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${column.label} must contain a valid date` +
      `${column.baseType === "DateTime" ? " and time" : ""}.`
    );
  }
  return value;
}

function clearScheduledSave(columnId) {
  const scheduled = state.timers.get(columnId);
  if (scheduled) {
    window.clearTimeout(scheduled.timeout);
    state.timers.delete(columnId);
  }
}

function scheduleSave(column, control) {
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

  const rowId = state.record?.id;
  const timeout = window.setTimeout(() => {
    state.timers.delete(column.colId);
    void saveValue(rowId, column, value);
  }, AUTOSAVE_DELAY_MS);

  state.timers.set(column.colId, { timeout, rowId, column, value });
  setStatus("Unsaved changes…");
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
    return { ok: false };
  }
  void saveValue(state.record?.id, column, value);
  return { ok: true, value };
}

function saveKey(rowId, columnId) {
  return `${String(rowId)}\u0000${columnId}`;
}

function hasPendingSave(rowId, columnId) {
  return state.saveChains.has(saveKey(rowId, columnId));
}

function decodedSavedValue(column, value) {
  return column.baseType === "ChoiceList" ? normalizeChoiceList(value) : value;
}

function valuesEqual(column, currentValue, nextValue) {
  if (column.baseType === "ChoiceList") {
    return JSON.stringify(normalizeChoiceList(currentValue)) ===
      JSON.stringify(normalizeChoiceList(nextValue));
  }
  return Object.is(currentValue, nextValue);
}

function saveValue(rowId, column, value) {
  if (column.isFormula || rowId == null || rowId === "new") {
    return Promise.resolve();
  }

  const key = saveKey(rowId, column.colId);
  if (state.lastQueuedValues.has(key) &&
      valuesEqual(column, state.lastQueuedValues.get(key), value)) {
    return state.saveChains.get(key) || Promise.resolve();
  }
  if (!state.saveChains.has(key) && state.record?.id === rowId &&
      valuesEqual(column, state.record[column.colId], value)) {
    setStatus("Saved");
    return Promise.resolve();
  }

  state.lastQueuedValues.set(key, value);
  const previous = state.saveChains.get(key) || Promise.resolve();
  const save = previous.then(async () => {
    if (state.record?.id === rowId) {
      setStatus("Saving…");
    }

    try {
      await grist.selectedTable.update({
        id: rowId,
        fields: { [column.colId]: value }
      });

      const savedValue = decodedSavedValue(column, value);
      if (state.record?.id === rowId) {
        state.record[column.colId] = savedValue;
        setStatus("Saved");
      }
      if (state.fullRecordCache?.rowId === rowId) {
        state.fullRecordCache.record[column.colId] = savedValue;
        state.fullRecordCache.fetchedAt = Date.now();
      }
    } catch (error) {
      console.error(`Could not save ${column.colId}`, error);
      if (state.record?.id === rowId) {
        setStatus(`Could not save ${column.label}: ${error.message || error}`, true);
      }
    }
  });

  state.saveChains.set(key, save);
  void save.finally(() => {
    if (state.saveChains.get(key) === save) {
      state.saveChains.delete(key);
      state.lastQueuedValues.delete(key);
    }
  });
  return save;
}

async function flushPendingSaves(rowId = state.record?.id) {
  const scheduled = Array.from(state.timers.values()).filter(save => save.rowId === rowId);

  for (const save of scheduled) {
    window.clearTimeout(save.timeout);
    state.timers.delete(save.column.colId);
  }

  const newlyQueued = scheduled.map(save =>
    saveValue(save.rowId, save.column, save.value)
  );
  const alreadyQueued = Array.from(state.saveChains.entries())
    .filter(([key]) => key.startsWith(`${String(rowId)}\u0000`))
    .map(([, save]) => save);
  await Promise.allSettled([...alreadyQueued, ...newlyQueued]);
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

function dateInputValue(value, column) {
  const milliseconds = timestampMilliseconds(value);
  if (milliseconds == null) {
    return "";
  }
  ensureDateLibraries();
  return moment.utc(milliseconds).format(fullDateFormat(column));
}

function dateFormat(column) {
  const format = column?.options?.dateFormat;
  return typeof format === "string" && format ? format : "YYYY-MM-DD";
}

// Adapted from grist-core's DateEditor. A complete format keeps the datepicker unambiguous.
function makeFullMomentFormat(format) {
  let safeFormat = format;
  if (!safeFormat.includes("Y")) {
    safeFormat += " YYYY";
  }
  if (!safeFormat.includes("D") || !safeFormat.includes("M")) {
    safeFormat = "YYYY-MM-DD";
  }
  return safeFormat;
}

function fullDateFormat(column) {
  return makeFullMomentFormat(dateFormat(column));
}

function ensureDateLibraries() {
  if (typeof moment !== "function" || typeof moment.tz !== "function" ||
      typeof $ !== "function" || typeof $.fn.datepicker !== "function") {
    throw new Error("The date picker libraries could not be loaded.");
  }
  const requestedLocale = state.docSettings.locale || navigator.language || "en";
  moment.locale([requestedLocale, requestedLocale.split("-")[0], "en"]);
  const maxTwoDigitYear = new Date().getFullYear() + TWO_DIGIT_YEAR_THRESHOLD - 2000;
  moment.parseTwoDigitYear = yearString => {
    const year = Number.parseInt(yearString, 10);
    return year + (year > maxTwoDigitYear ? 1900 : 2000);
  };
}

function datePlaceholder(format) {
  ensureDateLibraries();
  return moment().format(format);
}

function parseDateInput(value, column) {
  ensureDateLibraries();
  const format = fullDateFormat(column);
  const parsed = moment.utc(value, format, true);
  if (!parsed.isValid()) {
    throw new Error(`${column.label} must use the date format ${format}.`);
  }
  return parsed.valueOf() / 1000;
}

function currentDateLocale() {
  const requested = state.docSettings.locale || navigator.language || "en";
  const shortLocale = requested.split("-")[0];
  if (AVAILABLE_DATEPICKER_LOCALES.has(requested)) {
    return requested;
  }
  if (AVAILABLE_DATEPICKER_LOCALES.has(shortLocale)) {
    return shortLocale;
  }
  return "en";
}

function loadDatePickerLocale(locale) {
  if (locale === "en") {
    return Promise.resolve(locale);
  }
  if (datepickerLocalePromises.has(locale)) {
    return datepickerLocalePromises.get(locale);
  }

  const promise = new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/bootstrap-datepicker@1.9.0/dist/locales/" +
      `bootstrap-datepicker.${locale}.min.js`;
    script.onload = () => resolve(locale);
    script.onerror = () => {
      console.warn(`Could not load the ${locale} datepicker locale; using English.`);
      resolve("en");
    };
    document.head.appendChild(script);
  });
  datepickerLocalePromises.set(locale, promise);
  return promise;
}

async function attachDatePicker(control, column, saveControl = control) {
  ensureDateLibraries();
  const format = fullDateFormat(column);
  const locale = await loadDatePickerLocale(currentDateLocale());
  if (!control.isConnected) {
    return;
  }

  moment.locale(locale);
  const datePickerWidget = $(control).datepicker({
    keyboardNavigation: false,
    forceParse: false,
    todayHighlight: true,
    todayBtn: "linked",
    assumeNearbyYear: TWO_DIGIT_YEAR_THRESHOLD,
    language: locale,
    format: {
      toDisplay: date => moment.utc(date).format(format),
      toValue: date => {
        try {
          return new Date(parseDateInput(date, column) * 1000);
        } catch (error) {
          return null;
        }
      }
    }
  });
  control.datePickerWidget = datePickerWidget;
  state.datePickers.add(control);
  const showDatePicker = () => datePickerWidget.datepicker("show");
  control.addEventListener("focus", showDatePicker);
  control.addEventListener("click", showDatePicker);
  datePickerWidget.on("changeDate", () => saveFromControl(column, saveControl));
  datePickerWidget.on("show", () => {
    const datepickerElement = document.querySelector(".datepicker");
    if (datepickerElement) {
      datepickerElement.tabIndex = 0;
      datepickerElement.classList.add("clipboard_allow_focus");
    }
  });
  if (document.activeElement === control) {
    showDatePicker();
  }
}

function destroyDatePickers() {
  for (const control of state.datePickers) {
    control.datePickerWidget?.datepicker("destroy");
    control.datePickerWidget = null;
  }
  state.datePickers.clear();
}

function dateTimeZone(column) {
  return String(column.type).startsWith("DateTime:")
    ? String(column.type).slice("DateTime:".length) || "UTC"
    : state.docSettings.timezone || "UTC";
}

function timeFormat(column) {
  return column.options.timeFormat === undefined ? "h:mma" : column.options.timeFormat;
}

function dateTimeParts(value, column) {
  const milliseconds = timestampMilliseconds(value);
  if (milliseconds == null) {
    return { date: "", time: "" };
  }
  const valueMoment = moment.tz(milliseconds, dateTimeZone(column));
  return {
    date: valueMoment.format(fullDateFormat(column)),
    time: valueMoment.format(timeFormat(column))
  };
}

function parseDateTimeControl(control, column) {
  const date = control.dateInput.value;
  const time = control.timeInput.value;
  const configuredTimeFormat = timeFormat(column);
  if (!date && !time) {
    return null;
  }
  if (!date || (configuredTimeFormat && !time)) {
    throw new Error(`${column.label} must contain both a date and a time.`);
  }
  const format = `${fullDateFormat(column)} ${configuredTimeFormat}`.trim();
  const text = `${date} ${time}`.trim();
  const parsed = moment.tz(text, format, true, dateTimeZone(column));
  if (!parsed.isValid()) {
    throw new Error(`${column.label} must use the format ${format}.`);
  }
  return validTimestamp(parsed.valueOf() / 1000, column);
}

function reconcileChoice(control, column, value) {
  const input = controlInput(control);
  const nextValue = value == null ? "" : String(value);

  for (const option of control.choiceMenu.querySelectorAll(".choice-single-option")) {
    if (option.dataset.configured === "false" && option.dataset.value !== nextValue) {
      option.remove();
    }
  }
  if (nextValue && !Array.from(control.choiceMenu.querySelectorAll(".choice-single-option"))
    .some(option => option.dataset.value === nextValue)) {
    appendSingleChoiceOption(control, column, nextValue, false);
  }
  input.value = nextValue;
  for (const option of control.choiceMenu.querySelectorAll(".choice-single-option")) {
    option.setAttribute("aria-selected", String(option.dataset.value === nextValue));
  }
  updateChoiceDisplay(control, column, nextValue);
}

function reconcileChoiceList(control, column, value) {
  const selected = new Set(normalizeChoiceList(value));

  for (const option of Array.from(control.querySelectorAll(".choice-option"))) {
    const checkbox = option.querySelector("input");
    if (option.dataset.configured === "false" && !selected.has(checkbox.value)) {
      option.remove();
    }
  }
  const existing = new Set(
    Array.from(control.querySelectorAll(".choice-option input"), checkbox => checkbox.value)
  );
  const configured = new Set(configuredChoices(column));
  for (const choice of selected) {
    if (!existing.has(choice)) {
      appendChoiceMenuOption(control, column, choice, true, configured.has(choice));
    }
  }
  for (const checkbox of control.querySelectorAll(".choice-option input")) {
    checkbox.checked = selected.has(checkbox.value);
  }

  const emptyMessage = control.choiceMenu.querySelector(".empty-choice-list");
  if (emptyMessage && control.querySelector(".choice-option")) {
    emptyMessage.remove();
  } else if (!emptyMessage && !control.querySelector(".choice-option")) {
    control.choiceMenu.appendChild(element("span", {
      className: "empty-choice-list",
      textContent: "No choices configured"
    }));
  }
  rebuildChoiceListDisplay(control, column);
}

function reconcileControls(record) {
  for (const [columnId, { control, column }] of state.controls) {
    if (state.timers.has(columnId) || hasPendingSave(record.id, columnId)) {
      continue;
    }

    const input = controlInput(control);
    if (input === document.activeElement || control.contains(document.activeElement)) {
      continue;
    }

    const value = record[columnId];
    switch (column.baseType) {
      case "Text":
        input.value = value == null ? "" : String(value);
        resizeTextArea(input);
        break;
      case "Numeric":
      case "Int":
        input.value = formatNumber(value, column);
        break;
      case "Bool":
        input.checked = Boolean(value);
        break;
      case "Date":
        input.value = dateInputValue(value, column);
        control.datePickerWidget?.datepicker("update", input.value);
        break;
      case "DateTime":
        {
          const parts = dateTimeParts(value, column);
          control.dateInput.value = parts.date;
          control.timeInput.value = parts.time;
          control.dateInput.datePickerWidget?.datepicker("update", parts.date);
        }
        break;
      case "Choice":
        reconcileChoice(control, column, value);
        break;
      case "ChoiceList":
        reconcileChoiceList(control, column, value);
        break;
    }
  }
}

async function handleRecord(incomingRecord, mappings) {
  const eventSequence = ++state.eventSequence;
  const mapping = normalizeMapping(mappings?.[FIELDS_MAPPING]);
  const previousRowId = state.record?.id;

  if (previousRowId != null && incomingRecord?.id !== previousRowId) {
    await flushPendingSaves(previousRowId);
  }
  if (eventSequence !== state.eventSequence) {
    return;
  }

  if (!incomingRecord || incomingRecord.id == null || incomingRecord.id === "new") {
    state.record = null;
    state.mapping = mapping;
    showEmptyPanel();
    return;
  }
  if (!mapping) {
    state.record = incomingRecord;
    state.mapping = null;
    showAlert("Map a Choice List column to Fields in the widget configuration.");
    return;
  }

  try {
    const metadata = await fetchMetadata();
    if (eventSequence !== state.eventSequence) {
      return;
    }

    const mappingColumn = metadata.get(mapping);
    if (!mappingColumn) {
      throw new Error(`The mapped Fields column "${mapping}" does not exist in the linked table.`);
    }
    if (baseType(mappingColumn.type) !== "ChoiceList") {
      throw new Error("The column mapped to Fields must be a Grist Choice List.");
    }

    let record = await includeColumns(incomingRecord, [mapping]);
    const fieldIds = parseFieldList(record[mapping]);
    const fields = resolveFields(fieldIds, metadata);
    record = await includeColumns(record, fields.map(field => field.colId));
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

    if (!fields.length) {
      showEmptyPanel();
      state.renderedRecordId = record.id;
      state.definitionKey = definitionKey;
    } else if (canReconcile) {
      reconcileControls(record);
    } else {
      state.renderedRecordId = record.id;
      state.definitionKey = definitionKey;
      renderCard(record, fields);
    }
  } catch (error) {
    state.record = incomingRecord;
    state.mapping = mapping;
    showAlert(error.message || String(error));
  }
}

grist.onRecord((record, mappings) => {
  void handleRecord(record, mappings);
});

grist.onNewRecord(() => {
  const previousRowId = state.record?.id;
  const eventSequence = ++state.eventSequence;

  void flushPendingSaves(previousRowId).finally(() => {
    if (eventSequence !== state.eventSequence) {
      return;
    }
    state.record = null;
    showEmptyPanel();
  });
});

window.addEventListener("resize", resizeTextControls);
document.addEventListener("pointerdown", event => {
  for (const control of document.querySelectorAll(".choice-control.open, .choice-list.open")) {
    if (!control.contains(event.target)) {
      control.classList.remove("open");
      control.choiceDisplay?.setAttribute("aria-expanded", "false");
    }
  }
});

grist.ready({
  requiredAccess: "full",
  columns: [
    {
      name: FIELDS_MAPPING,
      title: "Fields",
      type: "ChoiceList",
      optional: false,
      allowMultiple: false,
      description: "A Choice List containing the column IDs to show in this record's card."
    }
  ]
});
