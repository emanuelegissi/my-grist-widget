"use strict";

/*
  Tree Table Grist Custom Widget
  --------------------------------

  This widget displays a self-referencing Grist table as a collapsible tree.

  Each record has:
    - a Parent column pointing to another record in the same table;
    - a Label column shown as the tree label;
    - optional extra columns displayed as editable table columns;
    - an optional Error column used to color the whole row.

  The widget also:
    - persists expanded/collapsed branches;
    - persists custom widget column widths;
    - reads Grist column metadata to show labels, descriptions, and formula status;
    - renders formula columns as read-only;
    - synchronizes selection with the Grist cursor.
*/

/*
  Column mappings shown in the Grist widget configuration panel.

  These definitions tell Grist which columns the user may map to the widget.
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
    type: "Bool,Text",
    optional: true,
    description: "Optional boolean or text column. When true, the row is highlighted as an error."
  }
];

/*
  Widget option keys.

  Grist widget options are persisted per widget instance.
*/
const OPTION_EXPANDED = "expandedRowIds";
const OPTION_WIDTHS = "columnWidths";

/*
  Column width defaults.

  MIN_COLUMN_WIDTH controls how small a column can become while resizing.
*/
const MIN_COLUMN_WIDTH = 35;
const DEFAULT_LABEL_WIDTH = 280;
const DEFAULT_DATA_WIDTH = 100;

/*
  Convert a value to a positive integer row ID.

  Returns null for invalid IDs.
*/
function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/*
  Normalize a Grist reference-like value to a row ID.

  With expandRefs:false, Ref columns normally arrive as row IDs.
  This function is defensive and also handles possible array/object shapes.
*/
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

/*
  Convert a cell value to a display string.

  Objects are JSON-stringified when possible.
*/
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

/*
  Compare two values in a simple stable way.

  This is sufficient for the simple supported cell types used by the widget.
*/
function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/*
  Normalize the multi-column mapping for "Shown columns".

  Grist may return either:
    - undefined/null when no column is mapped;
    - a single string;
    - an array of strings.

  The widget always wants an array of column IDs.
*/
function normalizeMappedColumns(mappings) {
  const mapped = mappings && mappings.Columns;

  if (!mapped) {
    return [];
  }

  return Array.isArray(mapped)
    ? mapped.filter(Boolean)
    : [mapped].filter(Boolean);
}

/*
  Normalize a single mapped column.

  Some Grist mapping values may be arrays, even when only one column is expected.
*/
function normalizeSingleMappedColumn(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return normalizeSingleMappedColumn(value[0]);
  }

  return typeof value === "string" ? value : null;
}

