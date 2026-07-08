# Dynamic Card Grist Custom Widget

A vanilla JavaScript Grist custom widget that displays a dynamic card with editable fields.
The card layout follows the visual structure of a standard Grist Card widget: compact labels, stacked fields, small help icons, and immediate editing.

The widget reads a JSON card definition from a mapped text column and stores the edited values as JSON in another mapped text column.

## Features

* Dynamic card layout based on JSON configuration.
* Grist Card-like look and feel.
* Immediate autosave after editing.
* No Save or Revert buttons.
* Data saved as formatted JSON.
* Field-level help using the native browser `title` tooltip on the round `i` icon.
* Supported field types:

  * `text`
  * `integer`
  * `numeric`
  * `toggle`
  * `choice`
* Optional autocomplete for text-like fields.
* Choice fields with simple or labelled options.
* Preserves existing JSON keys that are not currently visible in the card.
* Vanilla JavaScript only. No Vue, React, or external framework.

## Required Grist columns

The linked Grist table must include two text columns.

| Column        | Type | Purpose                                  |
| ------------- | ---: | ---------------------------------------- |
| `DynCardDef`  | Text | JSON definition of the dynamic card.     |
| `DynCardData` | Text | JSON data collected by the dynamic card. |

The widget uses Grist column mapping, so the actual table columns may have different names, but they must be mapped to:

* `DynCardDef`
* `DynCardData`

## Widget permissions

The widget requires full access because it writes edited data back to the linked Grist table.

```javascript
grist.ready({
  requiredAccess: "full",
  columns: COLUMN_DEFS
});
```

## Basic usage

1. Add the `index.html` and `widget.js` files to your custom widget.
2. Add the custom widget to a Grist page.
3. Select the table that contains the records.
4. Map the dynamic card definition column to `DynCardDef`.
5. Map the dynamic card data column to `DynCardData`.
6. Select a record.
7. Edit values directly in the dynamic card.
8. The widget automatically saves the data to `DynCardData`.

## Example `DynCardDef`

```json
{
  "title": "Dettaglio prestazione",
  "help": "Compila i dati della prestazione.",
  "fields": [
    {
      "key": "comune_partenza",
      "label": "Comune partenza",
      "type": "text",
      "help": "Comune di partenza della prestazione.",
      "autocomplete": [
        "Sassari",
        "Alghero",
        "Olbia",
        "Tempio Pausania",
        "Porto Torres"
      ]
    },
    {
      "key": "comune_arrivo",
      "label": "Comune arrivo",
      "type": "text",
      "help": "Comune di arrivo della prestazione.",
      "autocomplete": [
        "Sassari",
        "Alghero",
        "Olbia",
        "Tempio Pausania",
        "Porto Torres"
      ]
    },
    {
      "key": "mezzo_proprio",
      "label": "Mezzo proprio",
      "type": "toggle",
      "help": "Indica se è stato utilizzato il mezzo proprio."
    },
    {
      "key": "tipo_veicolo",
      "label": "Tipo veicolo",
      "type": "choice",
      "help": "Seleziona la tipologia di veicolo.",
      "choices": [
        "APS",
        "ABP",
        "CA",
        "AF"
      ]
    },
    {
      "key": "km",
      "label": "Chilometri",
      "type": "integer",
      "min": 0,
      "step": 1,
      "unit": "km",
      "help": "Distanza percorsa.",
      "autocomplete": [
        10,
        25,
        50,
        100
      ]
    },
    {
      "key": "importo",
      "label": "Importo",
      "type": "numeric",
      "min": 0,
      "step": 0.01,
      "unit": "€",
      "help": "Importo in euro."
    },
    {
      "key": "nota",
      "label": "Nota",
      "type": "text",
      "multiline": true,
      "help": "Eventuali note aggiuntive."
    }
  ]
}
```

## Example saved `DynCardData`

After editing the card, the widget stores data like this:

