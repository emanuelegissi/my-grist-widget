# Dyncard Grist Custom Widget

Dyncard is a framework-free Grist custom widget that turns a per-record list of column names into an editable card. Each record may therefore show a different subset of the linked table while all values remain in their original Grist columns.

## Features

- Builds the card from a mapped Grist Choice List.
- Accepts an optional mapped Text column with per-record JSON options for the shown fields.
- Accepts only column IDs.
- Uses each column's Grist label, description, type, formula state, widget options, and document settings.
- Applies Grist cell colors and font styles, including conditional cell rules for the current record.
- Supports Text, Numeric, Int, Bool, Date, DateTime, Choice, Choice List, Ref, and RefList columns.
- Uses Grist's field alignment defaults and numeric value formats.
- Uses native browser controls for Bool, Date, DateTime, Choice, and Choice List fields.
- Supports HTML datalist suggestions for Text, Numeric, Int, Date, and DateTime fields.
- Saves edits automatically without a Save button.
- Shows Grist's `=` indicator for formula columns and keeps their calculated values non-editable.
- Shows configuration problems with an alert dialog.

## Grist setup

1. Add a Choice list column that defines which fields to show.
2. Optionally, add a Text column containing the JSON configuration described below.
3. Add Dyncard to the page and select the table containing those columns.
4. Link the widget to a record-selection widget if it should follow a selected row.
5. In the widget configuration, map the definition column to **Fields** and, if used,
   the JSON column to **Options**.
6. Grant **Full document access** when Grist asks for permission.

The widget edits existing records only. Selecting Grist's blank new-record row displays an empty panel.

The order in the **Fields** array is the order used in the card.

Every listed column must exist. Missing fields, and unsupported column types produce a configuration alert. A blank list shows an empty panel.

## Per-record options

**Options** is an optional Text mapping. Each non-blank value must be a JSON object keyed by Grist
column IDs. Options for IDs present in that record's **Fields** list are applied; all other entries
are ignored. Labels are not accepted because they can change independently of column IDs.

The supported field options are `datalist`, `pattern`, `placeholder`, `label`, `description`,
`required`, `readonly`, `multiline`, and `default`:

```json
{
  "Customer": {
    "label": "Customer name",
    "description": "The customer name used on invoices",
    "placeholder": "Enter a customer",
    "pattern": "[A-Za-z][A-Za-z .'-]+",
    "required": true,
    "default": "Acme",
    "datalist": ["Acme", "Globex", "Initech"]
  },
  "Hours": {
    "readonly": true,
    "datalist": [0.5, 1, 4, 8]
  },
  "Notes": {
    "multiline": true
  },
  "DueDate": {
    "datalist": ["2026-08-31", "2026-09-30"]
  },
  "StartsAt": {
    "datalist": ["2026-08-31T09:00", "2026-08-31T14:00"]
  }
}
```

| Option | Value | Behavior |
| --- | --- | --- |
| `datalist` | Array of strings or numbers | Provides native browser suggestions without restricting other valid input. |
| `pattern` | String | Requires the entire entered value to match the regular expression. |
| `placeholder` | String | Sets the empty-input hint. For Choice fields it labels the empty option. |
| `label` | String | Replaces the visible Grist field label and the control's accessible name. |
| `description` | String | Replaces the Grist field description shown in the info tooltip. An empty string removes the tooltip. |
| `required` | Boolean | Requires a non-empty value. A required Bool must be checked. |
| `readonly` | Boolean | Prevents the field from being edited or saved by Dyncard. |
| `multiline` | Boolean | Selects an expanding textarea (`true`) or one-line input (`false`) for Text fields. |
| `default` | Type-appropriate value | Prefills an empty field as a proposal without writing it automatically. |

`pattern` is available for Text, Numeric, Int, Date, DateTime, and Choice. Pattern matching follows
HTML's whole-value behavior. Numeric patterns are matched against the locale-aware editing value;
Date and DateTime patterns see the native input value. Empty values are checked by `required`, not
by `pattern`.

`placeholder` is available for the same field types as `pattern`. Native Date and DateTime controls
may choose not to display placeholder text.

`required` is available for every supported field type. If a required value is empty, or a value
does not match its configured pattern, Dyncard sets the input background to `#FD8182`, reports the
validation error, cancels any pending autosave, and does not write the value to Grist. Validation is
also reflected through `aria-invalid` and `aria-required`.

`readonly` makes editable Text, Numeric, Int, Date, and DateTime fields use native readonly controls.
Bool, Choice, and ChoiceList use disabled controls because HTML does not provide a readonly state for
them. Dyncard also blocks readonly fields in its save pipeline. Ref and RefList use the formula-field
behavior described below instead.

`default` must use the field's data type: a string for Text and Choice, a number for Numeric, an
integer for Int, a boolean for Bool, and an array of strings for ChoiceList. Date and DateTime accept
either a Unix timestamp in seconds or a native-format string. A default is shown only while the
stored value is empty and is saved only after the user accepts or changes the control. Since Grist
Bool values normally always contain `true` or `false`, a Bool default is used only if the received
value is actually null. Formula fields cannot use `default` because their calculated values are
read-only.

`datalist` is available for Text, Numeric, Int, Date, and DateTime fields and is implemented with
the native HTML `datalist` element. Suggestions do not constrain input: a user may still enter any
valid value. Numeric JSON numbers are converted to the document locale. Numeric strings should use
that locale. Date and DateTime strings should use the native input formats `YYYY-MM-DD` and
`YYYY-MM-DDTHH:mm[:ss]`; numeric values are treated as Unix timestamps in seconds.

Text fields use a one-line text input by default. Set `multiline: true` to use an expanding textarea.
Because HTML does not support a `datalist` on `textarea`, `multiline: true` cannot be combined with
`datalist` and produces a configuration alert. Omitting `multiline` or setting it to `false` keeps
the one-line input.

Configurations for columns absent from the current record's **Fields** list are ignored. This allows
one Options object to contain settings for every field that a record might display. For fields that
are present, malformed JSON, unsupported option names or field types, invalid patterns or defaults,
and non-array `datalist` values produce a configuration alert. An empty Options cell is the same as
`{}`.

## Supported field types

| Grist type | Card control | Empty value |
| --- | --- | --- |
| Text | One-line text input by default; expanding textarea with `multiline: true` | Empty string |
| Numeric | Locale-aware Grist numeric editor and formatter | `null` |
| Int | Locale-aware Grist integer editor and formatter | `null` |
| Bool | Native checkbox input | `false` |
| Date | Native `date` input | `null` |
| DateTime | Native `datetime-local` input | `null` |
| Choice | Native `select` dropdown | Empty string |
| ChoiceList | Group of native checkbox inputs | `null` when no choice is selected |
| Ref | Formula-style text input containing the referenced display value | Empty string |
| RefList | Formula-style text input containing comma-separated referenced display values | Empty string |

If a current Choice or Choice List value is absent from the column's configured choices, it remains available in the corresponding native control.

Ref and RefList controls use display text supplied by Grist when available. When the record contains
numeric reference IDs, Dyncard resolves them through the target table and the reference column's
configured visible column. A missing visible column or referenced row falls back to displaying the
row ID. RefList display values retain their stored order and are joined with a comma and space. Both
reference types use the same disabled `=` formula-field UI and save protection as Grist formula
columns.

All fields using the formula UI are displayed disabled and are never written by Dyncard.

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
