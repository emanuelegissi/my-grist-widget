# Grist JS Buttons Custom Widget

A Grist custom widget that displays a row of configurable JavaScript buttons.

The widget is written in **vanilla JavaScript** and does not use Vue, React, or any other UI framework. It uses CodeMirror only for the configuration code editor.

## Features

- Displays a row of buttons inside a Grist custom widget.
- Buttons are generated dynamically from JavaScript configuration code.
- The configuration is saved in Grist widget options.
- Supports a mapped input column of type `Any`.
- Supports custom button labels, hints, colors, background colors, and disabled state.
- Supports synchronous and asynchronous `onclick` functions.
- Automatically disables a button while its `onclick` function is running.
- Provides access to the Grist API from button code.
- Includes examples for:
  - showing mapped input;
  - logging mapped input;
  - creating records;
  - creating/updating/removing records with `grist.docApi.applyUserActions(userActions)`;
  - moving the cursor to a created or updated record;
  - opening a URL in a browser tab.

## Installation

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/js-buttons

## Column mapping

The widget declares one mapped column:

| Widget column   |  Type | Description                                       |
| --------------- | ----: | ------------------------------------------------- |
| `Buttons input` | `Any` | Value passed to the button configuration function |

Inside the JavaScript configuration function, this mapped value is received as:

```javascript
function get_buttons(input) {
  // input is the value from the mapped "Buttons input" column
}
```

## Configuration

Click the configuration button in the top-right corner of the widget.

The configuration panel lets you write JavaScript code. The code must define a function named:

```javascript
function get_buttons(input) {
  return [];
}
```

The function receives the mapped input value for the currently selected Grist record and must return an array of button objects.

## Button object format

Each active button should have at least:

```javascript
{
  label: "Button label",
  onclick: () => {
    // action
  }
}
```

Supported button properties are:

| Property           |                     Required | Description                               |
| ------------------ | ---------------------------: | ----------------------------------------- |
| `label`            |                          Yes | Button text                               |
| `onclick`          | Yes, unless `disabled: true` | JavaScript function executed when clicked |
| `title`            |                           No | Browser tooltip / hint                    |
| `color`            |                           No | Text color                                |
| `background_color` |                           No | Button background color                   |
| `disabled`         |                           No | If `true`, the button is disabled         |

Example:

```javascript
{
  label: "Save",
  title: "Save this record",
  color: "#ffffff",
  background_color: "#16a34a",
  disabled: false,
  onclick: async () => {
    console.log("Saving...");
  }
}
```

## Important note about `onclick`

Do not call the function directly inside the button object.

Wrong:

```javascript
{
  label: "Show input",
  onclick: show_input(input)
}
```

This runs immediately while the buttons are being created.

Correct:

```javascript
{
  label: "Show input",
  onclick: () => show_input(input)
}
```

## Disabled buttons

A disabled button may omit `onclick`:

```javascript
{
  label: "Disabled",
  title: "This button is disabled",
  disabled: true
}
```

The widget also disables a button automatically while its `onclick` function is running.

For asynchronous operations, return or await a Promise:

```javascript
{
  label: "Wait",
  onclick: async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    alert("Done");
  }
}
```

## Accessing Grist data

The configuration code has access to the global `grist` object.

The widget also calls button functions with a context object.

```javascript
onclick: async (event, context) => {
  console.log(context.record);
  console.log(context.rowId);
  console.log(context.input);
}
```

Available context properties include:

| Property                   | Description                 |
| -------------------------- | --------------------------- |
| `grist`                    | Grist plugin API object     |
| `input`                    | Current mapped input value  |
| `record`                   | Current raw selected record |
| `mappedRecord`             | Current mapped record       |
| `mappings`                 | Grist column mappings       |
| `rowId`                    | Current selected row id     |
| `button`                   | Button object being clicked |
| `element`                  | HTML button element         |
| `index`                    | Button index                |
| `event`                    | Click event                 |
| `refresh()`                | Re-render the buttons       |
| `setStatus(message, kind)` | Show a status message       |
| `clearStatus()`            | Clear the status message    |

Example:

```javascript
{
  label: "Current row",
  onclick: (event, context) => {
    alert("Current row id: " + context.rowId);
  }
}
```

## Example configuration

```javascript
function show_input(input) {
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

  const before = await grist.fetchSelectedTable();
  const beforeIds = new Set(before.id || []);

  let lastTargetRowId = null;

  for (const action of userActions) {
    if (!Array.isArray(action) || action.length < 2) {
      continue;
    }

    const actionName = action[0];
    const tableId = action[1];

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
}
```

## Notes about `run_user_actions(userActions)`

The helper function:

1. accepts any Grist `userActions` array;
2. runs it with:

```javascript
await grist.docApi.applyUserActions(userActions);
```

3. detects records created by `AddRecord` or `BulkAddRecord`;
4. detects records updated by `UpdateRecord` or `BulkUpdateRecord`;
5. moves the Grist cursor to the last created or updated record when possible.

For removed records, the helper does not move the cursor to the removed row because it no longer exists.

## Styling buttons

A default button:

```javascript
{
  label: "Default",
  onclick: () => alert("Clicked")
}
```

A colored button:

```javascript
{
  label: "Save",
  color: "#ffffff",
  background_color: "#16a34a",
  onclick: () => alert("Saved")
}
```

A disabled button:

```javascript
{
  label: "Disabled",
  disabled: true
}
```

## Security note

The configuration panel runs JavaScript written by the document editor. This is powerful and intentional, but it means the widget should only be configured by trusted users.

Because buttons can modify Grist data, the widget requests full access.