```json
{
  "comune_partenza": "Sassari",
  "comune_arrivo": "Olbia",
  "mezzo_proprio": true,
  "tipo_veicolo": "APS",
  "km": 100,
  "importo": 35.75,
  "nota": "Viaggio effettuato con mezzo proprio."
}
```

## Dynamic card definition format

A `DynCardDef` value must be a JSON object.

```json
{
  "title": "Card title",
  "help": "Optional card-level help text.",
  "fields": []
}
```

### Top-level properties

| Property |   Type | Required | Description                                          |
| -------- | -----: | -------: | ---------------------------------------------------- |
| `title`  | string |       No | Optional card title.                                 |
| `help`   | string |       No | Optional help text shown on the card title `i` icon. |
| `fields` |  array |      Yes | List of field definitions. Must not be empty.        |

## Field definition format

Each field must be an object inside the `fields` array.

```json
{
  "key": "field_key",
  "label": "Field label",
  "type": "text"
}
```

### Common field properties

| Property      |   Type | Required | Description                                                           |
| ------------- | -----: | -------: | --------------------------------------------------------------------- |
| `key`         | string |      Yes | JSON key used in `DynCardData`. Must be unique.                       |
| `label`       | string |       No | Label shown above the field. Defaults to `key`.                       |
| `type`        | string |       No | Field type. Defaults to `text`.                                       |
| `help`        | string |       No | Help text shown through the field `i` icon.                           |
| `placeholder` | string |       No | Placeholder text for text-like fields or empty choice option.         |
| `default`     |    any |       No | Default value shown when the key is missing or null in `DynCardData`. |
| `unit`        | string |       No | Unit displayed after the field, for example `km`, `€`, or `m²`.       |

## Supported field types

### `text`

A single-line text field.

```json
{
  "key": "comune",
  "label": "Comune",
  "type": "text"
}
```

### Multiline `text`

A multiline text field using `textarea`.

```json
{
  "key": "nota",
  "label": "Nota",
  "type": "text",
  "multiline": true
}
```

### `integer`

An integer numeric field.

```json
{
  "key": "km",
  "label": "Chilometri",
  "type": "integer",
  "min": 0,
  "max": 500,
  "step": 1,
  "unit": "km"
}
```

Empty integer fields are saved as `null`.

The old field type `"number"` is not supported. Use `"integer"` instead.

### `numeric`

A decimal numeric field.

```json
{
  "key": "importo",
  "label": "Importo",
  "type": "numeric",
  "min": 0,
  "step": 0.01,
  "unit": "€"
}
```

Empty numeric fields are saved as `null`.

### `toggle`

A boolean checkbox field.

```json
{
  "key": "mezzo_proprio",
  "label": "Mezzo proprio",
  "type": "toggle"
}
```

Toggle fields are saved as:

```json
true
```

or:

```json
false
```

### `choice`

A select/dropdown field.

```json
{
  "key": "tipo_veicolo",
  "label": "Tipo veicolo",
  "type": "choice",
  "choices": [
    "APS",
    "ABP",
    "CA",
    "AF"
  ]
}
```

The selected value is saved as a string.

If no value is selected, the field is saved as `null`.

## Labelled choices

Choice fields may also use objects with separate `value` and `label`.

```json
{
  "key": "esito",
  "label": "Esito",
  "type": "choice",
  "choices": [
    {
      "value": "ok",
      "label": "Regolare"
    },
    {
      "value": "warning",
      "label": "Con osservazioni"
    },
    {
      "value": "ko",
      "label": "Non regolare"
    }
  ]
}
```

This saves only the `value`:

```json
{
  "esito": "warning"
}
```

## Autocomplete

Fields may define an `autocomplete` array.

```json
{
  "key": "comune_partenza",
  "label": "Comune partenza",
  "type": "text",
  "autocomplete": [
    "Sassari",
    "Alghero",
    "Olbia",
    "Tempio Pausania",
    "Porto Torres"
  ]
}
```

Autocomplete works with text-like inputs:

