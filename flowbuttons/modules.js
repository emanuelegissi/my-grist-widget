"use strict"; // strict mode

// FIXME I wish this could be done programmatically
// but the current API does not seem to allow it
// We need the record column, and special treatment for fields

function getRequestFields(record) {
    const r = record[config.recordCol];
    r.Children.rowIds.unshift("L");
    r.Parents.rowIds.unshift("L");
    r.RefList.rowIds.unshift("L");
    return {
      "Children": r.Children.rowIds,  // two-way
      "Parents": r.Parents.rowIds,  // two-way
      "Reference": r.Reference.rowId, // ref
      "RefList": r.RefList.rowIds, // ref
      "Process": r.Process,
      "Request": r.Request,
      "Request_date": r.Request_date,
      "Requested_by": r.Requested_by,
      "Status": r.Status,
      // "Error": null,  // formula
      // "Unsel_goods_ids": [],  // formula
      // "id": 6, // id
    };
}

// Duplicate request

export async function duplicateRequest(action, record) {
  const fields = getRequestFields(record);
  try {
    const newId = await addRecordWrap({
      tableId: "Requests",
      record: record,
      fields: fields,
      confirmText: null,
      setCursor: true,
    });
  } catch (err) { throwErr(`Cannot execute «${action.label}»: ${err}`) }
}

// Update request status, but only for selected tools

const unselCol = "Unsel_goods_ids";

export async function updateRequestStatusOnlySel(action, record) {
  const len = record[unselCol].length;
  if (len > 0) {  // are there unselected tools?
    // Ask for confirmation
    const confirmText = `Confirm «${action.label}» on selected records only?\n(${len} unselected)`;
    if (!confirm(confirmText)) { return; }
    try {
      // Duplicate request
      const fields = getRequestFields(record);
      const newId = await addRecordWrap({
        tableId: "Requests",
        record: record,
        fields: fields,
        confirmText: null,
        setCursor: false,
      });
      // Move unselected goods to duplicate request   
      await updateRecordsWrap({
        tableId: "Goods",  // children table to split
        ids: record[unselCol],   // list of unselected children ids in parent table
        fields: {"Request": newId, "Select": true},
        confirmText: null,
      });
    } catch (err) { throwErr(`Cannot execute «${action.label}»: ${err}`) }
  }
  // Update original request status
  await updateStatus(action, record);
}
