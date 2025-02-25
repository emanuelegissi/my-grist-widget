"use strict"; // strict mode

const requestedCols =  ["Request_date", "Requested_by", "Request", "Process", "Status"];

// Duplicate request

export async function duplicateRequest(action, record) {
  return await duplicateRecordWrap({
    tableId: "Requests",
    record: record,
    cols: requestedCols,
    confirmText: `<${action.label}> confirmed?`,
  });
}

// Update request status, but only for selected tools

export async function updateRequestStatusOnlySel(action, record) {
  if (record.Unsel_goods_ids.length > 0) {  // are there unselected tools?
    // Ask for confirmation
    const confirmText = `Execute <${action.label}> on selected records only?`;
    if (!confirm(confirmText)) { return; }
    // Duplicate request
    const newId = await duplicateRecordWrap({
      tableId: "Requests",
      record: record,
      cols: requestedCols,
      confirmText: null,
      setCursor: false,
    });
    // Move unselected goods to duplicate request   
    await updateRecordsWrap({
      tableId: "Goods",  // children table to split
      ids: record.Unsel_goods_ids,   // list of unselected children ids in parent table
      fields: {"Request": newId, "Select": true},
      confirmText: null,
    });
  }
  // Update original request status
  await updateStatus(action, record);
}
