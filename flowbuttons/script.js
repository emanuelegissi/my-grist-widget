"use strict"; // strict mode

const config = {  // Configuration
  processCol: null,
  statusCol: null,
  errCol: null,
  actionsTable: "Actions",
  modulesTable: "Modules",
}

const cache = {  // Table cache
  modules: null,
  actions: null,
}

const data = {  // Vue data
  msgs: Vue.reactive([{id: 1, text: "Loading..."}]),
  btns: Vue.reactive([]),
};

// Utilities

function throwErr(text) {
  alert(`ERROR: ${text}`);
  throw new Error(text);
}

// Wrapper functions (for convenience)

async function addRecordWrap({tableId, fields={}, confirmText=null, setCursor=true}) {
  if (confirmText && !confirm(confirmText)) { return; }
  try {
    const res = await grist.getTable(tableId).create({fields: fields});
    if (setCursor) { grist.setCursorPos({rowId: res.id}); }
    return res.id;
  } catch (err) { throwErr(`Cannot add record in <${tableId}> table: ${err}`); }
}

async function delRecordsWrap({tableId, ids, confirmText=null}) { 
  if (confirmText && !confirm(confirmText)) { return; }
  try { grist.selectedTable.destroy(ids); }
  catch (err) { throwErr(`Cannot delete records in <${tableId}> table: ${err}`); }
};
  
async function updateRecordsWrap({tableId, ids, fields={}, confirmText=null}) {
    if (confirmText && !confirm(confirmText)) {return;}
    // from {"prop1": "val1", "prop2": "val2"} obtain:
    // {"prop1": ["val1", "val1"], "prop2": ["val1", "val1"], ...}
    const fss = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, Array(ids.length).fill(value)])
    );
    const actions = [["BulkUpdateRecord", tableId, ids, fss]];
  try {
    await grist.docApi.applyUserActions(actions);
  } catch (err) { throwErr(`Cannot update records in <${tableId}> table: ${err}`); }
}

async function duplicateRecordWrap({tableId, record, cols, confirmText=null, setCursor=true}) {
  if (confirmText && !confirm(confirmText)) {return;}
  // filter new cols, eg. not formulas
  const fields = Object.fromEntries(  
    Object.entries(record).filter(([col]) => cols.includes(col))
  );
  try {
      return await addRecordWrap({tableId: tableId, fields: fields, setCursor: setCursor});
  } catch (err) { alert(`Cannot duplicate record in <${tableId}> table: ${err}`); }
}

// Premade isactive functions

async function isValid(action, record) {
  return (!record[config.errCol]);  // no errors, validation ok  
}

// Premade onclick functions

async function addRecord(action, record) {
  const res = await grist.selectedTable.create({fields: {},});
  grist.setCursorPos({rowId: res.id});
}

async function delRecord(action, record) {
  if (!confirm("Delete record?")) { return; }
  grist.selectedTable.destroy([record.id]);
}

async function updateStatus(action, record) {
  await grist.selectedTable.update({
    id: record.id,
    fields: {[config.statusCol] : action.end_status},
  });
}

// Load tables

async function hasReqTables() {
  const reqTables = [config.modulesTable, config.actionsTable];
  const tables = await grist.docApi.listTables();
  for (let reqTable of reqTables) {
    if (!(tables.includes(reqTable))) { throwErr(`Missing <${reqTable}> table`); }
  }
  return true;
}

async function getTableData(tableId, reqCols=[]) {
  let tableData = null;
  let cols = null;
  try {
    tableData = await grist.docApi.fetchTable(tableId);
    cols = Object.keys(tableData);
  } catch (err) { throwErr(`While getting <${tableId}> table data: ${err}`); }
  for (let reqCol of reqCols) {
    if (!cols.includes(reqCol)) { throwErr(`Missing column <${reqCol}> in <${tableId}> table`); }
  }
  return tableData;
}

async function updateModules() {
  const modules = {};
  const tableId = config.modulesTable;
  const tableData = await getTableData(tableId, ["active", "name", "js"]);
  for (let i = 0; i < tableData.id.length; i++) {
    const active = tableData.active[i];
    if (!active) { continue; }
    const name = tableData.name[i];
    const js = tableData.js[i];
    if (!name || name in modules) { throwErr(`Empty or duplicated name <${name}> in <${tableId}> table`); }
    try {
      modules[name] = await import(`data:text/javascript,${js}`);
    } catch (err) { throwErr(`While importing <${name}> module: ${err}`); }
  }
  cache.modules = modules;
}

// Get the actual function from its name