* `text`
* multiline `text`
* `integer`
* `numeric`

For `integer` and `numeric` fields, autocomplete values may be numbers:

```json
{
  "key": "km",
  "label": "Chilometri",
  "type": "integer",
  "autocomplete": [
    10,
    25,
    50,
    100
  ]
}
```

Autocomplete values may be strings, numbers, or booleans. They are internally converted to strings for matching and display.

Choice fields do not use `autocomplete`; they use `choices`.

## Autosave behavior

The widget saves data automatically.

For text-like fields:

* typing schedules autosave;
* leaving the field saves immediately;
* changing the field saves immediately.

For toggle and choice fields:

* changes are saved immediately.

The autosave delay is controlled by:

```javascript
const AUTOSAVE_DELAY_MS = 300;
```

## Data preservation

When saving, the widget updates only the keys visible in the current dynamic card and preserves any existing keys already stored in `DynCardData`.

For example, if `DynCardData` contains:

```json
{
  "a": "old",
  "b": "hidden"
}
```

and the current `DynCardDef` only shows field `a`, saving the card will preserve `b`.

This is useful when different record types use different dynamic card definitions.

## Dynamic definitions by record type

`DynCardDef` can be a Grist formula column.

For example, a Grist formula may return a different JSON definition depending on a `$Type` column.

Conceptually:

```python
if $Type == "Trasferta":
  return """{
    "title": "Trasferta",
    "fields": [
      {
        "key": "comune_partenza",
        "label": "Comune partenza",
        "type": "text"
      },
      {
        "key": "km",
        "label": "Chilometri",
        "type": "integer"
      }
    ]
  }"""
else:
  return """{
    "title": "Dati generali",
    "fields": [
      {
        "key": "nota",
        "label": "Nota",
        "type": "text",
        "multiline": true
      }
    ]
  }"""
```

## Validation rules

The widget validates the dynamic card definition before rendering it.

The following conditions produce configuration errors:

* `DynCardDef` is empty.
* `DynCardDef` is not valid JSON.
* `DynCardDef` is not a JSON object.
* `fields` is missing or empty.
* a field is missing `key`.
* two fields use the same `key`.
* a field key is unsafe, for example `__proto__`, `prototype`, or `constructor`.
* a field uses an unsupported `type`.
* a `choice` field has no `choices` array.
* autocomplete is not an array.
* numeric constraints such as `min` or `max` are not valid numbers.

## Supported field types summary

| Type      | Stored value | Empty value | Notes                                |
| --------- | -----------: | ----------: | ------------------------------------ |
| `text`    |       string |        `""` | Supports multiline and autocomplete. |
| `integer` |       number |      `null` | Must be an integer.                  |
| `numeric` |       number |      `null` | Allows decimal values.               |
| `toggle`  |      boolean |     `false` | Checkbox field.                      |
| `choice`  |       string |      `null` | Uses `choices`.                      |

## Unsupported field types

The widget does not support the old field type:

```json
{
  "type": "number"
}
```

Use this instead:

```json
{
  "type": "integer"
}
```

or, for decimal values:

```json
{
  "type": "numeric"
}
```

## File structure

```text
dynamic-card-widget/
├── index.html
└── widget.js
```

## `DynCardDef` vs `DynCardData`

`DynCardDef` describes the card.

```json
{
  "title": "Example",
  "fields": [
    {
      "key": "name",
      "label": "Name",
      "type": "text"
    }
  ]
}
```

`DynCardData` stores the values.

```json
{
  "name": "Mario Rossi"
}
```

## Notes

* The widget is designed for a linked selected record.
* It does not create new records.
* It does not edit columns directly, except for the mapped `DynCardData` column.
* The visible card is rebuilt when the selected Grist record changes.
* While editing, the widget tries to avoid unnecessary re-rendering after its own autosave update.
* Help text uses the native browser tooltip through the `title` attribute.
* The widget is intentionally framework-free and uses only vanilla JavaScript.

