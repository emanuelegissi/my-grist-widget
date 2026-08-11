# Grist Action Buttons

A small vanilla-JavaScript Grist custom widget that renders configurable action buttons for the selected record.

Use it by inserting the following link as the custom widget URL:

```text
https://emanuelegissi.github.io/my-grist-widget/actionbuttons
```

The widget requires full document access because its buttons may apply Grist UserActions.

## Features

- configuration from one mapped Grist column;
- one button object or an array of buttons per record;
- optional button descriptions, confirmations, and background colors;
- disabled buttons when `actions` is empty;
- JavaScript button handlers, including asynchronous handlers;
- direct Grist UserAction arrays submitted atomically in their configured order;
- all buttons disabled while an action sequence is running;
- cursor movement after adding, updating, or removing records;
- removal navigation based on the widget's filtered and linked row context;
- configuration and runtime errors displayed with browser alerts;
- no external UI framework.

## Files

- `index.html`
- `style.css`
- `script.js`

Host these files as a static site, then use the `index.html` URL as the Grist custom widget URL.

## Setup

1. Add a Custom widget to a Grist page and select its source table.
2. Enter the hosted widget URL.
3. Grant the widget full document access.
4. In the widget's column mappings, map **Actions** to the column containing the button configuration.

The internal mapping name is `actionCol`. The mapped column may be an Any column or a formula column that returns button objects.

## Button configuration

For the selected record, the mapped cell may contain:

- `null` or an empty value to show no buttons;
- one button object;
- an array of button objects.

A button has this shape:

```javascript
{
  button: "Approve",
  description: "Approve the selected task",
  confirm: "Approve this task?",
  color: "#16B378",
  actions: [
    ["UpdateRecord", "Tasks", 12, {Status: "Approved"}]
  ]
}
```

Supported properties:

| Property | Required | Description |
| --- | --- | --- |
| `button` | Yes | Non-empty button label. |
| `actions` | Yes | Array of Grist UserActions, or a string containing JavaScript handler code. An empty array or blank string disables the button. |
| `description` | No | Native tooltip shown through the button's `title`. |
| `confirm` | No | A non-empty string displays a confirmation dialog before actions run. An empty string or `false` skips confirmation. Canceling performs no actions. |
| `color` | No | CSS background color. |

## UserActions

Every item in `actions` must be a Grist UserAction tuple:

```javascript
[ActionName, TableId, Records, Values]
```

- **ActionName** is the Grist data-engine action name, such as `AddRecord`,
  `UpdateRecord`, `RemoveRecord`, or a bulk variant.
- **TableId** is the string ID of the target table.
- **Records** is a row ID, an array of row IDs, or `null` when applicable.
- **Values** is an object whose shape depends on the action.

Examples:

```javascript
["AddRecord", "Tasks", null, {Name: "New task"}]
["UpdateRecord", "Tasks", 12, {Status: "Approved"}]
["RemoveRecord", "Tasks", 12]
["BulkUpdateRecord", "Tasks", [12, 13], {
  Status: ["Approved", "Approved"]
}]
```

Before execution, the widget checks that each action is an array containing at
least two items and starting with a string action name. Grist performs the
action-specific validation when the complete list is submitted atomically with:

```javascript
await grist.docApi.applyUserActions(actions);
```

While the request is running, all buttons are disabled to prevent duplicate
submissions. If cursor navigation subsequently fails, the widget reports that the
data changes succeeded and only cursor movement failed.

Malformed table ids, tuple lengths, row ids, values, and unsupported action names
are therefore reported as Grist runtime errors. The widget does not maintain its
own allowlist of Grist action names.

For the full list of action names, see
`grist-core/app/common/DocActions.ts` in the Grist source.

## JavaScript handlers

As an alternative to a UserAction array, `actions` may contain JavaScript code:

```javascript
{
  button: "Approve",
  actions: `
    const tableId = await widget.getSelectedTableId();
    const rowId = widget.requireCurrentRowId();

    await widget.applyUserActions([
      ["UpdateRecord", tableId, rowId, {Status: "Approved"}]
    ]);
  `
}
```

The string is compiled as the body of a strict asynchronous function when the
button configuration is rendered. This means that syntax errors are reported
immediately and that the handler may use top-level `await` and `return`. It has
access to the normal global `grist` API and to a frozen `widget` helper object:

```javascript
widget.getCurrentRecord();
widget.getCurrentRowId();
widget.getCurrentRecords();
widget.getCurrentRowsId();
widget.getSelectedTableId();
widget.requireCurrentRowId();
widget.sleep(500);
widget.applyUserActions(userActions);
widget.addNewRecord();
widget.removeCurrentRecord();
widget.openUrl(url);
```

- `getCurrentRecord()` returns the latest record received from `grist.onRecord()`,
  or `null` when no existing row is selected.
- `getCurrentRowId()` returns that record's id, or `null`.
- `getCurrentRecords()` returns the latest records received from `grist.onRecords()`,
  respecting the widget's filters and Select By context. It returns an empty array
  until records have been received.
- `getCurrentRowsId()` returns the existing row ids from `getCurrentRecords()`.
- `requireCurrentRowId()` returns the id or throws a clear error when there is no
  existing current row.
- `getSelectedTableId()` returns a Promise for the table id selected by the widget.
- `sleep(ms)` returns a Promise that resolves after the requested delay.
- `applyUserActions(userActions)` validates and applies the same UserAction arrays
  supported directly by `actions`. It preserves the widget's cursor behavior and
  resolves to Grist's unmodified `applyUserActions()` result.
- `addNewRecord()` and `removeCurrentRecord()` operate on the selected table, reuse
  `applyUserActions()`, and resolve to its result.
- `openUrl(url)` opens a new browser tab with `noopener,noreferrer`. Call it directly
  from the click handler, before an `await`, to avoid browser popup blocking.

JavaScript handlers run with this widget's full document access. They are not
sandboxed from the widget page and can also use browser globals such as `fetch`,
`alert`, `confirm`, and `prompt`. Only use handler strings written by people who
are trusted with the document; anyone who can change the mapped cell or its
formula can change the code that runs.

### Example: add a parent record and related 1:n records

This Grist Python formula creates an order and then two rows in `Order_Lines`.
The `Order` column in `Order_Lines` is a Reference to `Orders`:

```python
return {
  "button": "Create order",
  "actions": """
    const orderResult = await widget.applyUserActions([
      ["AddRecord", "Orders", null, {Customer: "Example customer"}]
    ]);
    const orderId = orderResult?.retValues?.[0];

    if (!Number.isFinite(orderId)) {
      throw new Error("Grist did not return the new order id.");
    }

    await widget.applyUserActions([
      ["BulkAddRecord", "Order_Lines", [null, null], {
        Order: [orderId, orderId],
        Product: ["Consulting", "Support"],
        Quantity: [1, 2]
      }]
    ]);
  """,
}
```

The calls are deliberately sequential because the child rows need the id returned
for the new parent. Consequently, this two-step operation is not atomic: if adding
the child rows fails, the parent already exists.

### Example: prompt for a value and update the current record

Use `prompt()` to request a value, `confirm()` for a yes/no question, and `alert()` to display a message:

```python
return {
  "button": "Set status",
  "actions": """
    const record = widget.getCurrentRecord();
    const rowId = widget.requireCurrentRowId();
    const status = prompt("New status:", record?.Status ?? "");

    if (status === null) return;

    const tableId = await widget.getSelectedTableId();
    await widget.applyUserActions([
      ["UpdateRecord", tableId, rowId, {Status: status}]
    ]);
  """,
}
```

`prompt()` always returns a string or `null`; parse and validate it explicitly
before updating numeric, date, or other non-text fields.

### Errors in handlers

No `try`/`catch` is needed by default. A synchronous error or rejected Promise
that escapes from a handler is displayed in an alert, and all buttons are restored
after the handler finishes:

```javascript
{
  button: "Delete",
  actions: `
    if (!confirm("Delete the selected record?")) return;
    await widget.removeCurrentRecord();
  `
}
```

Catch errors only when the handler can recover from them or needs to add context.
Rethrow after adding context if the widget should still display the failure.

## Validation and errors

The widget displays an alert when:

- `actionCol` is not mapped in the widget settings;
- the mapped column is not visible in the current view;
- the cell value is not `null`, a button object, or an array of button objects;
- a button is missing `button` or `actions`, or a property has an invalid type;
- an action is not an array, has fewer than two items, or does not start with a
  string action name;
- a JavaScript handler has invalid syntax;
- Grist rejects an action during execution.

Configuration errors clear the currently displayed buttons. Runtime errors from a
direct UserAction array leave the data unchanged because the complete list is
submitted atomically. A JavaScript handler may make several separate calls, so
earlier successful calls are not rolled back if a later one fails.

## Cursor behavior

Cursor movement is performed only when the action targets the table linked to the widget.

| Action | Cursor destination |
| --- | --- |
| `AddRecord` | Created row, using the ID returned by Grist when automatically assigned. |
| `BulkAddRecord` | Last created row, using the IDs returned by Grist when automatically assigned. |
| `UpdateRecord` | Supplied row ID. |
| `BulkUpdateRecord` | Last supplied row ID. |
| `RemoveRecord` | Next surviving row; if none exists, the previous surviving row. |
| `BulkRemoveRecord` | Next surviving row after the last supplied row ID; if none exists, the previous surviving row. |

Only removal actions take before-and-after snapshots with `fetchSelectedTable()`. This preserves the custom section's filters and Select By context when choosing the next or previous row.

## Formula example

The mapped column may use a Grist Python formula to build buttons dynamically:

```python
buttons = []

if $Status == "Draft":
  buttons.append({
    "button": "Approve",
    "description": "Mark this task as approved",
    "color": "#16B378",
    "actions": (
      ("UpdateRecord", "Tasks", $id, {"Status": "Approved"}),
    ),
  })

buttons.append({
  "button": "Delete",
  "description": "Delete this task",
  "confirm": "Delete this task?",
  "color": "#D0021B",
  "actions": (
    ("RemoveRecord", "Tasks", $id),
  ),
})

return buttons
```

### Extended helper example FIXME

This example builds add, remove, and bulk-update buttons with reusable helpers:

```python
buttons = []

def add_button(label, description, table, fields=None, color="Green"):
  fields = fields or {}
  actions = (("AddRecord", table, None, fields),)
  buttons.append({
    "button": label,
    "description": description,
    "actions": actions,
    "color": color,
  })

def remove_button(label, description, table, row_ids=None, color="Red"):
  if row_ids is None:
    if not $id:
      return
    row_ids = [$id]
  actions = (("BulkRemoveRecord", table, row_ids),)
  buttons.append({
    "button": label,
    "description": description,
    "actions": actions,
    "color": color,
  })

def update_button(label, description, table, row_ids=None, fields=None, color=None):
  if row_ids is None:
    if not $id:
      return
    row_ids = [$id]
  fields = fields or {}
  values = {key: [value] * len(row_ids) for key, value in fields.items()}
  actions = (("BulkUpdateRecord", table, row_ids, values),)
  buttons.append({
    "button": label,
    "description": description,
    "actions": actions,
    "color": color,
  })

add_button("+", "Create declaration", "Declarations")

if not $Has_services:
  remove_button("Delete", "Delete declaration", "Declarations")
elif not $Errors:
  update_button(
    "Submit",
    "Submit all valid draft services",
    "Services",
    row_ids=[
      record.id for record in Services.lookupRecords(
        Declaration=$id,
        Status="Draft",
      )
      if not record.Errors
    ],
    fields={"Status": "Submitted"},
  )

return buttons
```
