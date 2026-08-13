"use strict";

/*
 * Browser ports in this file are based on grist-core commit
 * 81682d2dcaf7ad8c1fbd662ee020e0d776df70b6 (Apache-2.0), in particular:
 *   app/common/NumberFormat.ts
 *   app/common/NumberParse.ts
 *   app/common/Styles.ts
 *   app/common/ValueFormatter.ts
 *   app/client/widgets/FieldBuilder.ts
 *   app/client/widgets/NumericEditor.ts
 *   app/client/widgets/UserType.ts
 *
 * Grist's editor classes cannot run in a custom-widget iframe: they depend on
 * the private document model, commands, GrainJS, and Grist's build pipeline.
 * The formatting/parsing behavior is therefore ported below to browser APIs.
 * The currency lookup is embedded from locale-currency 0.0.2 (BSD-2-Clause),
 * the version pinned by this grist-core commit, so startup does not depend on
 * a cross-origin ES-module import.
 */

const AUTOSAVE_DELAY_MS = 350;
const FIELDS_MAPPING = "Fields";
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
const NUMBER_MODES = ["currency", "decimal", "percent", "scientific"];
const FONT_STYLE_CLASSES = Object.freeze({
  fontBold: "font-bold",
  fontItalic: "font-italic",
  fontUnderline: "font-underline",
  fontStrikethrough: "font-strikethrough"
});
const LOCALE_CURRENCIES = Object.freeze({
  AD: "EUR", AE: "AED", AF: "AFN", AG: "XCD", AI: "XCD", AL: "ALL", AM: "AMD",
  AN: "ANG", AO: "AOA", AR: "ARS", AS: "USD", AT: "EUR", AU: "AUD", AW: "AWG",
  AX: "EUR", AZ: "AZN", BA: "BAM", BB: "BBD", BD: "BDT", BE: "EUR", BF: "XOF",
  BG: "BGN", BH: "BHD", BI: "BIF", BJ: "XOF", BL: "EUR", BM: "BMD", BN: "BND",
  BO: "BOB", BQ: "USD", BR: "BRL", BS: "BSD", BT: "BTN", BV: "NOK", BW: "BWP",
  BY: "BYR", BZ: "BZD", CA: "CAD", CC: "AUD", CD: "CDF", CF: "XAF", CG: "XAF",
  CH: "CHF", CI: "XOF", CK: "NZD", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP",
  CR: "CRC", CU: "CUP", CV: "CVE", CW: "ANG", CX: "AUD", CY: "EUR", CZ: "CZK",
  DE: "EUR", DJ: "DJF", DK: "DKK", DM: "XCD", DO: "DOP", DZ: "DZD", EC: "USD",
  EE: "EUR", EG: "EGP", EH: "MAD", ER: "ERN", ES: "EUR", ET: "ETB", FI: "EUR",
  FJ: "FJD", FK: "FKP", FM: "USD", FO: "DKK", FR: "EUR", GA: "XAF", GB: "GBP",
  GD: "XCD", GE: "GEL", GF: "EUR", GG: "GBP", GH: "GHS", GI: "GIP", GL: "DKK",
  GM: "GMD", GN: "GNF", GP: "EUR", GQ: "XAF", GR: "EUR", GS: "GBP", GT: "GTQ",
  GU: "USD", GW: "XOF", GY: "GYD", HK: "HKD", HM: "AUD", HN: "HNL", HR: "HRK",
  HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IM: "GBP", IN: "INR",
  IO: "USD", IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JE: "GBP", JM: "JMD",
  JO: "JOD", JP: "JPY", KE: "KES", KG: "KGS", KH: "KHR", KI: "AUD", KM: "KMF",
  KN: "XCD", KP: "KPW", KR: "KRW", KW: "KWD", KY: "KYD", KZ: "KZT", LA: "LAK",
  LB: "LBP", LC: "XCD", LI: "CHF", LK: "LKR", LR: "LRD", LS: "LSL", LT: "LTL",
  LU: "EUR", LV: "LVL", LY: "LYD", MA: "MAD", MC: "EUR", MD: "MDL", ME: "EUR",
  MF: "EUR", MG: "MGA", MH: "USD", MK: "MKD", ML: "XOF", MM: "MMK", MN: "MNT",
  MO: "MOP", MP: "USD", MQ: "EUR", MR: "MRO", MS: "XCD", MT: "EUR", MU: "MUR",
  MV: "MVR", MW: "MWK", MX: "MXN", MY: "MYR", MZ: "MZN", NA: "NAD", NC: "XPF",
  NE: "XOF", NF: "AUD", NG: "NGN", NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR",
  NR: "AUD", NU: "NZD", NZ: "NZD", OM: "OMR", PA: "PAB", PE: "PEN", PF: "XPF",
  PG: "PGK", PH: "PHP", PK: "PKR", PL: "PLN", PM: "EUR", PN: "NZD", PR: "USD",
  PS: "ILS", PT: "EUR", PW: "USD", PY: "PYG", QA: "QAR", RE: "EUR", RO: "RON",
  RS: "RSD", RU: "RUB", RW: "RWF", SA: "SAR", SB: "SBD", SC: "SCR", SD: "SDG",
  SE: "SEK", SG: "SGD", SH: "SHP", SI: "EUR", SJ: "NOK", SK: "EUR", SL: "SLL",
  SM: "EUR", SN: "XOF", SO: "SOS", SR: "SRD", ST: "STD", SV: "SVC", SX: "ANG",
  SY: "SYP", SZ: "SZL", TC: "USD", TD: "XAF", TF: "EUR", TG: "XOF", TH: "THB",
  TJ: "TJS", TK: "NZD", TL: "USD", TM: "TMT", TN: "TND", TO: "TOP", TR: "TRY",
  TT: "TTD", TV: "AUD", TW: "TWD", TZ: "TZS", UA: "UAH", UG: "UGX", UM: "USD",
  US: "USD", UY: "UYU", UZ: "UZS", VA: "EUR", VC: "XCD", VE: "VEF", VG: "USD",
  VI: "USD", VN: "VND", VU: "VUV", WF: "XPF", WS: "WST", YE: "YER", YT: "EUR",
  ZA: "ZAR", ZM: "ZMK", ZW: "ZWL"
});

