# Grist Action Buttons

A small vanilla-JavaScript Grist custom widget that renders configurable action buttons for the selected record.

Use it by inserting the following link as the custom widget URL:

```text
https://emanuelegissi.github.io/my-grist-widget/actionbuttons
```

The widget requires full document access because its buttons apply Grist UserActions.

## Features

- configuration from one mapped Grist column;
- one button object or an array of buttons per record;
- optional button descriptions, confirmations, and background colors;
- disabled buttons when the action list is empty;
- Grist UserActions submitted atomically in their configured order;
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
| `actions` | Yes | Array of Grist UserActions. An empty array disables the button. |
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

## Validation and errors

The widget displays an alert when:

- `actionCol` is not mapped in the widget settings;
- the mapped column is not visible in the current view;
- the cell value is not `null`, a button object, or an array of button objects;
- a button is missing `button` or `actions`, or a property has an invalid type;
- an action is not an array, has fewer than two items, or does not start with a
  string action name;
- Grist rejects an action during execution.

Configuration errors clear the currently displayed buttons. Runtime action errors
leave the data unchanged because the complete list is submitted atomically.

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

### Extended helper example

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
