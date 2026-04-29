# Grist Tree Table Custom Widget

A Grist custom widget that displays a one-to-many self-referencing table as a collapsible tree, while still showing selected columns in a table-like editable view.

The widget is designed to look and behave similarly to a standard Grist table, with selectable records, editable cells, resizable columns, column descriptions, formula-column indicators, and optional row highlighting.

## Features

- Displays records as a collapsible tree.
- Supports parent/child relationships using a self-reference column.
- Allows branches to be folded and unfolded.
- Keeps expanded/collapsed state between widget reloads.
- Selects the corresponding Grist record when a row or cell is clicked.
- Shows additional mapped columns chosen by the user.
- Supports editable `Text`, `Int`, `Numeric`, and `Bool` columns.
- Supports an editable text `Label` column.
- Shows formula columns as read-only.
- Displays a small `=` badge for formula columns.
- Shows column labels instead of raw column IDs.
- Shows column description hints using an `i` icon.
- Allows column resizing.
- Highlights the selected column header.
- Optionally highlights rows using an `Error` boolean column.
- Handles cycles and unreachable records defensively.

## Required Table Structure

The source table must contain records arranged in a self-referencing hierarchy.

A typical table should contain at least:

| Column | Type | Purpose |
|---|---|---|
| `Parent` | `Ref` or `Int` | Points to the parent record. Empty means root record. |
| `Label` | `Text` | The visible tree label. Editable in the widget. |

Additional columns may be shown and edited through the `Shown columns` mapping.

## Widget Configuration

After adding the custom widget to a Grist page, open the widget configuration panel and map the following fields.

### Required mappings

| Widget mapping | Expected Grist type | Description |
|---|---:|---|
| `Parent` | `Ref` or `Int` | The self-reference parent column. |
| `Label` | `Text` | The editable label shown in the tree. |

### Optional mappings

| Widget mapping | Expected Grist type | Description |
|---|---:|---|
| `Shown columns` | `Text`, `Int`, `Numeric`, `Bool` | Columns to display and edit in the table area. Multiple columns may be selected. |
| `Error` | `Bool` | If true, the entire row is filled with `#FD8182`. |

## Showing the Error Column

The `Error` mapping controls row highlighting.

The `Error` column is only displayed as a visible column if it is also selected in `Shown columns`.

Examples:

| Error mapped? | Error selected in Shown columns? | Result |
|---|---|---|
| Yes | No | Row is highlighted when true, but the column is hidden. |
| Yes | Yes | Row is highlighted when true, and the Error column is visible/editable. |
| No | No | No error highlighting. |

## Editing Data

The following fields are editable directly in the widget:

- `Label`
- mapped `Shown columns` of type:
  - `Text`
  - `Int`
  - `Numeric`
  - `Bool`

Formula columns are automatically shown as read-only. They display a small `=` badge similar to Grist’s default table widget.

## Tree Behavior

Records with an empty `Parent` value are shown as root records.

Records with a `Parent` value are shown as children of the corresponding parent record.

Branches can be expanded or collapsed using the arrow icon next to each parent record.

The expanded/collapsed state is saved as a widget option, so it persists when the widget reloads.

## Selection Behavior

Clicking a row or cell selects the corresponding Grist record.

The selected row is highlighted, and the selected column header becomes slightly darker.

The widget uses Grist cursor linking, so selection should stay synchronized with other linked Grist widgets.

## Column Widths

Columns can be resized by dragging the right edge of the column header.

Column widths are saved as widget options and restored when the widget reloads.

## Column Labels and Descriptions

The widget attempts to read Grist column metadata so that it can display:

- the column label instead of the raw column ID;
- the column description using an `i` icon in the header;
- whether a column is a formula column.

If metadata cannot be read, the widget falls back to showing the raw column ID.

## Formula Columns

Formula columns cannot be edited.

When a shown column is a formula column:

- the value is displayed as read-only;
- a small `=` badge appears on the left side of the cell;
- no update is sent to Grist when the cell is clicked.

## Supported Column Types

The widget is intentionally limited to simple editable column types:

| Type | Supported? | Notes |
|---|---|---|
| `Text` | Yes | Editable as text. |
| `Int` | Yes | Editable as a number input. |
| `Numeric` | Yes | Editable as a number input. |
| `Bool` | Yes | Editable as a checkbox. |
| Formula versions of supported types | Read-only | Displayed with `=` badge. |

Other Grist types such as references, choice lists, dates, attachments, and lists are not currently supported as editable shown columns.

## Cycle and Data Safety

The widget includes defensive handling for problematic tree structures.

If a cycle is detected, the recursive branch is stopped and a warning is shown.

If a record is not reachable from a root record, it is shown as a top-level record and a warning is shown.

## Installation

Create a new Grist custom widget using the Grist Custom Widget Builder.

Paste the provided HTML code into the HTML panel.

Paste the provided JavaScript code into the JavaScript panel.

Set widget access to allow full document access, because the widget needs to update cell values.

Then configure the column mappings in the widget configuration panel.

## Required Access

The widget requires full access because it can update records.

It edits values using Grist’s selected table API.

## Notes and Limitations

- The `Label` column must be a `Text` column.
- The `Parent` column should normally be a self-reference column.
- Formula columns are visible but not editable.
- Only simple primitive columns are supported in `Shown columns`.
- Column metadata is read from Grist metadata tables when available.
- The widget does not create or delete records.
- The widget does not currently support drag-and-drop reordering or changing a record’s parent from within the tree.

## Recommended Setup

A simple starting table could be:

| Column ID | Type | Description |
|---|---|---|
| `Parent` | Reference to same table | Parent record. |
| `Label` | Text | Tree label. |
| `Notes` | Text | Optional editable notes. |
| `Order` | Int | Optional numeric order. |
| `Done` | Bool | Optional checkbox. |
| `Error` | Bool | Optional row error flag. |

Then map:

| Widget mapping | Grist column |
|---|---|
| `Parent` | `Parent` |
| `Label` | `Label` |
| `Shown columns` | `Notes`, `Order`, `Done`, optionally `Error` |
| `Error` | `Error` |
