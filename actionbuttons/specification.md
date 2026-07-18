# Specification of Grist actionbuttons custom widget

This widget renders one or more **configurable, colored action buttons** 
for the currently selected record.

When the user clicks a button, the widget executes the button’s configured actions.
While actions are running, **all buttons are disabled** to prevent double-clicks.
Any configuration or runtime error is shown via a browser **alert**.

## Data source and column mapping

The widget reads its configuration from a single mapped column
named **`actionCol`** (configured in the widget settings).

For the selected record, the cell value of `actionCol` may be:

* `null` / empty → **no buttons**
* a **single button object**
* an **array of button objects**

The widget validates the cell content and alerts a **meaningful error** if it is invalid.

## Button definition

Each button is an object with the following schema:

```js
{button: "Label", actions: [ ... ], description: "Tooltip text", color: "#1486ff"}
```

Note that:

* If `actions` is an **empty array** (`[]`), the button is rendered **disabled**.
* `description` is optional and is displayed as the button's native tooltip.
* `color` is an optional CSS color string, applied as the button background.

## Action list

`actions` is an array of **Grist UserActions** (data engine actions).

When a button is clicked:

1. Actions are executed **one at a time**, in the same order in which they appear in the `actions` array.
2. Each **Grist UserAction** is submitted separately using `grist.docApi.applyUserActions([action])`.
3. The widget waits for each action to finish before starting the next action.

While executing, the widget disables all buttons until completion.

If an action fails, the widget stops the sequence and does not execute later actions. Actions that completed earlier remain applied because every Grist UserAction is a separate document operation.

### Grist UserAction

A Grist UserAction is an array in the form:

```js
[ActionName, TableId, Records, Values]
```

Where:

* **ActionName**: string name of the action (e.g. `"AddRecord"`, `"UpdateRecord"`, `"RemoveRecord"`, `"BulkUpdateRecord"`, etc.)
* **TableId**: string table id
* **Records**: an integer record id, or an array of integer record ids (or `null` when applicable)
* **Values**: an object of column values (shape depends on action)

Examples:

* `["AddRecord", "Table1", null, {"Name": "Alice", "Age": 20}]`
* `["RemoveRecord", "Table1", 18]`
* `["BulkUpdateRecord", "Table1", [1, 2, 3], {"Name": ["A","B","C"], "Age": [1, 2, 3]}]`

For the full list of supported action names, see Grist source: `grist-core/app/common/DocActions.ts`.

After each Grist UserAction, the widget moves the cursor when that action targets the table linked to the widget:

* `AddRecord` / `BulkAddRecord`: the last created row, using the row ids returned by Grist when ids are assigned automatically
* `UpdateRecord` / `BulkUpdateRecord`: the last supplied row id
* `RemoveRecord` / `BulkRemoveRecord`: a nearby surviving row, preferring the next row and then the previous row; bulk removal uses the last supplied row id as its reference point

Only removal actions take before-and-after table snapshots. They use `fetchSelectedTable()`, so the next/previous record is determined from the custom section's filtered and linked row context.

## Validation rules summary

The widget alerts errors when:

* `actionCol` is not mapped in widget settings
* the selected record does not contain the mapped column (e.g., column not visible)
* the cell value is not `null`, an object, or an array of objects
* a button is missing required keys (`button`, `actions`) or has invalid types
* any item in `actions` is not one of the supported action formats above

## Example actionCol

```python
BS = []  # buttons

def ab(label, desc, table, fs=None, color="Green"):  # add record button
  fs = fs is not None and fs or {}
  acts = (("AddRecord", table, None, fs),)
  BS.append({"button": label, "description": desc, "actions": acts, "color": color})

def rb(label, desc, table, rs=None, fs=None, color="Red"):  # rm record button
  if rs is None:
    if not rec: return
    rs = [rec]
  fs = fs is not None and fs or {}
  acts = (("BulkRemoveRecord", table, [r.id for r in rs]),)
  BS.append({"button": label, "description": desc, "actions": acts, "color": color})

def ub(label, desc, table, rs=None, fs=None, color=None):  # update record button
  if rs is None:
    if not rec: return
    rs = [rec]
  fs = fs is not None and fs or {}
  acts = (("BulkUpdateRecord", table, [r.id for r in rs], {k: [v, ] * len(rs) for k, v in fs.items()}),)  
  BS.append({"button": label, "description": desc, "actions": acts, "color": color})

# Buttons

ab("+", "Crea dichiarazione", "Dichiarazioni")

if not $Ha_prestazioni:
    rb("Elimina", "Elimina dichiarazione", "Dichiarazioni")
else:
  if not $Errori:
    ub("Invia a TEP", "Firma e invia tutte le prestazioni", "Prestazioni",
      rs=[r for r in Prestazioni.lookupRecords(Dichiarazione=$id, Stato="Bozza") if not r.Errori],
      fs={"Stato": "TEP"},
    )

return BS
```
