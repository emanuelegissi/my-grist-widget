# Grist JS Buttons

A simple vanilla-JavaScript Grist custom widget that renders configurable JavaScript buttons.

## Features

- no column mapping;
- compact Grist-style button row;
- very small configuration button on the right side of the widget panel;
- Monaco editor for the JavaScript configuration panel;
- configuration saved either locally in widget options or shared through a Grist table;
- optional creation of the shared configuration table when it does not exist;
- dynamic JavaScript configuration through `function get_buttons()`;
- synchronous and asynchronous `onclick` handlers;
- button labels, tooltips, text colors, background colors, hidden state, and disabled state;
- all buttons disabled while an action is running.

## Files

- `index.html`
- `styles.css`
- `script.js`

Host these files as a static site, then use the `index.html` URL as the Grist custom widget URL.

The widget loads Monaco Editor from jsDelivr:

```html
<script defer src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
```

If Monaco cannot be loaded, the widget falls back to a plain text editor.

## Configuration sources

The configuration panel supports two modes.

### Local widget options

The JavaScript code is saved in this widget instance's Grist widget options. This is best for one-off buttons.

### Shared Grist table

The JavaScript code is saved in a normal Grist table so multiple widget instances can reuse the same button configuration.

Default shared table:

```text
JS_Button_Configs
```

Required columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `Name` | Text | Configuration name, for example `default`, `admin`, or `records`. |
| `Code` | Text | JavaScript code defining `function get_buttons()`. |

If the configured shared table does not exist, the configuration panel shows a **Create table** button. It creates a data table without adding a document page, adds the required columns, and inserts the current editor code as the first named configuration.

When using shared mode:

- **Load** reads the selected `Name` from the shared table into the existing JavaScript editor;
- **Save** writes the editor code back to the shared table;
- if the named configuration does not exist but the table exists, **Save** creates a new row for it.

## Configuration API

The configuration code must define:

```javascript
function get_buttons() {
  return [];
}
```

It may return an array, `null`, an empty array, or a Promise resolving to one of those values.

Each visible, enabled button needs at least:

```javascript
{
  label: "Button label",
  onclick: () => {
    // action
  }
}
```

Supported properties:

- `label`
- `onclick`
- `title`
- `color`
- `background_color`
- `disabled`
- `hidden`

The widget requests full document access so configuration code can run document-changing actions through `widget.applyUserActions()`.

## Object available to configuration code

The configuration code receives access to the normal global `grist` object and one additional object named `widget`.

No separate `helpers` object is exposed. The `widget` object intentionally contains only general helper methods:

```javascript
widget.getCurrentRecord();
widget.getCurrentRowId();
widget.getSelectedTableId();
widget.requireCurrentRowId();
widget.sleep(500);
widget.applyUserActions(userActions);
widget.addNewRecord();
widget.removeCurrentRecord();
widget.openUrl(url);
```

`widget.applyUserActions(userActions)` applies Grist user actions, detects newly created row ids when possible, moves the Grist cursor to the last affected Add/Update row, and after `RemoveRecord`/`BulkRemoveRecord` moves the cursor to a nearby surviving row.

Specific example actions still belong in the editable configuration code. The default `DEFAULT_CONFIG_CODE` defines example functions such as:

```javascript
async function add_records_with_user_actions() { ... }
async function update_current_record_with_user_actions() { ... }
async function remove_current_record_after_confirm() { ... }
```

Then `get_buttons()` wires buttons to those functions or directly to general widget helpers such as `widget.addNewRecord()` and `widget.openUrl(url)`.

When `get_buttons()` returns `null`, `[]`, or only hidden buttons, the panel remains empty except for the small configuration button.
