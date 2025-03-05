async function duplicateRecordWrap({tableId, record, cols=null, confirmText=null, setCursor=true}) {
  // filter new cols, eg. not formulas
  if (!cols) { cols = config.duplicateCols; }  // if empty, default to duplicateCols
  const fields = Object.fromEntries(  
    Object.entries(record).filter(([col]) => cols.includes(col))
  );
  return await addRecordWrap({tableId: tableId, fields: fields, confirmText: confirmText, setCursor: setCursor});
}

async function duplicateRecord(action, record) {
  if (!confirm(`Confirm <${action.label}>?`)) { return; }
  const cols = config.duplicateCols;
  const fields = Object.fromEntries(  
    Object.entries(record).filter(([col]) => cols.includes(col))
  );
  try {
    const res = await grist.selectedTable.create({fields: fields,});
    grist.setCursorPos({rowId: res.id});
  } catch (err) { throwErr(`Cannot execute <${action.label}>: ${err}`); }  
}
