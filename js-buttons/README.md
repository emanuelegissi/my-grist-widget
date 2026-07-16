# Grist JS Buttons

A simple vanilla-JavaScript Grist custom widget that renders configurable JavaScript buttons.

See an application example [here](). FIXME

Use it by inserting the following link as widget custom URL:
`https://emanuelegissi.github.io/my-grist-widget/js-buttons`

## Features

- no column mapping;
- compact Grist-style button row;
- very small configuration button on the right side of the widget panel;
- Monaco editor for the JavaScript configuration panel;
- configuration saved either locally in widget options or shared through a Grist table;
- optional creation of the shared configuration table when it does not exist;
- dynamic JavaScript configuration through `function get_buttons()`;
- synchronous and asynchronous `onclick` handlers;
- button labels, tooltips, text colors, background colors, hidden state, and disabled state;
- all buttons disabled while an action is running.

## Configuration sources

The configuration panel supports two modes.

### Local widget options

The JavaScript code is saved in this widget instance's Grist widget options. This is best for one-off buttons.

### Shared Grist table

The JavaScript code is saved in a normal Grist table so multiple widget instances can reuse the same button configuration.

Default shared table:

```text
JS_Buttons
```

Required columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `Name` | Text | Configuration name, for example `default`, `admin`, or `records`. |
| `Code` | Text | JavaScript code defining `function get_buttons()`. |

If the configured shared table does not exist, the configuration panel shows a **Create table** button. It creates a data table without adding a document page, adds the required columns, and inserts the current editor code as the first named configuration.

When using shared mode:

- **Load** reads the selected `Name` from the shared table into the existing JavaScript editor;
- **Save** writes the editor code back to the shared table;
- if the named configuration does not exist but the table exists, **Save** creates a new row for it.

## Configuration API

The configuration code must define:

```javascript
function get_buttons() {
  return [];
}
```

It may return an array, `null`, an empty array, or a Promise resolving to one of those values.

Each visible, enabled button needs at least:

```javascript
{
  label: "Button label",
  onclick: () => {
    // action
  }
}
```

Supported properties:

- `label`
- `onclick`
- `title`
- `color`
- `background_color`
- `disabled`
- `hidden`

The widget requests full document access so configuration code can run document-changing actions through `widget.applyUserActions()`.

## Object available to configuration code

The configuration code receives access to the normal global `grist` object and one additional object named `widget`.

No separate `helpers` object is exposed. The `widget` object intentionally contains only general helper methods:

```javascript
widget.getCurrentRecord();
widget.getCurrentRowId();
widget.getSelectedTableId();
widget.requireCurrentRowId();
widget.sleep(500);
widget.applyUserActions(userActions);
widget.addNewRecord();
widget.removeCurrentRecord();
widget.openUrl(url);
```

`widget.applyUserActions(userActions)` applies Grist user actions, detects newly created row ids when possible, moves the Grist cursor to the last affected Add/Update row, and after `RemoveRecord`/`BulkRemoveRecord` moves the cursor to a nearby surviving row.

### Return value of `widget.applyUserActions()`

`widget.applyUserActions(userActions)` returns a Promise. The Promise resolves after the actions have been applied and the widget has finished moving the cursor. Its value is the result object returned by Grist's `grist.docApi.applyUserActions()`; the widget does not modify that object.

A typical result has this shape:

```javascript
{
  actionNum: 123,
  retValues: [42],
  isModification: true
}
```

- `actionNum` is the document action number assigned by Grist.
- `retValues` contains one return value for each requested user action, in the same order as `userActions`.
- `isModification` indicates whether Grist treated the action bundle as a document modification.
- Some Grist versions may include additional properties, such as `actionHash`. Grist types this API result as `any`, so configuration code should only depend on properties it needs and should tolerate additional or unavailable properties.

For example, `AddRecord` returns its new row id, while `BulkAddRecord` returns an array of new row ids:

```javascript
async function add_one_record() {
  const tableId = await widget.getSelectedTableId();
  const result = await widget.applyUserActions([
    ["AddRecord", tableId, null, {Name: "New record"}]
  ]);

  const newRowId = result.retValues[0];
  console.log("Created row:", newRowId);
}

async function add_two_records() {
  const tableId = await widget.getSelectedTableId();
  const result = await widget.applyUserActions([
    ["BulkAddRecord", tableId, [null, null], {
      Name: ["First record", "Second record"]
    }]
  ]);

  const newRowIds = result.retValues[0];
  console.log("Created rows:", newRowIds);
}
```

If Grist cannot apply an action, the Promise rejects and no result is returned. A synchronous error thrown by `onclick` is handled in the same way as a rejected Promise.

### Custom error handling

By default, no `try`/`catch` is required in a button handler. Letting an error escape from `onclick` makes the widget display its message in the status area. The widget also restores the enabled state of the buttons:

```javascript
async function approve_current_record() {
  const tableId = await widget.getSelectedTableId();
  const rowId = widget.requireCurrentRowId();

  // If this rejects, the widget displays the error automatically.
  await widget.applyUserActions([
    ["UpdateRecord", tableId, rowId, {Status: "Approved"}]
  ]);
}
```

Catch the error inside the handler when it needs to be handled completely by configuration code. Normalize the caught value because JavaScript permits throwing values that are not `Error` objects:

```javascript
function error_message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function approve_with_alert() {
  try {
    const tableId = await widget.getSelectedTableId();
    const rowId = widget.requireCurrentRowId();

    await widget.applyUserActions([
      ["UpdateRecord", tableId, rowId, {Status: "Approved"}]
    ]);
  } catch (error) {
    alert("The record could not be approved: " + error_message(error));
    // Do not rethrow: this error has been fully handled here.
  }
}
```

When configuration code needs to log or inspect the original error but still wants the widget to show an error, catch it and throw a new error with useful context. The widget displays the new message:

```javascript
async function approve_with_context() {
  try {
    const tableId = await widget.getSelectedTableId();
    const rowId = widget.requireCurrentRowId();

    await widget.applyUserActions([
      ["UpdateRecord", tableId, rowId, {Status: "Approved"}]
    ]);
  } catch (error) {
    console.error("Approval failed", error);
    throw new Error(
      "Could not approve the selected record: " + error_message(error),
      {cause: error}
    );
  }
}
```

Use `finally` for cleanup that must run on both success and failure:

```javascript
async function run_with_cleanup(userActions) {
  const startedAt = Date.now();

  try {
    await widget.applyUserActions(userActions);
  } finally {
    console.log("Action finished after", Date.now() - startedAt, "ms");
  }
}
```

If a caught error is not rethrown, the widget considers the handler successful and renders the buttons again. If it is rethrown, the widget displays the error and preserves the current button rendering. In either case, the widget keeps all buttons disabled until the asynchronous handler and its error handling have finished.

### Example functions

Specific example actions still belong in the editable configuration code. The default `DEFAULT_CONFIG_CODE` defines example functions such as:

```javascript
async function add_records_with_user_actions() { ... }
async function update_current_record_with_user_actions() { ... }
async function remove_current_record_after_confirm() { ... }
```

Then `get_buttons()` wires buttons to those functions or directly to general widget helpers such as `widget.addNewRecord()` and `widget.openUrl(url)`.

When `get_buttons()` returns `null`, `[]`, or only hidden buttons, the panel remains empty except for the small configuration button.
