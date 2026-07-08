# Grist JS Buttons

A simple vanilla-JavaScript Grist custom widget that renders configurable buttons.

## Features

- no column mapping;
- compact Grist-style button row;
- very small configuration button on the right side of the widget panel;
- Monaco editor for the JavaScript configuration panel;
- configuration saved in Grist widget options;
- dynamic JavaScript configuration through `function get_buttons()`;
- synchronous and asynchronous `onclick` handlers;
- button labels, tooltips, text colors, background colors, hidden state, and disabled state;
- all buttons disabled while an action is running.

The widget loads Monaco Editor from jsDelivr:

```html
<script defer src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
```

If Monaco cannot be loaded, the widget falls back to a plain text editor.

## Install

Use the following URL as the Grist custom widget URL:

```html
https://emanuelegissi.github.io/my-grist-widget/js-buttons
```

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

`widget.applyUserActions(userActions)` is the single user-action helper. It applies the actions, detects newly created row ids when possible, and moves the Grist cursor to the last affected row.

Specific example actions still belong in the editable configuration code. The default `DEFAULT_CONFIG_CODE` defines example functions such as:

```javascript
async function add_records_with_user_actions() { ... }
async function update_current_record_with_user_actions() { ... }
async function remove_current_record_after_confirm() { ... }
```

Then `get_buttons()` wires buttons to those functions or directly to general widget helpers such as `widget.addNewRecord()` and `widget.openUrl(url)`.

When `get_buttons()` returns `null`, `[]`, or only hidden buttons, the panel remains empty except for the small configuration button.