const app = document.getElementById("app");
const state = {
  record: null,
  mapping: null,
  tableId: null,
  metadata: new Map(),
  docSettings: {
    locale: navigator.language || "en-US",
    currency: undefined,
    timezone: "UTC"
  },
  renderedRecordId: null,
  definitionKey: "",
  controls: new Map(),
  timers: new Map(),
  saveChains: new Map(),
  lastQueuedValues: new Map(),
  fullRecordCache: null,
  activeSaves: 0,
  eventSequence: 0
};

function element(tagName, properties = {}, children = []) {
  const node = document.createElement(tagName);

  for (const [name, value] of Object.entries(properties)) {
    if (value === undefined || value === null) {
      continue;
    }
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
  state.controls.clear();
  state.renderedRecordId = null;
  state.definitionKey = "";
}

function showEmptyPanel() {
  clearRenderedState();
  app.replaceChildren(element("div", {
    className: "card detail_theme_record_form detailview_record_single",
    ariaLabel: "Dynamic card"
  }));
}

function showAlert(message) {
  clearRenderedState();
  const titleId = "dyncard-alert-title";
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
      textContent: "Dyncard configuration error"
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

function parseFieldList(value) {
  if (value == null || value === "") {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("The mapped Fields column must be a Grist Choice List of column IDs.");
  }

  const fieldIds = value.map((fieldId, index) => {
    if (typeof fieldId !== "string" || fieldId.length === 0) {
      throw new Error(`Item ${index + 1} in Fields must be a non-empty column ID.`);
    }
    return fieldId;
  });
  const duplicate = fieldIds.find((fieldId, index) => fieldIds.indexOf(fieldId) !== index);
  if (duplicate) {
    throw new Error(`Fields contains the duplicate column ID "${duplicate}".`);
  }
  return fieldIds;
}

function baseType(type) {
  return String(type || "").split(":", 1)[0];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Port of grist-core/app/common/NumberFormat.ts.
const currencyDisplay = (() => {
  try {
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol"
    });
    return "narrowSymbol";
  } catch (error) {
    return "symbol";
  }
})();

function getLocaleCurrency(locale) {
  let parts = String(locale || "").split("_");
  if (parts.length !== 2) {
    parts = String(locale || "").split("-");
  }
  const region = parts.length === 2 ? parts[1] : String(locale || "");
  return LOCALE_CURRENCIES[region.toUpperCase()] || null;
}

function documentCurrency(options = {}) {
  return options.currency || state.docSettings.currency ||
    getLocaleCurrency(state.docSettings.locale || "en-US") || "USD";
}

function parseNumMode(numMode, currency) {
  switch (numMode) {
    case "currency":
      return { style: "currency", currency, currencyDisplay };
    case "decimal":
      return { useGrouping: true };
    case "percent":
      return { style: "percent" };
    case "scientific":
      return { notation: "scientific" };
    default:
      return { useGrouping: false };
  }
}

function numberOptions(column) {
  return column.baseType === "Int"
    ? { decimals: 0, ...column.options }
    : column.options;
}

function buildNumberFormat(column) {
  const options = numberOptions(column);
  const intlOptions = parseNumMode(options.numMode, documentCurrency(options));

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
  return new Intl.NumberFormat(state.docSettings.locale, intlOptions);
}

function formatNumber(value, column) {
  if (value == null || value === "") {
    return "";
  }
  const formatter = buildNumberFormat(column);
  if (column.options.numSign !== "parens") {
    return formatter.format(value);
  }
  return value >= 0 ? ` ${formatter.format(value)} ` : `(${formatter.format(-value)})`;
}

// Port of grist-core/app/client/widgets/NumericEditor.ts.
function numericEditValue(value) {
  if (value == null || value === "") {
    return "";
  }
  return new Intl.NumberFormat(state.docSettings.locale, {
    useGrouping: false,
    maximumFractionDigits: 20
  }).format(value);
}

function getDigitsMap(locale) {
  const formatter = new Intl.NumberFormat(locale);
  const result = new Map();
  for (let index = 0; index < 10; index += 1) {
    const digit = String(index);
    const localeDigit = formatter.format(index);
    if (localeDigit !== digit) {
      result.set(localeDigit, digit);
    }
  }
  return result;
}

// Port of grist-core/app/common/NumberParse.ts. Parsing remains deliberately
// permissive in the same places as Grist (grouping, standard digits, and signs).
class NumberParse {
  static removeCharsRegex = /[\s\u200e\u200f\u061c]/g;

  constructor(locale, currency) {
    this.locale = locale;
    this.currency = currency;
    const parts = new Map();
    for (const numMode of NUMBER_MODES) {
      const formatter = new Intl.NumberFormat(locale, parseNumMode(numMode, currency));
      parts.set(numMode, formatter.formatToParts(-1234567.5678));
    }
    const getPart = (partType, numMode = "decimal") =>
      parts.get(numMode).find(part => part.type === partType)?.value || "";

    this.currencySymbol = getPart("currency", "currency");
    this.percentageSymbol = getPart("percentSign", "percent");
    this.exponentSeparator = getPart("exponentSeparator", "scientific");
    this.minusSign = getPart("minusSign");
    this.decimalSeparator = getPart("decimal");
    this.digitGroupSeparator = getPart("group");
    this.digitGroupSeparatorCurrency = getPart("group", "currency");
    const currencyParts = parts.get("currency");
    this.currencyEndsInMinusSign = currencyParts[currencyParts.length - 1]?.type === "minusSign";
    this.digitsMap = getDigitsMap(locale);

    this.exponentSeparatorRegex = new RegExp(escapeRegExp(this.exponentSeparator), "i");
    const groupCharacters = escapeRegExp(
      this.digitGroupSeparator + this.digitGroupSeparatorCurrency
    );
    this.digitGroupSeparatorRegex = groupCharacters
      ? new RegExp(`[${groupCharacters}](\\d\\d)`, "g")
      : /$a/;
    if (this.digitsMap.size === 0) {
      this.replaceDigits = value => value;
    } else {
      const digitsRegex = new RegExp([...this.digitsMap.keys()].join("|"), "g");
      this.replaceDigits = value => value.replace(
        digitsRegex,
        digit => this.digitsMap.get(digit) || digit
      );
    }
  }

  parse(input) {
    let [value, isCurrency] = removeSymbol(String(input), this.currencySymbol);
    let isPercent;
    [value, isPercent] = removeSymbol(value, this.percentageSymbol);
    value = value.replace(NumberParse.removeCharsRegex, "");

    const isParenthesized = value.startsWith("(") && value.endsWith(")");
    if (isParenthesized) {
      value = value.slice(1, -1);
    }
    if (value === "") {
      return null;
    }

    value = value.replace(this.exponentSeparatorRegex, "e");
    value = this.replaceDigits(value);
    value = value.replace(this.digitGroupSeparatorRegex, "$1");
    value = value.replace(this.decimalSeparator, ".");
    value = value.replace(this.minusSign, "-");
    value = value.replace(this.minusSign, "-");
    if (isCurrency && this.currencyEndsInMinusSign && value.endsWith("-")) {
      value = `-${value.slice(0, -1)}`;
    }

    let result = Number(value);
    if (Number.isNaN(result)) {
      return null;
    }
    if (isParenthesized) {
      if (result <= 0) {
        return null;
      }
      result = -result;
    }
    if (isPercent) {
      result *= 0.01;
    }
    return result;
  }
}

function removeSymbol(value, symbol) {
  const removed = value.replace(symbol, "");
  return [removed, removed.length < value.length];
}

function numberParser(column) {
  return new NumberParse(
    state.docSettings.locale,
    documentCurrency(numberOptions(column))
  );
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

  const documentSettings = parseWidgetOptions(docInfo.documentSettings?.[0]);
  state.docSettings = {
    locale: documentSettings.locale || navigator.language || "en-US",
    currency: documentSettings.currency,
    timezone: docInfo.timezone?.[0] || "UTC"
  };

  const tableRef = tables.id[tableIndex];
  const metadata = new Map();
  const columnRecords = [];
  const columnIdsByRef = new Map();
  for (let index = 0; index < columns.id.length; index += 1) {
    if (columns.parentId[index] !== tableRef) {
      continue;
    }
    const colId = columns.colId[index];
    const record = {
      colId,
      label: columns.label?.[index] || colId,
      description: columns.description?.[index] || "",
      type: columns.type?.[index] || "",
      isFormula: Boolean(columns.isFormula?.[index]),
      options: parseWidgetOptions(columns.widgetOptions?.[index]),
      ruleRefs: decodeCellValue(columns.rules?.[index])
    };
    columnRecords.push(record);
    columnIdsByRef.set(String(columns.id[index]), colId);
  }
  for (const record of columnRecords) {
    const ruleRefs = Array.isArray(record.ruleRefs) ? record.ruleRefs : [];
    metadata.set(record.colId, {
      ...record,
      ruleColumnIds: ruleRefs
        .map(ruleRef => columnIdsByRef.get(String(ruleRef)))
        .filter(Boolean)
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
      throw new Error(
        `Field "${fieldId}" does not exist in the linked table. Use column IDs, not labels.`
      );
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

function decodeCellValue(value) {
  if (Array.isArray(value) && value[0] === "L") {
    return value.slice(1);
  }
  if (Array.isArray(value) && typeof grist.decodeObject === "function") {
    try {
      return grist.decodeObject(value);
    } catch (error) {
      return value;
    }
  }
  return value;
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
      record[columnId] = decodeCellValue(values[rowIndex]);
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
      "The following fields are unavailable under the current access rules: " +
      `${unavailable.map(columnId => `"${columnId}"`).join(", ")}.`
    );
  }
  return { ...fullRecord, ...record };
}

function normalizeChoiceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String);
}

function configuredChoices(column) {
  return Array.isArray(column.options.choices)
    ? column.options.choices.map(String)
    : [];
}

function allChoiceValues(column, value) {
  const current = column.baseType === "ChoiceList"
    ? normalizeChoiceList(value)
    : value == null || value === "" ? [] : [String(value)];
  return [...new Set([...configuredChoices(column), ...current])];
}

function columnAlignment(column) {
  const configured = column.options.alignment;
  return ["left", "center", "right"].includes(configured)
    ? configured
    : DEFAULT_ALIGNMENTS[column.baseType];
}

function applyAlignment(control, column) {
  const alignment = columnAlignment(column);
  control.dataset.alignment = alignment;
  if (column.baseType === "Bool" || column.baseType === "ChoiceList") {
    control.style.justifyContent = alignment === "right" ? "flex-end" : alignment;
  } else {
    control.style.textAlign = alignment;
  }
}

// Browser port of grist-core/app/common/Styles.ts CombinedStyle.
function combinedRuleStyle(column, record) {
  const ruleColumnIds = column.ruleColumnIds || [];
  if (!ruleColumnIds.length) {
    return { style: {}, error: false };
  }

  const flags = ruleColumnIds.map(columnId => record[columnId]);
  if (flags.some(value => value !== null && typeof value !== "boolean")) {
    return { style: {}, error: true };
  }

  const rules = Array.isArray(column.options.rulesOptions)
    ? column.options.rulesOptions
    : [];
  if (rules.length < flags.length) {
    return { style: {}, error: false };
  }

  const style = {};
  for (let index = 0; index < rules.length; index += 1) {
    if (!flags[index]) {
      continue;
    }
    for (const optionName of [
      "textColor",
      "fillColor",
      "fontBold",
      "fontUnderline",
      "fontItalic",
      "fontStrikethrough"
    ]) {
      const option = rules[index]?.[optionName];
      style[optionName] = option || style[optionName];
    }
  }
  return { style, error: false };
}

// Browser port of FieldBuilder's opaque-fill normalization.
function notTransparent(color) {
  if (!color) {
    return color;
  }
  if (color.startsWith("#") && color.length === 9) {
    return color.substring(0, 7);
  }
  if (color.startsWith("rgba")) {
    return color.replace(
      /^rgba\((\d+)[,\s]+(\d+)[,\s]+(\d+)[/,\s]+([\d.%]+)\)$/i,
      "rgb($1, $2, $3)"
    );
  }
  return color;
}

function styleColor(value) {
  return typeof value === "string" ? value : "";
}

function setStyleVariable(elementNode, name, value) {
  if (value) {
    elementNode.style.setProperty(name, value);
  } else {
    elementNode.style.removeProperty(name);
  }
}

function applyCellStyle(valueElement, control, column, record) {
  const { style: ruleStyle, error } = combinedRuleStyle(column, record);
  setStyleVariable(
    valueElement,
    "--grist-cell-color",
    styleColor(column.options.textColor)
  );
  setStyleVariable(
    valueElement,
    "--grist-cell-background-color",
    notTransparent(styleColor(column.options.fillColor))
  );
  setStyleVariable(
    valueElement,
    "--grist-rule-color",
    styleColor(ruleStyle.textColor)
  );
  setStyleVariable(
    valueElement,
    "--grist-column-rule-background-color",
    notTransparent(styleColor(ruleStyle.fillColor))
  );

  for (const [optionName, className] of Object.entries(FONT_STYLE_CLASSES)) {
    control.classList.toggle(
      className,
      Boolean(ruleStyle[optionName] || column.options[optionName])
    );
  }
  control.classList.toggle("field-error-from-style", error);
}

function inputId(columnId, index) {
  return `dyncard-${index}-${columnId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function makeLabel(column, id) {
  const container = element("div", { className: "g_record_detail_label_container" }, [
    element("label", {
      className: "g_record_detail_label",
      htmlFor: id,
      textContent: column.label
    })
  ]);

  if (column.description) {
    // Native title tooltip by design; no custom tooltip lifecycle or popup.
    container.appendChild(element("span", {
      className: "info",
      title: column.description,
      role: "img",
      tabIndex: 0,
      ariaLabel: column.description
    }, [element("span", { className: "info_toggle_icon", ariaHidden: "true" })]));
  }
  return container;
}

function commonControl(column, id, className = "field_clip control") {
  return {
    id,
    className,
    disabled: column.isFormula,
    ariaLabel: column.label
  };
}

function createControl(column, value, id) {
  let control;
  switch (column.baseType) {
    case "Text":
      control = element("textarea", {
        ...commonControl(column, id),
        rows: 1,
        value: value == null ? "" : String(value),
        spellcheck: true
      });
      bindTypedControl(control, column);
      queueMicrotask(() => resizeTextArea(control));
      break;

    case "Numeric":
    case "Int":
      control = element("input", {
        ...commonControl(column, id),
        type: "text",
        inputMode: column.baseType === "Int" ? "numeric" : "decimal",
        value: formatNumber(value, column),
        autocomplete: "off"
      });
      bindNumericControl(control, column);
      break;

    case "Bool":
      control = createBoolControl(column, value, id);
      break;

    case "Date":
      control = element("input", {
        ...commonControl(column, id, "control"),
        type: "date",
        value: dateInputValue(value)
      });
      bindImmediateControl(control, column);
      break;

    case "DateTime":
      control = element("input", {
        ...commonControl(column, id, "control"),
        type: "datetime-local",
        step: "1",
        value: dateTimeInputValue(value, column)
      });
      bindImmediateControl(control, column);
      break;

    case "Choice":
      control = element("select", commonControl(column, id, "control"));
      rebuildChoice(control, column, value);
      bindImmediateControl(control, column);
      break;

    case "ChoiceList":
      control = element("div", {
        id,
        className: "control choice-list-control",
        role: "group",
        ariaLabel: column.label,
        ariaDisabled: column.isFormula
      });
      rebuildChoiceList(control, column, value);
      break;
  }
  control.dataset.gristType = column.baseType;
  applyAlignment(control, column);
  return control;
}

function createBoolControl(column, value, id) {
  const input = element("input", {
    id,
    className: "native-checkbox",
    type: "checkbox",
    checked: Boolean(value),
    disabled: column.isFormula,
    ariaLabel: column.label
  });
  const control = element("div", {
    className: "field_clip control bool-control"
  }, [input]);
  control.valueInput = input;
  input.addEventListener("change", () => saveFromControl(column, control));
  return control;
}

function rebuildChoice(select, column, value) {
  const current = value == null ? "" : String(value);
  const options = [element("option", { value: "", textContent: "" })];
  for (const choice of allChoiceValues(column, value)) {
    options.push(element("option", {
      value: choice,
      textContent: choice,
      selected: choice === current
    }));
  }
  select.replaceChildren(...options);
  select.value = current;
}

function rebuildChoiceList(control, column, value) {
  const selected = new Set(normalizeChoiceList(value));
  const choices = allChoiceValues(column, value);
  const children = [];

  if (!choices.length) {
    children.push(element("span", {
      className: "empty-choice-list",
      textContent: "No choices configured"
    }));
  }
  for (const choice of choices) {
    const checkbox = element("input", {
      className: "native-checkbox",
      type: "checkbox",
      value: choice,
      checked: selected.has(choice),
      disabled: column.isFormula,
      ariaLabel: choice
    });
    checkbox.addEventListener("change", () => saveFromControl(column, control));
    children.push(element("label", { className: "choice-option" }, [
      checkbox,
      element("span", { textContent: choice })
    ]));
  }
  control.replaceChildren(...children);
}

function bindTypedControl(control, column) {
  control.addEventListener("input", () => {
    resizeTextArea(control);
    scheduleSave(column, control);
  });
  control.addEventListener("change", () => saveFromControl(column, control));
  control.addEventListener("blur", () => saveFromControl(column, control));
}

function bindNumericControl(control, column) {
  control.addEventListener("focus", () => {
    const entry = state.controls.get(column.colId);
    if (entry && control.getAttribute("aria-invalid") !== "true") {
      control.value = numericEditValue(entry.rawValue);
      control.select();
    }
  });
  control.addEventListener("input", () => scheduleSave(column, control));
  const commit = () => {
    if (saveFromControl(column, control)) {
      const entry = state.controls.get(column.colId);
      control.value = formatNumber(entry?.rawValue, column);
    }
  };
  control.addEventListener("change", commit);
  control.addEventListener("blur", commit);
}

function bindImmediateControl(control, column) {
  control.addEventListener("change", () => saveFromControl(column, control));
}

function renderCard(record, fields) {
  state.controls.clear();
  const card = element("form", {
    className: "card detail_theme_record_form detailview_record_single",
    ariaLabel: "Dynamic card"
  });
  card.addEventListener("submit", event => event.preventDefault());

  fields.forEach((column, index) => {
    const id = inputId(column.colId, index);
    const control = createControl(column, record[column.colId], id);
    const value = element("div", {
      className: column.isFormula
        ? "g_record_detail_value formula_field"
        : "g_record_detail_value"
    }, column.isFormula
      ? [element("span", { className: "field-icon", ariaHidden: "true" }), control]
      : [control]);
    applyCellStyle(value, control, column, record);
    card.appendChild(element("div", {
      className: "g_record_detail_el detail_theme_field_form"
    }, [makeLabel(column, id), value]));
    state.controls.set(column.colId, {
      column,
      control,
      valueElement: value,
      rawValue: record[column.colId]
    });
  });

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
      if (input.value.trim() === "") {
        return null;
      }
      const numeric = numberParser(column).parse(input.value);
      if (numeric === null || (column.baseType === "Int" && !Number.isInteger(numeric))) {
        throw new Error(
          `${column.label} must be ${column.baseType === "Int" ? "an integer" : "a number"}.`
        );
      }
      return numeric;
    }
    case "Bool":
      return input.checked;
    case "Date":
      if (!input.value) {
        return null;
      }
      return validDateTimestamp(
        moment.utc(input.value, "YYYY-MM-DD", true).valueOf() / 1000,
        column
      );
    case "DateTime": {
      if (!input.value) {
        return null;
      }
      const parsed = moment.tz(
        input.value,
        ["YYYY-MM-DDTHH:mm", "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm:ss.SSS"],
        true,
        dateTimeZone(column)
      );
      return validDateTimestamp(parsed.valueOf() / 1000, column);
    }
    case "Choice":
      return input.value;
    case "ChoiceList": {
      const choices = Array.from(
        control.querySelectorAll("input[type=checkbox]:checked"),
        checkbox => checkbox.value
      );
      return choices.length ? ["L", ...choices] : null;
    }
    default:
      return null;
  }
}

function validDateTimestamp(value, column) {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${column.label} must contain a valid date` +
      `${column.baseType === "DateTime" ? " and time" : ""}.`
    );
  }
  return value;
}

