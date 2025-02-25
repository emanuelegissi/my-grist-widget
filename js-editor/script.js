"use strict"; // strict mode

let oldRecord = null;
let jsField = null;
let editor = null;

function loadAceEditor() {
  editor = ace.edit("editor");
  editor.setTheme("ace/theme/monokai-light");
  editor.session.setMode("ace/mode/javascript");
  editor.setFontSize(14);
  editor.session.setTabSize(2);
  editor.setOption("wrap", true);
  editor.setOptions({
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: true
  });
}

function save(record) {
  const js = editor.getValue();
  grist.selectedTable.update(
    {id: record.id, fields: {[jsField]: js}}
  );
};

function onRecord(record, mappings) {
  // Set mappings
  jsField = mappings["jsField"];
  // Save old record
  if (oldRecord) { save(oldRecord) };
  // Load new record
  editor.setReadOnly(false);
  editor.setValue(record[jsField], -1);
  // Set current as old record
  oldRecord = record;
  // Set save button onclick fn
  const btn = document.getElementById('saveBtn');
  btn.onclick = () => save(record);
  btn.disabled = false;
}

function onNewRecord(record) {
  // Save old record
  if (oldRecord) { save(oldRecord) };
  // Load empty record
  editor.setReadOnly(true);
  editor.setValue("", -1);
  // Set none as old record
  oldRecord = none;
  // Set save button disabled
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
}

// Execute the widget

function configureGristSettings() {
  grist.onRecord(onRecord);
  grist.onNewRecord(onNewRecord);
  grist.ready({
      requiredAccess: 'full',
      columns: [
      {
        name: "jsField",
        title: "Javascript", 
        optional: false,
        type: "Text",
        description: "Javascript code",
        allowMultiple: false,
      },
    ],
  });
}

function ready(fn) {
  if (document.readyState !== 'loading') { fn(); }
  else { document.addEventListener('DOMContentLoaded', fn); }
}

ready( () => {
  loadAceEditor()
  configureGristSettings();
});


