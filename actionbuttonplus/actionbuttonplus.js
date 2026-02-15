function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

const column = 'ActionButton';
let app = undefined;
let data = {
  status: 'waiting',
  result: null,
  inputs: [{
    description: null,
    button: null,
    actions: null,
    color: null,
  }],
};

function handleError(err) {
  console.error('ERROR', err);
  data.status = String(err).replace(/^Error: /, '');
}

function isUserActionTuple(x) {
  return Array.isArray(x) && typeof x[0] === "string";
}

async function applyActions(actions) {
  data.result = "Working...";

  // Remember which actions are AddRecord (there may be more than one).
  const addRecordIndexes = [];
  for (let i = 0; i < (actions || []).length; i++) {
    const a = actions[i];
    if (Array.isArray(a) && a[0] === "AddRecord") {
      addRecordIndexes.push(i);
    }
  }

  try {
    const res = await grist.docApi.applyUserActions(actions);

    // `applyUserActions` returns an object that typically includes `retValues`,
    // aligned to the input `actions` array.
    const retValues = (res && Array.isArray(res.retValues)) ? res.retValues : null;

    if (retValues && addRecordIndexes.length) {
      // Select the last created record if multiple were added.
      const idx = addRecordIndexes[addRecordIndexes.length - 1];
      const rv = retValues[idx];

      const newRowId =
        (typeof rv === "number" && Number.isFinite(rv)) ? rv :
          (rv && typeof rv === "object" && typeof rv.id === "number") ? rv.id :
            null;

      if (newRowId != null) {
        await grist.setCursorPos({ rowId: newRowId });
      }
    }

    data.result = "Done";
  } catch (e) {
    data.result = `Please grant full access for writing. (${e})`;
  }
}

function onRecord(row, mappings) {
  try {
    data.status = '';
    data.result = null;

    // If there is no mapping, test the original record.
    row = grist.mapColumnNames(row) || row;

    if (!row.hasOwnProperty(column)) {
      throw new Error(
        `Need a visible column named "${column}". You can map a custom column in the Creator Panel.`
      );
    }

    let btns = row[column];

    // Empty cell => no buttons (avoid throwing)
    if (btns == null) {
      data.inputs = [];
      return;
    }

    // If only one action button is defined, put it within an Array
    if (!Array.isArray(btns)) {
      btns = [btns];
    }

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

      if (!Array.isArray(btn.actions) || !btn.actions.every(isUserActionTuple)) {
        throw new Error(
          `Invalid "actions". Expected an array of UserActions like ` +
          `[["AddRecord","Table1",null,{...}]]`
        );
      }

      // Optional button color (any CSS color string).
      if (btn.color != null && typeof btn.color !== "string") {
        throw new Error(`Optional "color" must be a string (e.g. "#1486ff").`);
      }
    }

    data.inputs = btns;
  } catch (err) {
    handleError(err);
  }
}

ready(function () {
  // Update the widget anytime the document data changes.
  grist.ready({
    requiredAccess: "full",
    allowSelectBy: true,
    columns: [{ name: column, title: "Action" }],
  });

  grist.onRecord(onRecord);

  Vue.config.errorHandler = handleError;

  app = new Vue({
    el: '#app',
    data: data,
    methods: {
      applyActions,

      // If input.color is set, override the neutral style.
      buttonStyle(input) {
        if (!input || !input.color) return null;
        return {
          backgroundColor: input.color,
          borderColor: input.color,
          color: '#fff',
        };
      },
    }
  });
});