function getActionFn(action, name) {
  const ps = name.split(".", 2);
  const length = ps.length;
  let fn = null;
  try {
    if (length == 2) { fn = cache.modules[ps[0]][ps[1]]; }  // module fn
    else if (length == 1 && ps[0]) { fn = window[ps[0]]; }  // global fn
    if (!fn) { throw new Error(`Function <${name}> not found`); }
    return fn;
  } catch(err) { throwErr(`Getting function <${name}> of <${action.label}> action: ${err}`); }
}

async function updateActions() {
  const actions = [];
  const tableId = config.actionsTable;
  const tableData = await getTableData(
    tableId,
    ["processes", "label", "desc", "color", "isactive", "onclick", "start_status", "end_status", "id", "manualSort"],
  );
  const cols = Object.keys(tableData);
  // Prepare action record
  if (!cache.modules) { await updateModules(); }
  for (let i = 0; i < tableData.id.length; i++) {
    const action = {};
    for (const col of cols) {
      action[col] = tableData[col][i];
    }
    // Check action values
    if (!action.label) { throwErr(`Missing label in action`); }
    if (!Array.isArray(action.processes) || action.processes[0] !== "L") {
      throwErr(`<${tableId}> table <processes> column is not a <Choice List>.`);
    }
    action.processes.shift();  // remove "L"
    // Save the actual function instead of its name
    if (!action.onclick) { throwErr(`Missing onclick fn in <${action.label}> action`); }
    action.onclick = getActionFn(action, action.onclick);
    if (action.isactive) { action.isactive = getActionFn(action, action.isactive); }
    // Push to list of actions
    actions.push(action);
  }
  actions.sort((a, b) => a.manualSort - b.manualSort);
  cache.actions = actions;
}

async function updateMsgs(record) {
  data.msgs.length = 0;  // empty the list
  const errText = record[config.errCol]; 
  if (errText) {
    const msg = {id: record.id, text: errText};
    data.msgs.push(msg);  // refill
  }
}

async function updateBtns(record) {
  // Refresh actions
  if (!cache.actions) { await updateActions(); }
  // Prepare action buttons
  const btns = [];
  for (let action of cache.actions) {
    // Action available in this record process?
    if (!action.processes || !action.processes.includes(record[config.processCol])) { continue; }
    // Action available in this record status?
    if (action.start_status && action.start_status != record[config.statusCol]) { continue; }
    // Action active?
    if (action.isactive && !(await action.isactive(action, record))) { continue; }
    // Create relative button
    const btn = {};
    Object.assign(btn, action); // shallow copy
    // Replace fn with fn(action, record)
    btn.onclick = () => action.onclick(action, record);
    btns.push(btn);
  }
  // Refill data.btns view
  data.btns.length = 0;  // empty the list
  data.btns.push(...btns);  // refill
}

// Vue app

async function loadVueApp() {
  const { createApp } = Vue;
  const app = createApp({
    data() { return {
      msgs: data.msgs,
      btns: data.btns,
    }; },
  });
  app.mount('#app');
}

// Execute the widget

function onRecord(record, mappings) {
  // Get mappings
  if (
    mappings["processCol"] &&
    mappings["statusCol"] &&
    mappings["errCol"]) {
    config.processCol = mappings["processCol"];
    config.statusCol = mappings["statusCol"];
    config.errCol = mappings["errCol"];
  } else {
    // req columns not mapped.
    throwErr("Missing column mapping in widget settings");
  }
  // Update UI
  updateMsgs(record);
  updateBtns(record);
}

function onNewRecord(record, mappings) {
  // Set msgs
  data.msgs.length = 0;  // empty the list
  const msg = {id: 0, text: "New record"};
  data.msgs.push(msg);  // refill
  // Set btns
  data.btns.length = 0;  // empty the list  
}

function ready(fn) {
  if (document.readyState !== 'loading') { fn(); }
  else { document.addEventListener('DOMContentLoaded', fn); }
}

ready(async function() {
  // Check tables
  if (!hasReqTables()) { return; }
  // Create Vue app
  loadVueApp();
  // Configure Grist
  grist.onRecord(onRecord);
  grist.onNewRecord(onNewRecord);
  grist.ready({
    columns: [
      // See: https://support.getgrist.com/widget-custom/#column-mapping
      {
        name: "processCol",
        title: "Process",
        optional: false,
        type: "Choice",
        description: "Chosen process for the request",
        allowMultiple: false,
      },
      {
        name: "statusCol",
        title: "Status", 
        optional: false,
        type: "Choice",
        description: "Status of the process request",
        allowMultiple: false,
      },
      {
        name: "errCol",
        title: "Error", 
        optional: false,
        type: "Text",
        description: "Record validation displaying error message",
        allowMultiple: false,
      },
      {
        name: "availableCols",
        title: "Available to JS modules", 
        optional: false,
        type: "Any",
        description: "Available columns for javascript modules",
        allowMultiple: true,
      },
    ],
    requiredAccess: 'full',
    allowSelectBy: true});
});
