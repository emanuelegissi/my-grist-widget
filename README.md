# my-grist-widget repository

This repository contains my custom widgets for the [Grist framework](https://www.getgrist.com/).

## Actionbuttons widget

This widget renders one or more **configurable, colored action buttons** 
for the currently selected record. When the user clicks a button, the widget executes the button’s configured actions.

See an application example [here](). FIXME

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/actionbuttons

The widget reads its configuration from a single mapped column
named **`actionCol`** (configured in the widget settings).

For the selected record, the cell value of `actionCol` may be:

* **no buttons**: `null`
* a **single button object**: `{button: "Label", actions: [ ... ], description: "Tooltip", color: "#1486ff"}`
* an **array of button objects**: `[{button: ...}, {button: ...}, ...]`

Button `actions` is an array whose items can be **any combination** of the following action types:

1. **Grist UserAction** (data engine action)
2. **New record action**
3. **Go to page action**

### Grist UserAction 

A Grist UserAction is an array in the form:

```js
[ActionName, TableId, Records, Values]
```

for example:

* `["AddRecord", "Table1", null, {"Name": "Alice", "Age": 20}]`
* `["RemoveRecord", "Table1", 18]`
* `["BulkUpdateRecord", "Table1", [1, 2, 3], {"Name": ["A","B","C"], "Age": [1, 2, 3]}]`

For the full list of supported action names, see Grist source: `grist-core/app/common/DocActions.ts`.

### New record action

A New record action is:

```js
["NewRecord"]
```

This action creates/selects a new record by setting the cursor position.

### Go to page action

A Go to page action is:

```js
["Link", url, target]
```
Examples:

* `["Link", "https://example.com"]`, opened in the same browser tab;
* `["Link", "https://example.com", "_blank"]`, opened in a new browser tab.

## Flowbuttons widget

This widget creates configurable buttons for workflow management.
See an application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc).

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/flowbuttons

Then create the two configuration tables, named `Flowactions` and `Flowmodules`.
The structure of the two tables should correspond exactly to those of the application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc).

See further documentation [here](https://github.com/emanuelegissi/my-grist-widget/wiki/Flowbuttons-widget).

## JS editor widget

This widget adds a very simple Javascript editor.

See an application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc) in the Flowmodules view. 

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/js-editor

## Mermaid viewer widget

This widget adds a very simple Mermaid viewer.

It is based on the work of [nicobako](https://github.com/nicobako/grist-widgets/tree/main/mermaid).
I had to develop a new widget with Vue.js integration, because the original one had some visualization issues.

See an application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc) in the Flowactions view. 

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/mermaid-viewer

