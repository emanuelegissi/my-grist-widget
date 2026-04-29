"use strict";

/*
  Grist column mappings:

  Parent
    Self-reference parent column.
    It may be a Ref column or an Int column.
    onRecords uses expandRefs:false so Ref values arrive as row IDs.

  Label
    Editable text label shown in the tree.

  Columns
    Optional multi-column mapping.
    The user chooses the editable columns to show in the table area.
    Supported simple types: Text, Int, Numeric, Bool.

  Error
    Optional Bool column.
    When true, the whole record row is highlighted with #FD8182.
    It is shown only if the same source column is also selected in "Shown columns".

  Notes:
    - Column labels/descriptions/formula flags are read from Grist metadata tables when available.
    - Formula columns are displayed read-only with a small "=" badge.
    - Column widths are local widget options and are persisted per widget instance.
    - The selected column header is highlighted through selectedCol.
*/

const GRIST_COLUMNS = [
  {
    name: "Parent",
    title: "Parent",
    type: "Ref,Int",
    description: "Self-reference parent column. Empty value means root."
  },
  {
    name: "Label",
    title: "Label",
    type: "Text",
    description: "Editable text label shown in the tree."
  },
  {
    name: "Columns",
    title: "Shown columns",
    type: "Text,Int,Numeric,Bool",
    optional: true,
    allowMultiple: true,
    description: "Additional editable columns shown in the tree table."
  },
  {
    name: "Error",
    title: "Error",
    type: "Bool",
    optional: true,
    description: "Optional boolean column. When true, the row is highlighted as an error."
  }
];

const OPTION_EXPANDED = "expandedRowIds";
const OPTION_WIDTHS = "columnWidths";

const MIN_COLUMN_WIDTH = 35;
const DEFAULT_LABEL_WIDTH = 280;
const DEFAULT_DATA_WIDTH = 100;

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function rowIdOf(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === 0 ||
    value === "0"
  ) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value[0] === "R" || value[0] === "r") {
      return toPositiveInt(value[1]);
    }

    return toPositiveInt(value[0]) || toPositiveInt(value[1]);
  }

  if (typeof value === "object") {
    return toPositiveInt(value.id ?? value.rowId ?? value.value);
  }

  return toPositiveInt(value);
}

function stringifyCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  return String(value);
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeMappedColumns(mappings) {
  const mapped = mappings && mappings.Columns;

  if (!mapped) {
    return [];
  }

  return Array.isArray(mapped)
    ? mapped.filter(Boolean)
    : [mapped].filter(Boolean);
}

function normalizeSingleMappedColumn(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return normalizeSingleMappedColumn(value[0]);
  }

  return typeof value === "string" ? value : null;
}