function resizeTextArea(control) {
  if (!control || control.tagName !== "TEXTAREA") {
    return;
  }
  control.style.height = "21px";
  control.style.height = `${Math.max(21, control.scrollHeight)}px`;
}

function resizeTextControls() {
  for (const { column, control } of state.controls.values()) {
    if (column.baseType === "Text") {
      resizeTextArea(control);
    }
  }
}

function scheduleSave(column, control) {
  let value;
  try {
    value = readControl(column, control);
    controlInput(control).setAttribute("aria-invalid", "false");
  } catch (error) {
    clearScheduledSave(column.colId);
    controlInput(control).setAttribute("aria-invalid", "true");
    setStatus(error.message, true);
    return;
  }

  clearScheduledSave(column.colId);
  const rowId = state.record?.id;
  const timeout = window.setTimeout(() => {
    state.timers.delete(column.colId);
    void queueSave(rowId, column, value);
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
    return false;
  }

  const entry = state.controls.get(column.colId);
  if (entry) {
    entry.rawValue = decodedSavedValue(column, value);
  }
  void queueSave(state.record?.id, column, value);
  return true;
}

function saveKey(rowId, columnId) {
  return `${rowId}\u0000${columnId}`;
}

function queueSave(rowId, column, value) {
  if (column.isFormula || rowId == null || rowId === "new") {
    return Promise.resolve();
  }

  const key = saveKey(rowId, column.colId);
  const pending = state.saveChains.get(key);
  if (pending && queuedValuesEqual(column, state.lastQueuedValues.get(key), value)) {
    return pending;
  }
  if (!pending && state.record?.id === rowId &&
      recordValueEquals(column, state.record[column.colId], value)) {
    setStatus("Saved");
    return Promise.resolve();
  }

  const previous = pending || Promise.resolve();
  let chain;
  state.lastQueuedValues.set(key, value);
  setStatus("Saving…");
  chain = previous.catch(() => undefined).then(async () => {
    state.activeSaves += 1;
    try {
      await grist.selectedTable.update({
        id: rowId,
        fields: { [column.colId]: value }
      });
      const decoded = decodedSavedValue(column, value);
      if (state.record?.id === rowId) {
        state.record[column.colId] = decoded;
      }
      if (state.fullRecordCache?.rowId === rowId) {
        state.fullRecordCache.record[column.colId] = decoded;
        state.fullRecordCache.fetchedAt = Date.now();
      }
      if (state.renderedRecordId === rowId) {
        const entry = state.controls.get(column.colId);
        if (entry) {
          entry.rawValue = decoded;
        }
      }
      setStatus("Saved");
    } catch (error) {
      console.error(`Could not save ${column.colId}`, error);
      setStatus(`Could not save ${column.label}: ${error.message || error}`, true);
    } finally {
      state.activeSaves -= 1;
    }
  }).finally(() => {
    if (state.saveChains.get(key) === chain) {
      state.saveChains.delete(key);
      state.lastQueuedValues.delete(key);
    }
  });
  state.saveChains.set(key, chain);
  return chain;
}

async function flushPendingSaves(rowId) {
  if (rowId == null) {
    return;
  }
  const scheduled = Array.from(state.timers.values()).filter(save => save.rowId === rowId);
  for (const save of scheduled) {
    window.clearTimeout(save.timeout);
    state.timers.delete(save.column.colId);
    queueSave(save.rowId, save.column, save.value);
  }
  const prefix = `${rowId}\u0000`;
  const active = Array.from(state.saveChains.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, promise]) => promise);
  await Promise.allSettled(active);
}

