"use strict"; // strict mode

const app = Vue.createApp({
  data() {
    return {
      svgContent: "",
      mermaidInitialized: false
    };
  },
  methods: {
    // Initialize Mermaid only once
    initMermaid() {
      if (!this.mermaidInitialized) {
        mermaid.initialize({ startOnLoad: false });
        this.mermaidInitialized = true;
      }
    },
    // Render the Mermaid diagram
    async runMermaid(graphDefinition) {
      this.initMermaid();
      try {
        const tempContainerId = 'mermaid-temp';
        const { svg } = await mermaid.render(tempContainerId, graphDefinition);
        return svg;
      } catch (error) {
        const msg = `Error rendering Mermaid diagram: ${error}`
        console.error(msg);
        this.svgContent = `<p>${msg}</p>`;
      }
    },
    // Process a new record
    async onRecord(record) {
      try {
        // Map record columns using Grist's API
        const mapped = grist.mapColumnNames(record);
        if (!mapped.mermaid) {
          const msg = "Missing 'mermaid' column."
          console.error(msg);
          this.svgContent = `<p>${msg}</p>`;
          return;
        }
        const graphDefinition = mapped.mermaid;
        this.svgContent = await this.runMermaid(graphDefinition);
      } catch (error) {
        const msg = `Error rendering Mermaid diagram: ${error}`
        console.error(msg);
        this.svgContent = `<p>${msg}</p>`;
      }
    },
    // Clear the rendered diagram on new record
    onNewRecord(record) {
      this.svgContent = "No content";
    }
  },
  mounted() {
    // Register Grist event listeners once the Vue component is mounted.
    grist.onRecord(this.onRecord);
    grist.onNewRecord(this.onNewRecord);
    grist.ready({ requiredAccess: 'read table', columns: ["mermaid"] });
  }
});

// Mount the Vue app to the DOM element with id "app"
app.mount('#app');

