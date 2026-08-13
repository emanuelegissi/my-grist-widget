# Dyncard Grist Custom Widget

Dyncard is a framework-free Grist custom widget that turns a per-record list of column names into an editable card. Each record may therefore show a different subset of the linked table while all values remain in their original Grist columns.

## Features

- Builds the card from a mapped Grist Choice List.
- Accepts only column IDs.
- Uses each column's Grist label, description, type, formula state, widget options, and document settings.
- Applies Grist cell colors and font styles, including conditional cell rules for the current record.
- Supports Text, Numeric, Int, Bool, Date, DateTime, Choice, and Choice List columns.
- Uses Grist's field alignment defaults and numeric value formats.
- Uses native browser controls for Bool, Date, DateTime, Choice, and Choice List fields.
- Saves edits automatically without a Save button.
- Shows Grist's `=` indicator for formula columns and keeps their calculated values non-editable.
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
| Bool | Native checkbox input | `false` |
| Date | Native `date` input | `null` |
| DateTime | Native `datetime-local` input | `null` |
| Choice | Native `select` dropdown | Empty string |
| ChoiceList | Group of native checkbox inputs | `null` when no choice is selected |

If a current Choice or Choice List value is absent from the column's configured choices, it remains available in the corresponding native control.

Formula columns of these types are displayed but disabled, because their values are calculated by Grist.

## Autosave behavior

There is no Save or Revert button.

- Typing in Text, Numeric, and Int controls schedules a save after 350 ms. Numeric editors use the document locale while active, then restore the configured Grist display format.
- Changing or leaving those controls saves immediately.
- Bool, Date, DateTime, Choice, and Choice List changes save immediately.
- Pending typed edits are flushed before the selected record changes.
- Grist update events reconcile inactive controls without replacing the control currently being edited.

## Permissions and data handling

Dynamic Card requests `requiredAccess: "full"` because it:

- reads the selected table's column metadata; and
- calls `grist.selectedTable.update()` to write edited values directly to their source columns.

The widget does not send table data to another service. It loads Grist's official `grist-plugin-api.js`, Moment, and Moment Timezone. The currency lookup from Grist's pinned `locale-currency` package is embedded locally so the widget can start without a cross-origin module import.

Updates are scoped to one field of the selected record. The definition column is only modified if it is itself included in its own Fields list and edited in the card.

## Date and Choice List values

The Grist Custom Widget API supplies Date and DateTime values as Unix timestamps in seconds. Dyncard exposes them through the browser's native `date` and `datetime-local` controls. DateTime conversion uses the timezone embedded in the Grist column type, falling back to the document timezone, and converts the result back to Unix seconds before saving.

Numeric and integer values use the document locale and currency plus the column's `numMode`, `numSign`, `decimals`, `maxDecimals`, and `currency` options. Their formatters, parsers, and relevant field CSS are direct browser ports from the latest grist-core.

Only the custom-widget boundary is local code: it reads table metadata and selected records through
the public Grist API, builds persistent controls in the iframe, and writes edited values back to the
selected table. Internal grist-core classes cannot be imported into a custom-widget iframe because
they depend on Grist's private document model, view records, command system, and build-time modules.

Choice List values received by the widget are normal JavaScript arrays. When saving, Dynamic Card uses Grist's typed list representation, `['L', ...choices]`.

## Files

```text
dyncard/
├── index.html    # Widget entry point and Grist API loader
├── script.js     # Rendering, validation, metadata, and autosave logic
├── style.css     # Shared field CSS
├── package.json  # Widget manifest metadata
└── README.md     # Setup and behavior documentation
```

The implementation uses only HTML, CSS, and vanilla JavaScript.
