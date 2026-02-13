// Run `fn` immediately if DOM is already parsed, otherwise wait for DOMContentLoaded.
function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

// Name of the column expected in the record (or mapped via Creator Panel).
const column = 'ActionButton';

// Vue instance handle (optional; useful for debugging)
let app;

// Reactive data model for Vue.
let data = {
  status: 'waiting',  // 'waiting' shows “Waiting for data...”; otherwise used for errors
  result: null,       // UI feedback: "Working...", "Done", or error message
  inputs: [{
    description: null,
    button: null,
    actions: null,
  }],
  desc: null          // index of hovered button (used to show description)
};

function handleError(err) {
  console.error('ERROR', err);
  // Strip "Error: " prefix for cleaner display
  data.status = String(err).replace(/^Error: /, '');
}

async function applyActions(actions) {
  // Show progress feedback in the widget UI.
  data.result = "Working...";

  // Identify AddRecord actions (there may be more than one action in a click).
  // We'll use this to select the row that gets created.
  const addRecordIndexes = [];
  for (let i = 0; i < (actions || []).length; i++) {
    const a = actions[i];
    // UserAction format: ["AddRecord", tableId, null, {col: val, ...}]
    if (Array.isArray(a) && a[0] === "AddRecord") {
      addRecordIndexes.push(i);
    }
  }

  try {
    // Apply the actions. Requires requiredAccess: "full".
    const res = await grist.docApi.applyUserActions(actions);

    // applyUserActions commonly returns an object with retValues[],
    // aligned with the input actions array.
    const retValues = (res && Array.isArray(res.retValues)) ? res.retValues : null;

    // If we added records and have aligned return values, select the last created one.
    if (retValues && addRecordIndexes.length) {
      const idx = addRecordIndexes[addRecordIndexes.length - 1];
      const rv = retValues[idx];

      // Defensive extraction of the new row id:
      // usually rv is a number, but keep a fallback for object-with-id shapes.
      const newRowId =
        (typeof rv === "number" && Number.isFinite(rv)) ? rv :
        (rv && typeof rv === "object" && typeof rv.id === "number") ? rv.id :
        null;

      if (newRowId != null) {
        // Move cursor to new row (makes it the current record).
        // allowSelectBy: true must be set in grist.ready().
        await grist.setCursorPos({ rowId: newRowId });

        // Also select it (helpful for linked sections / visible selection state).
        await grist.setSelectedRows([newRowId]);
      }
    }

    data.result = "Done";
  } catch (e) {
    // Typical causes: missing full access, invalid user-actions, etc.
    data.result = `Please grant full access for writing. (${e})`;
  }
}

function onRecord(row, mappings) {
  try {
    // Clear any previous error and previous "Done/Working" message
    data.status = '';
    data.result = null;

    // Apply column mappings from the Creator Panel (if any).
    row = grist.mapColumnNames(row) || row;

    // Ensure the configured/mapped column exists.
    if (!row.hasOwnProperty(column)) {
      throw new Error(
        `Need a visible column named "${column}". You can map a custom column in the Creator Panel.`
      );
    }

    // Cell may contain either a single button config object or an array of them.
    let btns = row[column];

    // Normalize to array for simpler handling.
    if (!Array.isArray(btns)) {
      btns = [btns];
    }

    // Validate required keys on each button config.
    const keys = ['button', 'description', 'actions'];
    for (const btn of btns) {
      if (!btn || keys.some(k => !btn[k])) {
        const allKeys = keys.map(k => JSON.stringify(k)).join(", ");
        const missing = keys.filter(k => !btn?.[k]).map(k => JSON.stringify(k)).join(", ");
        const gristName = mappings?.[column] || column;

        throw new Error(
          `"${gristName}" cells should contain an object with keys ${allKeys}. ` +
          `Missing keys: ${missing}`
        );
      }
    }

    // Store validated button definitions for Vue to render.
    data.inputs = btns;
    data.desc = null;
  } catch (err) {
    handleError(err);
  }
}

ready(function() {
  // Initialize Grist widget integration:
  // - requiredAccess: "full" because applyUserActions can write
  // - allowSelectBy: true to let the widget change cursor/selection
  // - columns: request the ActionButton column (or allow mapping to it)
  grist.ready({
    requiredAccess: "full",
    allowSelectBy: true,
    columns: [{ name: column, title: "Action" }],
  });

  // React to record selection changes in Grist.
  grist.onRecord(onRecord);

  // Forward Vue errors through the same handler.
  Vue.config.errorHandler = handleError;

  // Start Vue app.
  app = new Vue({
    el: '#app',
    data: data,
    methods: { applyActions }
  });
});