function normalizeShownValues(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

function buildVisibleTree(records, expandedSet) {
  const byId = new Map();
  const children = new Map();
  const roots = [];
  const warnings = [];

  for (const record of records) {
    const id = toPositiveInt(record.id);

    if (id !== null) {
      byId.set(id, record);
    }
  }

  for (const record of records) {
    const id = toPositiveInt(record.id);
    const parentId = rowIdOf(record.__treeParent);

    if (
      id !== null &&
      parentId !== null &&
      parentId !== id &&
      byId.has(parentId)
    ) {
      if (!children.has(parentId)) {
        children.set(parentId, []);
      }

      children.get(parentId).push(record);
    } else {
      roots.push(record);
    }
  }

  const visible = [];
  const reachable = new Set();
  const reportedCycles = new Set();

  function markReachable(record, path) {
    const id = toPositiveInt(record.id);

    if (id === null) {
      return;
    }

    if (path.has(id)) {
      const signature = [...path, id].join(">");

      if (!reportedCycles.has(signature)) {
        reportedCycles.add(signature);
        warnings.push(`Cycle detected near row ${id}. The recursive branch was stopped.`);
      }

      return;
    }

    if (reachable.has(id)) {
      return;
    }

    reachable.add(id);

    const nextPath = new Set(path);
    nextPath.add(id);

    for (const child of children.get(id) || []) {
      markReachable(child, nextPath);
    }
  }

  function walkVisible(record, level, path) {
    const id = toPositiveInt(record.id);

    if (id === null) {
      return;
    }

    if (path.has(id)) {
      return;
    }

    visible.push({ record, level });

    if (!expandedSet.has(id)) {
      return;
    }

    const nextPath = new Set(path);
    nextPath.add(id);

    for (const child of children.get(id) || []) {
      walkVisible(child, level + 1, nextPath);
    }
  }

  for (const root of roots) {
    markReachable(root, new Set());
  }

  for (const root of roots) {
    walkVisible(root, 0, new Set());
  }

  for (const record of records) {
    const id = toPositiveInt(record.id);

    if (id !== null && !reachable.has(id)) {
      warnings.push(`Row ${id} is not reachable from a root. Showing it as a top-level row.`);

      markReachable(record, new Set());
      walkVisible(record, 0, new Set());
    }
  }

  return { visible, children, warnings };
}

async function getSelectedTableId() {
  try {
    const table = grist.getTable ? grist.getTable() : grist.selectedTable;

    if (
      table &&
      table._platform &&
      typeof table._platform.getTableId === "function"
    ) {
      return await table._platform.getTableId();
    }
  } catch (err) {
    console.warn("Could not get selected table id", err);
  }

  return null;
}

async function fetchColumnMetadata(colIds) {
  const uniqueColIds = Array.from(new Set(colIds.filter(Boolean)));

  if (!uniqueColIds.length) {
    return {};
  }

  const fallback = Object.fromEntries(
    uniqueColIds.map(colId => [
      colId,
      {
        colId,
        label: colId,
        description: "",
        type: "",
        isFormula: false
      }
    ])
  );

  try {
    const tableId = await getSelectedTableId();

    if (!tableId) {
      return fallback;
    }

    const [tables, columns] = await Promise.all([
      grist.docApi.fetchTable("_grist_Tables"),
      grist.docApi.fetchTable("_grist_Tables_column")
    ]);

    const tableIndex = tables.tableId.indexOf(tableId);

    if (tableIndex < 0) {
      return fallback;
    }

    const tableRef = tables.id[tableIndex];
    const fields = Object.keys(columns);
    const result = { ...fallback };

    for (let i = 0; i < columns.id.length; i += 1) {
      if (columns.parentId[i] !== tableRef) {
        continue;
      }

      const colId = columns.colId[i];

      if (!uniqueColIds.includes(colId)) {
        continue;
      }

      const raw = Object.fromEntries(fields.map(field => [field, columns[field][i]]));

      result[colId] = {
        colId,
        label: raw.label || raw.colId || colId,
        description: raw.description || "",
        type: raw.type || "",
        isFormula: Boolean(raw.isFormula)
      };
    }

    return result;
  } catch (err) {
    console.warn("Could not fetch column metadata", err);
    return fallback;
  }
}

const app = Vue.createApp({
  data() {
    return {
      records: [],
      mappings: null,

      selectedId: null,
      selectedCol: null,

      expanded: new Set(),
      expandedVersion: 0,

      savingCells: {},
      shownColumns: [],
      columnMeta: {},
      columnWidths: {},

      resizing: null,
      openHint: null,

      status: "Waiting for Grist data…",
      isError: false,

      indentPx: 20,
      saveTimer: null,
      widthSaveTimer: null,
      metadataRequestId: 0,

      resizeMoveHandler: null,
      resizeEndHandler: null
    };
  },

  computed: {
    dataColumns() {
      return this.shownColumns;
    },

    labelColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Label);
    },

    parentColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Parent);
    },

    errorColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Error);
    },

    tree() {
      this.expandedVersion;
      return buildVisibleTree(this.records, this.expanded);
    },

    visibleRows() {
      return this.tree.visible;
    },

    warnings() {
      return this.tree.warnings;
    },

    childrenMap() {
      return this.tree.children;
    },

    totalTableWidth() {
      return this.columnWidth("__label") +
        this.dataColumns.reduce((sum, col) => sum + this.columnWidth(col), 0);
    }
  },

  methods: {
    setRecords(records, mappings) {
      this.records = records.filter(record => record && record.id !== "new");
      this.mappings = mappings || null;
      this.status = "";
      this.isError = false;

      if (this.selectedId !== null) {
        this.expandAncestors(this.selectedId, false);
      }
    },

    setShownColumns(columnIds) {
      this.shownColumns = Array.isArray(columnIds)
        ? columnIds.filter(Boolean)
        : [];
    },

    async refreshColumnMetadata(colIds) {
      const requestId = ++this.metadataRequestId;
      const metadata = await fetchColumnMetadata(colIds);

      if (requestId !== this.metadataRequestId) {
        return;
      }

      this.columnMeta = metadata;
    },

    setMappingError() {
      this.records = [];
      this.shownColumns = [];
      this.status = "Please map the required Parent and Label columns in the widget configuration.";
      this.isError = true;
    },

    recordHasError(record) {
      return Boolean(record && record.__treeError);
    },

    rawLabelValue(record) {
      const label = record && record.__treeLabel;
      return label === null || label === undefined ? "" : String(label);
    },

    labelFor(record) {
      const label = record.__treeLabel;

      if (label === null || label === undefined || label === "") {
        return `(row ${record.id})`;
      }

      return String(label);
    },

    metaForHeader(col) {
      const sourceCol = col === "__label" ? this.labelColumnId : col;

      if (!sourceCol) {
        return null;
      }

      return this.columnMeta[sourceCol] || null;
    },

    headerTitle(col) {
      const sourceCol = col === "__label" ? this.labelColumnId : col;
      const meta = this.metaForHeader(col);

      if (meta && meta.label) {
        return meta.label;
      }

      if (sourceCol) {
        return sourceCol;
      }

      return col === "__label" ? "Label" : col;
    },

    headerDescription(col) {
      const meta = this.metaForHeader(col);
      return meta && meta.description ? String(meta.description) : "";
    },

    toggleHint(col) {
      this.openHint = this.openHint === col ? null : col;
    },

    isHintOpen(col) {
      return this.openHint === col;
    },

    isFormulaColumn(col) {
      return Boolean(this.columnMeta[col] && this.columnMeta[col].isFormula);
    },

    columnWidth(col) {
      const width = Number(this.columnWidths[col]);

      if (Number.isFinite(width) && width >= MIN_COLUMN_WIDTH) {
        return width;
      }

      return col === "__label" ? DEFAULT_LABEL_WIDTH : DEFAULT_DATA_WIDTH;
    },

    columnStyle(col) {
      const width = `${this.columnWidth(col)}px`;

      return {
        width,
        minWidth: width,
        maxWidth: width
      };
    },

    startResize(col, event) {
      this.resizing = {
        col,
        startX: event.clientX,
        startWidth: this.columnWidth(col)
      };

      document.body.classList.add("resizing-column");

      this.resizeMoveHandler = this.onResizeMove.bind(this);
      this.resizeEndHandler = this.endResize.bind(this);

      window.addEventListener("mousemove", this.resizeMoveHandler);
      window.addEventListener("mouseup", this.resizeEndHandler);
    },

    onResizeMove(event) {
      if (!this.resizing) {
        return;
      }

      const delta = event.clientX - this.resizing.startX;
      const width = Math.max(
        MIN_COLUMN_WIDTH,
        Math.round(this.resizing.startWidth + delta)
      );

      this.columnWidths = {
        ...this.columnWidths,
        [this.resizing.col]: width
      };
    },

    endResize() {
      if (!this.resizing) {
        return;
      }

      this.resizing = null;
      document.body.classList.remove("resizing-column");

      if (this.resizeMoveHandler) {
        window.removeEventListener("mousemove", this.resizeMoveHandler);
      }

      if (this.resizeEndHandler) {
        window.removeEventListener("mouseup", this.resizeEndHandler);
      }

      this.resizeMoveHandler = null;
      this.resizeEndHandler = null;

      this.saveColumnWidthsDebounced();
    },

    async saveColumnWidthsDebounced() {
      clearTimeout(this.widthSaveTimer);

      this.widthSaveTimer = setTimeout(async () => {
        try {
          await grist.setOption(OPTION_WIDTHS, this.columnWidths);
        } catch (err) {
          console.warn("Could not save column widths", err);
        }
      }, 250);
    },

    cellValue(record, colIndex) {
      if (!record || !Array.isArray(record.__shownValues)) {
        return null;
      }

      return record.__shownValues[colIndex];
    },

    hasChildren(rowId) {
      const id = toPositiveInt(rowId);
      return id !== null && (this.childrenMap.get(id) || []).length > 0;
    },

    isExpanded(rowId) {
      const id = toPositiveInt(rowId);
      return id !== null && this.expanded.has(id);
    },

    toggle(rowId) {
      const id = toPositiveInt(rowId);

      if (id === null) {
        return;
      }

      const next = new Set(this.expanded);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      this.setExpanded(next, true);
    },

    setExpanded(next, shouldSave) {
      this.expanded = next;
      this.expandedVersion += 1;

      if (shouldSave) {
        this.saveExpandedDebounced();
      }
    },

    expandAncestors(rowId, shouldSave) {
      const id = toPositiveInt(rowId);

      if (id === null) {
        return;
      }

      const byId = new Map();

      for (const record of this.records) {
        const recordId = toPositiveInt(record.id);

        if (recordId !== null) {
          byId.set(recordId, record);
        }
      }

      let current = byId.get(id);
      const next = new Set(this.expanded);
      const seen = new Set();
      let changed = false;

      while (current) {
        const parentId = rowIdOf(current.__treeParent);

        if (parentId === null || seen.has(parentId)) {
          break;
        }

        seen.add(parentId);

        if (!next.has(parentId)) {
          next.add(parentId);
          changed = true;
        }

        current = byId.get(parentId);
      }

      if (changed) {
        this.setExpanded(next, shouldSave);
      }
    },

    async saveExpandedDebounced() {
      clearTimeout(this.saveTimer);

      this.saveTimer = setTimeout(async () => {
        try {
          await grist.setOption(OPTION_EXPANDED, Array.from(this.expanded));
        } catch (err) {
          console.warn("Could not save expanded state", err);
        }
      }, 250);
    },

    async selectRecord(record) {
      const id = toPositiveInt(record.id);

      if (id === null) {
        return;
      }

      this.selectedId = id;

      try {
        await grist.setCursorPos({ rowId: id });
        await grist.setSelectedRows([id]);
      } catch (err) {
        console.warn("Could not set Grist cursor/selection", err);
      }
    },

    async selectCell(record, col) {
      this.selectedCol = col;
      await this.selectRecord(record);
    },

    sampleValue(col) {
      const colIndex = this.shownColumns.indexOf(col);

      if (colIndex < 0) {
        return null;
      }

      const record = this.records.find(r =>
        Array.isArray(r.__shownValues) &&
        r.__shownValues[colIndex] !== null &&
        r.__shownValues[colIndex] !== undefined &&
        r.__shownValues[colIndex] !== ""
      );

      return record ? record.__shownValues[colIndex] : null;
    },

    inputKind(value, col) {
      const sample = value ?? this.sampleValue(col);

      if (typeof sample === "boolean") {
        return "checkbox";
      }

      if (typeof sample === "number") {
        return "number";
      }

      return "text";
    },

    cellClass(record, col, colIndex) {
      const kind = this.inputKind(this.cellValue(record, colIndex), col);

      return {
        saving: this.isSaving(record, col),
        "cell-kind-number": kind === "number",
        "cell-kind-checkbox": kind === "checkbox",
        "cell-readonly": this.isFormulaColumn(col)
      };
    },

    formatValue(value) {
      return stringifyCell(value);
    },

    resetInput(event, originalValue) {
      event.target.value =
        originalValue === null || originalValue === undefined
          ? ""
          : String(originalValue);

      event.target.blur();
    },

    coerceValue(rawValue, oldValue, col) {
      const sample = oldValue ?? this.sampleValue(col);

      if (typeof sample === "boolean") {
        return Boolean(rawValue);
      }

      if (typeof sample === "number") {
        if (rawValue === "") {
          return null;
        }

        const n = Number(rawValue);

        if (!Number.isFinite(n)) {
          throw new Error(`"${rawValue}" is not a valid number.`);
        }

        return n;
      }

      return rawValue === "" ? null : rawValue;
    },

    cellKey(record, col) {
      return `${record.id}::${col}`;
    },

    isSaving(record, col) {
      return Boolean(this.savingCells[this.cellKey(record, col)]);
    },

    setSaving(record, col, value) {
      const key = this.cellKey(record, col);

      this.savingCells = {
        ...this.savingCells,
        [key]: value
      };
    },

    async commitLabel(record, rawValue) {
      const id = toPositiveInt(record && record.id);
      const labelCol = this.labelColumnId;

      if (id === null || !labelCol) {
        return;
      }

      if (this.isFormulaColumn(labelCol)) {
        return;
      }

      const oldValue = record.__treeLabel;
      const newValue = rawValue === "" ? null : String(rawValue);

      if (sameValue(newValue, oldValue)) {
        return;
      }

      const patch = {
        id,
        fields: {
          [labelCol]: newValue
        }
      };

      this.setSaving(record, "__label", true);

      try {
        await grist.selectedTable.update(patch);
      } catch (err) {
        console.error(err);
        this.status = `Could not update label. ${err.message || err}`;
        this.isError = true;

        setTimeout(() => {
          this.status = "";
          this.isError = false;
        }, 3000);
      } finally {
        this.setSaving(record, "__label", false);
      }
    },

    async commitCell(record, col, colIndex, rawValue) {
      const id = toPositiveInt(record.id);

      if (
        id === null ||
        !col ||
        colIndex < 0
      ) {
        return;
      }

      if (this.isFormulaColumn(col)) {
        return;
      }

      const oldValue = this.cellValue(record, colIndex);
      let newValue;

      try {
        newValue = this.coerceValue(rawValue, oldValue, col);
      } catch (err) {
        this.status = err.message;
        this.isError = true;

        setTimeout(() => {
          this.status = "";
          this.isError = false;
        }, 3000);

        return;
      }

      if (sameValue(newValue, oldValue)) {
        return;
      }

      const patch = {
        id,
        fields: {
          [col]: newValue
        }
      };

      this.setSaving(record, col, true);

      try {
        await grist.selectedTable.update(patch);
      } catch (err) {
        console.error(err);
        this.status = `Could not update row ${id}, column "${col}". ${err.message || err}`;
        this.isError = true;
      } finally {
        this.setSaving(record, col, false);
      }
    }
  }
});

