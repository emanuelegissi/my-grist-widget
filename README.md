# my-grist-widget repository

This repository contains my custom widgets for the [Grist framework](https://www.getgrist.com/).

## Flowbuttons widget

This widget creates configurable buttons for workflow management.
See an application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc).

Use it by inserting the following link as widget custom URL:
https://emanuelegissi.github.io/my-grist-widget/flowbuttons

Then create the two configuration tables, named `Flowactions` and `Flowmodules`.
The structure of the two tables should correspond exactly to those of the application example [here](https://docs.getgrist.com/iFLERrF5h1rd/Approval-workflow?utm_id=share-doc).

See more documentazion [here](https://github.com/emanuelegissi/my-grist-widget/wiki/Flowbuttons-widget).

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