function decodedSavedValue(column, value) {
  if (column.baseType === "ChoiceList") {
    return Array.isArray(value) && value[0] === "L" ? value.slice(1).map(String) : [];
  }
  return value;
}

function queuedValuesEqual(column, current, next) {
  if (column.baseType === "ChoiceList") {
    return JSON.stringify(decodedSavedValue(column, current)) ===
      JSON.stringify(decodedSavedValue(column, next));
  }
  return Object.is(current, next);
}

function recordValueEquals(column, current, queued) {
  if (column.baseType === "ChoiceList") {
    return JSON.stringify(normalizeChoiceList(current)) ===
      JSON.stringify(decodedSavedValue(column, queued));
  }
  return Object.is(current, queued);
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

function dateInputValue(value) {
  const milliseconds = timestampMilliseconds(value);
  return milliseconds == null ? "" : moment.utc(milliseconds).format("YYYY-MM-DD");
}

function dateTimeZone(column) {
  if (String(column.type).startsWith("DateTime:")) {
    return String(column.type).slice("DateTime:".length) || "UTC";
  }
  return state.docSettings.timezone || "UTC";
}

function dateTimeInputValue(value, column) {
  const milliseconds = timestampMilliseconds(value);
  return milliseconds == null
    ? ""
    : moment.tz(milliseconds, dateTimeZone(column)).format("YYYY-MM-DDTHH:mm:ss");
}

function hasPendingSave(rowId, columnId) {
  return state.timers.has(columnId) || state.saveChains.has(saveKey(rowId, columnId));
}

function reconcileControls(record) {
  for (const [columnId, entry] of state.controls) {
    const { column, control, valueElement } = entry;
    applyCellStyle(valueElement, control, column, record);
    if (hasPendingSave(record.id, columnId) || control.contains(document.activeElement)) {
      continue;
    }
    const value = record[columnId];
    entry.rawValue = value;
    const input = controlInput(control);
    switch (column.baseType) {
      case "Text":
        input.value = value == null ? "" : String(value);
        resizeTextArea(input);
        break;
      case "Numeric":
      case "Int":
        input.value = formatNumber(value, column);
        input.setAttribute("aria-invalid", "false");
        break;
      case "Bool":
        input.checked = Boolean(value);
        break;
      case "Date":
        input.value = dateInputValue(value);
        break;
      case "DateTime":
        input.value = dateTimeInputValue(value, column);
        break;
      case "Choice":
        rebuildChoice(input, column, value);
        break;
      case "ChoiceList":
        rebuildChoiceList(control, column, value);
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

  // A record notification may be the result of a conditional formula changing.
  // Start it with a fresh full-record snapshot rather than a one-second-old one.
  state.fullRecordCache = null;
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
    record = await includeColumns(record, fields.flatMap(field => [
      field.colId,
      ...field.ruleColumnIds
    ]));
    if (eventSequence !== state.eventSequence) {
      return;
    }

    const definitionKey = JSON.stringify(fields.map(field => [
      field.colId,
      field.label,
      field.description,
      field.type,
      field.isFormula,
      field.options,
      field.ruleColumnIds
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
      renderCard(record, fields);
      state.renderedRecordId = record.id;
      state.definitionKey = definitionKey;
    }
  } catch (error) {
    state.record = incomingRecord;
    state.mapping = mapping;
    showAlert(error.message || String(error));
  }
}

function startWidget() {
  if (typeof grist === "undefined") {
    throw new Error("Grist's Custom Widget API could not be loaded.");
  }

  grist.onRecord((record, mappings) => {
    void handleRecord(record, mappings);
  });

  grist.onNewRecord(mappings => {
    const previousRowId = state.record?.id;
    const eventSequence = ++state.eventSequence;
    void flushPendingSaves(previousRowId).finally(() => {
      if (eventSequence !== state.eventSequence) {
        return;
      }
      state.record = null;
      state.mapping = normalizeMapping(mappings?.[FIELDS_MAPPING]);
      showEmptyPanel();
    });
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
}

window.addEventListener("resize", resizeTextControls);
window.addEventListener("beforeunload", () => {
  void flushPendingSaves(state.record?.id);
});

try {
  startWidget();
} catch (error) {
  console.error("Dyncard could not start", error);
  showAlert(`Dyncard could not start: ${error.message || error}`);
}