/*
  Normalize mapped values for "Shown columns".

  For multi-column mappings, mappedRecord.Columns should be an array.
  This function keeps the rest of the widget safe if it is not.
*/
function normalizeShownValues(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

/*
  Build the visible tree rows.

  This function separates two concepts:
    - reachable records: records that belong to the tree even if hidden by a folded branch;
    - visible records: records currently shown because their ancestors are expanded.

  This prevents folded children from being incorrectly reported as unreachable.
*/
function buildVisibleTree(records, expandedSet) {
  const byId = new Map();
  const children = new Map();
  const roots = [];
  const warnings = [];

  /*
    First pass:
    create a lookup map from row ID to record.
  */
  for (const record of records) {
    const id = toPositiveInt(record.id);

    if (id !== null) {
      byId.set(id, record);
    }
  }

  /*
    Second pass:
    group records by parent ID.

    If a record has no valid parent, it becomes a root record.
  */
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

  /*
    Mark all records reachable from roots, regardless of expanded/collapsed state.

    This is used only for validation and warning generation.
  */
  function markReachable(record, path) {
    const id = toPositiveInt(record.id);

    if (id === null) {
      return;
    }

    /*
      Stop recursion if a cycle is found.

      Example:
        A -> B -> C -> A
    */
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

  /*
    Build only the rows that should currently be visible.

    Children are walked only when the parent row ID is in expandedSet.
  */
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

  /*
    Normal tree traversal from root records.
  */
  for (const root of roots) {
    markReachable(root, new Set());
  }

  for (const root of roots) {
    walkVisible(root, 0, new Set());
  }

  /*
    Defensive fallback:
    if records are not reachable from any root, still show them as top-level rows.

    This prevents bad data from making records disappear completely.
  */
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

/*
  Try to get the selected table ID.

  This is used to read Grist metadata tables and find column labels,
  descriptions, types, and formula flags.
*/
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

/*
  Fetch metadata for selected columns.

  Metadata is read from Grist internal metadata tables:
    - _grist_Tables
    - _grist_Tables_column

  The widget uses this metadata to:
    - show column labels instead of raw column IDs;
    - show column descriptions in the header info hint;
    - detect formula columns and render them as read-only.
*/
async function fetchColumnMetadata(colIds) {
  const uniqueColIds = Array.from(new Set(colIds.filter(Boolean)));

  if (!uniqueColIds.length) {
    return {};
  }

  /*
    Fallback metadata used if the real metadata cannot be fetched.
  */
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

    /*
      Find the metadata row for the current source table.
    */
    const tableIndex = tables.tableId.indexOf(tableId);

    if (tableIndex < 0) {
      return fallback;
    }

    const tableRef = tables.id[tableIndex];
    const fields = Object.keys(columns);
    const result = { ...fallback };

    /*
      Scan metadata columns for the current table and keep only those
      requested by uniqueColIds.
    */
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

/*
  Main Vue application.
*/
const app = Vue.createApp({
  data() {
    return {
      /*
        Current records received from Grist.
      */
      records: [],

      /*
        Current Grist column mappings.
      */
      mappings: null,

      /*
        Current selected row and selected column.
      */
      selectedId: null,
      selectedCol: null,

      /*
        Expanded tree branches.
        expandedVersion is used to force Vue recomputation because Set mutations
        are not deeply reactive in a simple way.
      */
      expanded: new Set(),
      expandedVersion: 0,

      /*
        Cell update and display state.
      */
      savingCells: {},
      shownColumns: [],
      columnMeta: {},
      columnWidths: {},

      /*
        UI state for resizing and header description hints.
      */
      resizing: null,
      openHint: null,

      /*
        Status/error message shown above the table.
      */
      status: "Waiting for Grist data…",
      isError: false,

      /*
        Tree indentation in pixels per level.
      */
      indentPx: 20,

      /*
        Timers and request guards.
      */
      saveTimer: null,
      metadataRequestId: 0,

      /*
        References to resize event handlers, so they can be removed cleanly.
      */
      resizeMoveHandler: null,
      resizeEndHandler: null
    };
  },

  computed: {
    /*
      Columns displayed in the table area after the Label column.
    */
    dataColumns() {
      return this.shownColumns;
    },

    /*
      Real Grist column ID mapped to the Label field.
    */
    labelColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Label);
    },

    /*
      Real Grist column ID mapped to the Parent field.
    */
    parentColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Parent);
    },

    /*
      Real Grist column ID mapped to the optional Error field.
    */
    errorColumnId() {
      return normalizeSingleMappedColumn(this.mappings && this.mappings.Error);
    },

    /*
      Tree model derived from records and expanded state.
    */
    tree() {
      this.expandedVersion;
      return buildVisibleTree(this.records, this.expanded);
    },

    /*
      Flat list of rows currently visible in the tree.
    */
    visibleRows() {
      return this.tree.visible;
    },

    /*
      Validation warnings generated while building the tree.
    */
    warnings() {
      return this.tree.warnings;
    },

    /*
      Map of parent row ID -> child records.
    */
    childrenMap() {
      return this.tree.children;
    },

    /*
      Pixel width of the whole custom table.

      The table is not forced to fill the full widget width, so empty space
      remains visible on the right when columns are narrow.
    */
    totalTableWidth() {
      return this.columnWidth("__label") +
        this.dataColumns.reduce((sum, col) => sum + this.columnWidth(col), 0);
    }
  },

  methods: {
    /*
      Store records received from Grist.

      The "new" pseudo-row is ignored.
    */
    setRecords(records, mappings) {
      this.records = records.filter(record => record && record.id !== "new");
      this.mappings = mappings || null;
      this.status = "";
      this.isError = false;

      /*
        If a row is selected, keep its ancestors expanded after data refresh.
      */
      if (this.selectedId !== null) {
        this.expandAncestors(this.selectedId, false);
      }
    },

    /*
      Store the visible data columns chosen by the user.
    */
    setShownColumns(columnIds) {
      this.shownColumns = Array.isArray(columnIds)
        ? columnIds.filter(Boolean)
        : [];
    },

    /*
      Refresh column metadata.

      requestId prevents older asynchronous responses from overwriting newer
      metadata after a rapid mapping change.
    */
    async refreshColumnMetadata(colIds) {
      const requestId = ++this.metadataRequestId;
      const metadata = await fetchColumnMetadata(colIds);

      if (requestId !== this.metadataRequestId) {
        return;
      }

      this.columnMeta = metadata;
    },

    /*
      Show a message when required column mappings are missing.
    */
    setMappingError() {
      this.records = [];
      this.shownColumns = [];
      this.status = "Please map the required Parent and Label columns in the widget configuration.";
      this.isError = true;
    },

    /*
      Whether the row should be highlighted as an error row.
    */
    recordHasError(record) {
      return Boolean(record && record.__treeError);
    },

    /*
      Raw value used by the editable Label input.
    */
    rawLabelValue(record) {
      const label = record && record.__treeLabel;
      return label === null || label === undefined ? "" : String(label);
    },

    /*
      Display value for the tree label.

      If the label is empty, show a row placeholder.
    */
    labelFor(record) {
      const label = record.__treeLabel;

      if (label === null || label === undefined || label === "") {
        return `(row ${record.id})`;
      }

      return String(label);
    },

    /*
      Return metadata for a header column.

      "__label" is an internal widget column key, so it must be translated
      back to the real mapped Label column ID.
    */
    metaForHeader(col) {
      const sourceCol = col === "__label" ? this.labelColumnId : col;

      if (!sourceCol) {
        return null;
      }

      return this.columnMeta[sourceCol] || null;
    },

    /*
      Header text: prefer Grist column label, then column ID.
    */
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

    /*
      Header description shown by the info icon.
    */
    headerDescription(col) {
      const meta = this.metaForHeader(col);
      return meta && meta.description ? String(meta.description) : "";
    },

    /*
      Toggle a pinned header hint.
    */
    toggleHint(col) {
      this.openHint = this.openHint === col ? null : col;
    },

    /*
      Whether a header hint is currently pinned open.
    */
    isHintOpen(col) {
      return this.openHint === col;
    },

    /*
      Detect whether a column is a formula column.

      Formula columns are shown read-only and display an "=" badge.
    */
    isFormulaColumn(col) {
      return Boolean(this.columnMeta[col] && this.columnMeta[col].isFormula);
    },

    /*
      Get current width for a column.

      "__label" is the tree label column; all others are data columns.
    */
    columnWidth(col) {
      const width = Number(this.columnWidths[col]);

      if (Number.isFinite(width) && width >= MIN_COLUMN_WIDTH) {
        return width;
      }

      return col === "__label" ? DEFAULT_LABEL_WIDTH : DEFAULT_DATA_WIDTH;
    },

    /*
      Inline style object used by colgroup, th, and td.
    */
    columnStyle(col) {
      const width = `${this.columnWidth(col)}px`;

      return {
        width,
        minWidth: width,
        maxWidth: width
      };
    },

    /*
      Start dragging a column resizer.
    */
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

    /*
      Update the column width while dragging.
    */
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

    /*
      Finish resizing and save the final column widths.
    */
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

      this.saveColumnWidths();
    },

    /*
      Save column widths to Grist widget options.

      This is called once when the resize operation ends.
    */
    async saveColumnWidths() {
      const clean = {};

      for (const [col, width] of Object.entries(this.columnWidths)) {
        const n = Number(width);

        if (Number.isFinite(n) && n >= MIN_COLUMN_WIDTH) {
          clean[col] = n;
        }
      }

      try {
        await grist.setOption(OPTION_WIDTHS, clean);
      } catch (err) {
        console.warn("Could not save column widths", err);
      }
    },

    /*
      Return a mapped visible cell value by column index.
    */
    cellValue(record, colIndex) {
      if (!record || !Array.isArray(record.__shownValues)) {
        return null;
      }

      return record.__shownValues[colIndex];
    },

    /*
      Whether a tree row has child rows.
    */
    hasChildren(rowId) {
      const id = toPositiveInt(rowId);
      return id !== null && (this.childrenMap.get(id) || []).length > 0;
    },

    /*
      Whether a tree row is currently expanded.
    */
    isExpanded(rowId) {
      const id = toPositiveInt(rowId);
      return id !== null && this.expanded.has(id);
    },

    /*
      Toggle expanded/collapsed state for one tree branch.
    */
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

    /*
      Replace the expanded set.

      expandedVersion is incremented to force computed tree recomputation.
    */
    setExpanded(next, shouldSave) {
      this.expanded = next;
      this.expandedVersion += 1;

      if (shouldSave) {
        this.saveExpandedDebounced();
      }
    },

    /*
      Expand all ancestors of a selected row so the row remains visible.
    */
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

    /*
      Debounced save for expanded tree branches.

      Unlike column width saving, this may happen frequently when the user
      opens/closes branches, so a small debounce is useful.
    */
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

    /*
      Select a Grist record and synchronize the Grist cursor.
    */
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

    /*
      Select both a row and a column.

      The selected column is used to highlight the corresponding header.
    */
    async selectCell(record, col) {
      this.selectedCol = col;
      await this.selectRecord(record);
    },

    /*
      Find a non-empty sample value for a column.

      This helps determine whether a column should be rendered as:
        - text input;
        - number input;
        - checkbox.
    */
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

    /*
      Determine input type for a value.
    */
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

    /*
      Return CSS classes for a data cell.
    */
    cellClass(record, col, colIndex) {
      const kind = this.inputKind(this.cellValue(record, colIndex), col);

      return {
        saving: this.isSaving(record, col),
        "cell-kind-number": kind === "number",
        "cell-kind-checkbox": kind === "checkbox",
        "cell-readonly": this.isFormulaColumn(col)
      };
    },

    /*
      Format a value for display.
    */
    formatValue(value) {
      return stringifyCell(value);
    },

    /*
      Restore an input value when Escape is pressed.
    */
    resetInput(event, originalValue) {
      event.target.value =
        originalValue === null || originalValue === undefined
          ? ""
          : String(originalValue);

      event.target.blur();
    },

    /*
      Convert raw input strings back to the appropriate Grist value type.
    */
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

    /*
      Key used to track saving state per record/column pair.
    */
    cellKey(record, col) {
      return `${record.id}::${col}`;
    },

    /*
      Whether a cell is currently being saved.
    */
    isSaving(record, col) {
      return Boolean(this.savingCells[this.cellKey(record, col)]);
    },

    /*
      Set saving state for a cell.
    */
    setSaving(record, col, value) {
      const key = this.cellKey(record, col);

      this.savingCells = {
        ...this.savingCells,
        [key]: value
      };
    },

    /*
      Save an edited tree Label value back to Grist.
    */
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

    /*
      Save an edited data cell back to Grist.
    */
    async commitCell(record, col, colIndex, rawValue) {
      const id = toPositiveInt(record.id);

      if (
        id === null ||
        !col ||
        colIndex < 0
      ) {
        return;
      }

      /*
        Formula columns cannot be updated.
      */
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

/*
  Mount the Vue app.
*/
const vm = app.mount("#app");

/*
  Load saved widget options.

  This restores:
    - expanded/collapsed tree branches;
    - custom widget column widths.
*/
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

/*
  Receive table records from Grist.

  expandRefs:false is important:
  it makes reference columns arrive as row IDs, which is exactly what the
  tree builder needs for Parent values.
*/
grist.onRecords((records, mappings) => {
  /*
    Convert user-mapped Grist columns into normalized widget names:
      Parent, Label, Columns, Error.
  */
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

  /*
    Merge original records with internal widget aliases.

    Internal aliases begin with "__" to avoid collisions with real Grist
    column IDs.
  */
  const mergedRecords = records.map((record, index) => {
    const mappedRecord = mapped[index] || {};

    return {
      ...record,

      __treeParent: mappedRecord.Parent,
      __treeLabel: mappedRecord.Label,
      __shownValues: normalizeShownValues(mappedRecord.Columns),
      __treeError: Boolean(mappedRecord.Error)
    };
  });

  vm.setShownColumns(shownColumnIds);
  vm.setRecords(mergedRecords, mappings);

  /*
    Refresh metadata for every column used by the widget.
  */
  vm.refreshColumnMetadata([
    parentColumnId,
    labelColumnId,
    errorColumnId,
    ...shownColumnIds
  ]);
}, {
  expandRefs: false
});

/*
  Receive current selected record from Grist.

  This keeps the widget selection synchronized with other linked widgets.
*/
grist.onRecord(record => {
  if (!record) {
    vm.selectedId = null;
    return;
  }

  const id = toPositiveInt(record.id);
  vm.selectedId = id;

  /*
    If the selected record is inside a collapsed branch, expand its ancestors.
  */
  if (id !== null) {
    vm.expandAncestors(id, true);
  }
});

/*
  Tell Grist the widget is ready.

  requiredAccess:"full" is needed because this widget can update records.
  allowSelectBy:true enables cursor/selection linking.
*/
grist.ready({
  requiredAccess: "full",
  allowSelectBy: true,
  columns: GRIST_COLUMNS
});
