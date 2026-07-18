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
- optional button descriptions and background colors;
- disabled buttons when the action list is empty;
- Grist UserActions executed one at a time in their configured order;
- all buttons disabled while an action sequence is running;
- cursor movement after adding, updating, or removing records;
- removal navigation based on the widget's filtered and linked row context;
- configuration and runtime errors displayed with browser alerts;
- no external UI framework.

## Files

- `index.html`
- `style.css`
- `script.js`
- `specification.md`

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
| `color` | No | CSS background color. |

## UserActions

Every item in `actions` must be a Grist UserAction tuple:

```javascript
[ActionName, TableId, Records, Values]
```

Examples:

```javascript
["AddRecord", "Tasks", null, {Name: "New task"}]
["UpdateRecord", "Tasks", 12, {Status: "Approved"}]
["RemoveRecord", "Tasks", 12]
["BulkUpdateRecord", "Tasks", [12, 13], {
  Status: ["Approved", "Approved"]
}]
```

Actions are validated before execution, then submitted separately with:

```javascript
await grist.docApi.applyUserActions([action]);
```

The widget waits for each action to finish before executing the next one. If an action fails, later actions are not executed, while earlier successful actions remain applied.

Only Grist data-engine UserActions are supported. The pseudo-actions `["NewRecord"]` and `["Link", ...]` are not supported.

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
  "color": "#D0021B",
  "actions": (
    ("RemoveRecord", "Tasks", $id),
  ),
})

return buttons
```

For the complete validation and behavior contract, see [`specification.md`](specification.md).