const vm = app.mount("#app");

grist.onOptions(options => {
  const expandedIds = options && Array.isArray(options[OPTION_EXPANDED])
    ? options[OPTION_EXPANDED]
    : null;

  if (expandedIds) {
    const next = new Set(
      expandedIds
        .map(toPositiveInt)
        .filter(id => id !== null)
    );

    vm.setExpanded(next, false);
  }

  const widths = options && options[OPTION_WIDTHS];

  if (widths && typeof widths === "object" && !Array.isArray(widths)) {
    const clean = {};

    for (const [col, width] of Object.entries(widths)) {
      const n = Number(width);

      if (Number.isFinite(n) && n >= MIN_COLUMN_WIDTH) {
        clean[col] = n;
      }
    }

    vm.columnWidths = clean;
  }
});

grist.onRecords((records, mappings) => {
  const mapped = grist.mapColumnNames(records, {
    columns: GRIST_COLUMNS,
    mappings
  });

  if (!mapped) {
    vm.setMappingError();
    return;
  }

  const shownColumnIds = normalizeMappedColumns(mappings);
  const labelColumnId = normalizeSingleMappedColumn(mappings && mappings.Label);
  const parentColumnId = normalizeSingleMappedColumn(mappings && mappings.Parent);
  const errorColumnId = normalizeSingleMappedColumn(mappings && mappings.Error);

  const mergedRecords = records.map((record, index) => {
    const mappedRecord = mapped[index] || {};

    return {
      ...record,

      // Internal aliases used by the widget.
      // They avoid collisions with real Grist column IDs.
      __treeParent: mappedRecord.Parent,
      __treeLabel: mappedRecord.Label,
      __shownValues: normalizeShownValues(mappedRecord.Columns),
      __treeError: Boolean(mappedRecord.Error)
    };
  });

  vm.setShownColumns(shownColumnIds);
  vm.setRecords(mergedRecords, mappings);

  vm.refreshColumnMetadata([
    parentColumnId,
    labelColumnId,
    errorColumnId,
    ...shownColumnIds
  ]);
}, {
  expandRefs: false
});

grist.onRecord(record => {
  if (!record) {
    vm.selectedId = null;
    return;
  }

  const id = toPositiveInt(record.id);
  vm.selectedId = id;

  if (id !== null) {
    vm.expandAncestors(id, true);
  }
});

grist.ready({
  requiredAccess: "full",
  allowSelectBy: true,
  columns: GRIST_COLUMNS
});
