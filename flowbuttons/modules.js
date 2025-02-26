"use strict"; // strict mode

// Update request status, but only for selected tools

const unselCol = "Unsel_goods_ids";

export async function updateRequestStatusOnlySel(action, record) {
  const l = record[unselCol].length;
  if (l > 0) {  // are there unselected tools?
    // Ask for confirmation
    const confirmText = `Confirm <${action.label}> on selected records only?\n(${l} unselected)`;
    if (!confirm(confirmText)) { return; }
    try {
      // Duplicate request
      const newId = await duplicateRecordWrap({
        tableId: "Requests",
        record: record,
        cols: config.duplicateCols,
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
    } catch (err) { throwErr(`Cannot execute <${action.label}>: ${err}`) }
  }
  // Update original request status
  await updateStatus(action, record);
}
