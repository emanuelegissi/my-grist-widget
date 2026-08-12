# Dyncard Grist Custom Widget

Dyncard is a framework-free Grist custom widget that turns a per-record list of column names into an editable card. Each record may therefore show a different subset of the linked table while all values remain in their original Grist columns.

## Features

- Builds the card from a mapped Grist Choice List.
- Accepts only column IDs.
- Uses each column's Grist label, description, type, formula state, widget options, and document settings.
- Supports Text, Numeric, Int, Bool, Date, DateTime, Choice, and Choice List columns.
- Uses Grist's field alignment defaults and original value formats.
- Reproduces configured Choice colors and font styles with Grist-style tokens.
- Saves edits automatically without a Save button.
- Shows Grist's `=` indicator for formula columns and keeps their calculated values non-editable.
- Uses CSS adapted directly from grist-core's Form DetailView, shared `field_clip`, and field widgets.
- Shows configuration problems with an alert dialog.

## Grist setup

1. Add a Choice list column that defines which fields to show.
2. Add Dyncard to the page and select the table containing that column.
3. Link the widget to a record-selection widget if it should follow a selected row.
4. In the widget configuration, map the definition column to **Fields**.
5. Grant **Full document access** when Grist asks for permission.

The widget edits existing records only. Selecting Grist's blank new-record row displays an empty panel.

The order in the **Fields** array is the order used in the card.

Every listed column must exist. Missing fields, and unsupported column types produce a configuration alert. A blank list shows an empty panel.

## Supported field types

| Grist type | Card control | Empty value |
| --- | --- | --- |
| Text | One-row textarea that expands with its content | Empty string |
| Numeric | Locale-aware Grist numeric editor and formatter | `null` |
| Int | Locale-aware Grist integer editor and formatter | `null` |
| Bool | The column's Grist Checkbox or Switch | `false` |
| Date | Formatted text input with a calendar popup | `null` |
| DateTime | Split formatted date/time editor with a calendar popup | `null` |
| Choice | Drop-down with the selected Grist choice token | Empty string |
| ChoiceList | Grist token field with a multi-select menu | `null` when no choice is selected |

If a current Choice or Choice List value is absent from the column's configured choices, it remains visible with Grist's invalid-choice style.

Formula columns of these types are displayed but disabled, because their values are calculated by Grist.

## Autosave behavior

There is no Save or Revert button.

- Typing in Text, Numeric, and Int controls schedules a save after 350 ms. Numeric editors use the document locale while active, then restore the configured Grist display format.
- Changing or leaving those controls saves immediately.
- Toggle, Date, DateTime, Choice, and Choice List changes save immediately.
- Pending typed edits are flushed before the selected record changes.
- Grist update events reconcile inactive controls without replacing the control currently being edited.

Invalid integers and numeric values remain in the control and are not sent to Grist.

## Permissions and data handling

Dynamic Card requests `requiredAccess: "full"` because it:

- reads the selected table's column metadata; and
- calls `grist.selectedTable.update()` to write edited values directly to their source columns.

The widget does not send table data to another service. It loads Grist's official `grist-plugin-api.js` and the same pinned jQuery, Moment, Moment Timezone, and Bootstrap Datepicker versions used by grist-core.

Updates are scoped to one field of the selected record. The definition column is only modified if it is itself included in its own Fields list and edited in the card.

## Date and Choice List values

The Grist Custom Widget API supplies Date and DateTime values as Unix timestamps in seconds. Dyncard formats them with the original column's `dateFormat` and `timeFormat`. DateTime editing uses the timezone embedded in the Grist column type, falling back to the document timezone, and converts the result back to Unix seconds before saving.

Numeric and integer values use the document locale and currency plus the column's `numMode`, `numSign`, `decimals`, `maxDecimals`, and `currency` options. The implementation is adapted from grist-core's `NumberFormat`, `NumberParse`, `NumericEditor`, `DateEditor`, `DateTimeEditor`, `Toggle`, and Choice token widgets.

Choice List values received by the widget are normal JavaScript arrays. When saving, Dynamic Card uses Grist's typed list representation, `['L', ...choices]`.

## Files

```text
dyncard/
├── index.html    # Widget entry point and Grist API loader
├── script.js     # Rendering, validation, metadata, and autosave logic
├── style.css     # grist-core field, editor, token, toggle, and datepicker CSS
├── package.json  # Widget manifest metadata
└── README.md     # Setup and behavior documentation
```

The implementation uses only HTML, CSS, and vanilla JavaScript.
