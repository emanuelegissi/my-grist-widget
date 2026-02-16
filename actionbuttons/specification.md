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
* `description` is optional and is displayed as a tooltip (implementation dependent: native tooltip or custom tooltip).
* `color` is an optional CSS color string, applied as the button background.

## Action list

`actions` is an array whose items can be **any combination** of the following action types:

1. **Grist UserAction** (data engine action)
2. **New record action**
3. **Go to page action**

When a button is clicked:

1. All **Grist UserActions** found in the `actions` array are executed first in **one single batch** using `grist.docApi.applyUserActions(...)`.
2. After that batch completes, the widget executes the remaining actions (**NewRecord** and **Link**) **in the same order they appear** in the `actions` array.

While executing, the widget disables all buttons until completion.

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

If the UserAction batch contains one or more `"AddRecord"` actions, the widget sets the cursor to the **last** created record **only if** that AddRecord targets the **same table the widget is linked to**.

### New record action

A New record action is:

```js
["NewRecord"]
```

This action creates/selects a new record by setting the cursor position to:

```js
await grist.setCursorPos({ rowId: "new" });
```

---

### Go to page action

A Go to page action is:

```js
["Link", url, target]
```

Where:

* **url**: string URL to open
* **target** (optional): if omitted/empty, open in the same tab; if `"_blank"`, open in a new tab (other targets behave like `window.open` targets)

Examples:

* `["Link", "https://example.com"]`
* `["Link", "https://example.com", "_blank"]`

## Validation rules summary

The widget alerts errors when:

* `actionCol` is not mapped in widget settings
* the selected record does not contain the mapped column (e.g., column not visible)
* the cell value is not `null`, an object, or an array of objects
* a button is missing required keys (`button`, `actions`) or has invalid types
* any item in `actions` is not one of the supported action formats above

