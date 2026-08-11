# Dynamic Card Grist Custom Widget

Dynamic Card is a framework-free Grist custom widget that turns a per-record list of column names into an editable card. Each record may therefore show a different subset of the linked table while all values remain in their original Grist columns.

## Features

- Builds the card from a mapped Grist Choice List or a JSON array.
- Accepts column IDs and unique column labels.
- Uses each column's Grist label, description, type, formula state, and configured choices.
- Supports Text, multiline Text, Numeric, Int, Bool, Date, DateTime, Choice, and Choice List columns.
- Saves edits automatically without a Save button.
- Renders formula columns as read-only.
- Uses Grist theme variables and adapts to narrow widget sizes.
- Shows configuration problems in an accessible alert panel.

## Grist setup

1. Add a column that defines which fields to show. A Choice List column is the most convenient option; a Text column containing JSON also works.
2. Add Dynamic Card to the page and select the table containing that column.
3. Link the widget to a record-selection widget if it should follow a selected row.
4. In the widget configuration, map the definition column to **Fields**.
5. Grant **Full document access** when Grist asks for permission.

The widget edits existing records only. Selecting Grist's blank new-record row displays an empty-state message.

## Fields column format

The mapped **Fields** value must be either:

- a Grist Choice List whose choices are column IDs or labels; or
- a JSON array stored in a Text column.

Example JSON value:

```json
["Name", "Surname", "Age", "Gender", "Weight", "Birthdate"]
```

The order in the array is the order used in the card.

### Column IDs and labels

A listed name is resolved in this order:

1. exact Grist column ID;
2. exact, unique column label.

Column IDs are recommended because labels can be changed and two columns may share the same label. If a label is ambiguous, the widget asks for a column ID instead.

Every listed column must exist and be readable under the current access rules. Blank lists, invalid JSON, non-string entries, duplicate names, missing fields, ambiguous labels, and unsupported column types produce a configuration alert.

If Grist omits a listed column from the selected-record event (for example, because it is not exposed by the custom section's view), Dynamic Card reads that value directly from the underlying selected table. Grist access rules still apply.

## Supported field types

| Grist type | Card control | Empty value |
| --- | --- | --- |
| Text | Single-line text input | Empty string |
| Text with the `TextBox` widget option | Resizable multiline input | Empty string |
| Numeric | Decimal number input | `null` |
| Int | Integer input | `null` |
| Bool | Toggle | `false` |
| Date | Date input | `null` |
| DateTime | Local date-and-time input | `null` |
| Choice | Drop-down using the column's configured choices | Empty string |
| ChoiceList | Multi-select choice chips | `null` when no choice is selected |

Choice colors are managed by Grist and are not reproduced by this widget. If a current Choice or Choice List value is absent from the column's configured choices, it is still included so that existing data remains visible.

Formula columns of these types are displayed but disabled, because their values are calculated by Grist.

## Autosave behavior

There is no Save or Revert button.

- Typing in Text, Numeric, and Int controls schedules a save after 350 ms.
- Changing or leaving those controls saves immediately.
- Toggle, Date, DateTime, Choice, and Choice List changes save immediately.
- Pending typed edits are flushed before the selected record changes.
- Grist update events reconcile inactive controls without replacing the control currently being edited.

A status line reports unsaved changes, saving, success, and failures. Invalid integers and numeric values remain in the control and are not sent to Grist.

## Permissions and data handling

Dynamic Card requests `requiredAccess: "full"` because it:

- reads the selected table's column metadata; and
- calls `grist.selectedTable.update()` to write edited values directly to their source columns.

The widget does not send table data to another service. Its only external dependency is Grist's official `grist-plugin-api.js`, loaded by `index.html`.

Updates are scoped to one field of the selected record. The definition column is only modified if it is itself included in its own Fields list and edited in the card.

## Date and Choice List values

The Grist Custom Widget API supplies Date and DateTime values as Unix timestamps in seconds. Dynamic Card converts them for native browser inputs and converts edited values back to seconds before saving. A DateTime control follows the browser's local timezone; Grist stores the resulting instant in UTC and applies the column timezone when displaying it elsewhere.

Choice List values received by the widget are normal JavaScript arrays. When saving, Dynamic Card uses Grist's typed list representation, `['L', ...choices]`.

## Troubleshooting

### “Map a table column to Fields”

Open the widget configuration and map the column that contains the dynamic field list.

### “Field ... does not exist”

Check spelling and prefer the stable column ID. Also confirm that the column belongs to the widget's linked table and is permitted by any access rules.

### “Unsupported Grist type”

The list includes a type outside the supported set, such as Ref, RefList, Attachments, or Any. Remove it from the list or store a display/edit value in a supported column.

### Choices are missing

Configure choices on the underlying Grist Choice or Choice List column. Dynamic Card reads them from that column's widget options.

### A value is read-only

Formula columns cannot be edited directly. Change the source fields used by the formula or convert the column to a data column in Grist.

## Files

```text
dynamic-card/
├── index.html    # Widget entry point and Grist API loader
├── script.js     # Rendering, validation, metadata, and autosave logic
├── style.css     # Grist-themed card controls and states
├── package.json  # Widget manifest metadata
└── README.md     # Setup and behavior documentation
```

The implementation uses only HTML, CSS, and vanilla JavaScript.
