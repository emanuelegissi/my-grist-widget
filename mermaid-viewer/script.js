"use strict"; // strict mode

function loadVueApp() {
  const app = Vue.createApp({
    data() {
      return {
        svgContent: "",
        mermaidInitialized: false,

        // Pan and zoom state
        zoomScale: 1,
        panX: 0,
        panY: 0,
        minZoom: 0.2,
        maxZoom: 5,
        isPanning: false,
        activePointerId: null,
        pointerStartX: 0,
        pointerStartY: 0,
        panStartX: 0,
        panStartY: 0
      };
    },

    methods: {
      // Initialize Mermaid only once
      initMermaid() {
        if (!this.mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false
          });

          this.mermaidInitialized = true;
        }
      },

      // Render the Mermaid diagram
      async runMermaid(graphDefinition) {
        this.initMermaid();

        try {
          const tempContainerId = "mermaid-temp";

          const { svg } = await mermaid.render(
            tempContainerId,
            graphDefinition
          );

          return svg;
        } catch (error) {
          const msg = `Error rendering Mermaid diagram: ${error}`;

          console.error(msg);

          return `<p>${msg}</p>`;
        }
      },

      // Return the widget element used as the diagram viewport
      getViewport() {
        return document.getElementById("app");
      },

      // Return the Mermaid SVG currently displayed in the widget
      getDiagramSvg() {
        return this.getViewport()?.querySelector("svg") || null;
      },

      // Prepare the newly rendered SVG for pan and zoom transforms
      setupPanZoom(resetView = true) {
        const viewport = this.getViewport();
        const svg = this.getDiagramSvg();

        if (!viewport || !svg) {
          return;
        }

        // Configure the outer viewport
        viewport.style.overflow = "hidden";
        viewport.style.position = "relative";
        viewport.style.cursor = "grab";
        viewport.style.userSelect = "none";
        viewport.style.touchAction = "none";

        // Configure the Mermaid SVG
        svg.style.display = "block";
        svg.style.maxWidth = "none";
        svg.style.transformOrigin = "0 0";
        svg.style.willChange = "transform";

        if (resetView) {
          this.resetView();
        } else {
          this.applyTransform();
        }
      },

      // Apply the current translation and scale to the Mermaid SVG
      applyTransform() {
        const svg = this.getDiagramSvg();

        if (!svg) {
          return;
        }

        svg.style.transform =
          `translate(${this.panX}px, ${this.panY}px) ` +
          `scale(${this.zoomScale})`;
      },

      // Zoom around the current mouse position
      onWheel(event) {
        if (!this.getDiagramSvg()) {
          return;
        }

        event.preventDefault();

        const viewport = this.getViewport();
        const rect = viewport.getBoundingClientRect();

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        /*
         * Smooth exponential zoom.
         *
         * Increase 0.0015 for faster zooming.
         * Decrease 0.0015 for slower zooming.
         */
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);

        const oldScale = this.zoomScale;

        const newScale = Math.min(
          this.maxZoom,
          Math.max(
            this.minZoom,
            oldScale * zoomFactor
          )
        );

        if (newScale === oldScale) {
          return;
        }

        /*
         * Adjust the translation so that the point underneath
         * the mouse cursor remains stationary while zooming.
         */
        const scaleRatio = newScale / oldScale;

        this.panX =
          mouseX -
          (mouseX - this.panX) * scaleRatio;

        this.panY =
          mouseY -
          (mouseY - this.panY) * scaleRatio;

        this.zoomScale = newScale;

        this.applyTransform();
      },

      // Start panning when the left mouse button is pressed
      onPointerDown(event) {
        if (
          event.button !== 0 ||
          !this.getDiagramSvg()
        ) {
          return;
        }

        /*
         * Do not start panning when the user clicks an interactive
         * element inside the Mermaid diagram.
         */
        if (
          event.target.closest?.(
            "a, button, input, textarea, select"
          )
        ) {
          return;
        }

        event.preventDefault();

        const viewport = this.getViewport();

        this.isPanning = true;
        this.activePointerId = event.pointerId;

        this.pointerStartX = event.clientX;
        this.pointerStartY = event.clientY;

        this.panStartX = this.panX;
        this.panStartY = this.panY;

        viewport.style.cursor = "grabbing";

        viewport.setPointerCapture?.(
          event.pointerId
        );
      },

      // Move the diagram while the mouse is being dragged
      onPointerMove(event) {
        if (
          !this.isPanning ||
          event.pointerId !== this.activePointerId
        ) {
          return;
        }

        event.preventDefault();

        this.panX =
          this.panStartX +
          event.clientX -
          this.pointerStartX;

        this.panY =
          this.panStartY +
          event.clientY -
          this.pointerStartY;

        this.applyTransform();
      },

      // Stop panning when the mouse button is released
      onPointerUp(event) {
        if (
          event.pointerId !== this.activePointerId
        ) {
          return;
        }

        const viewport = this.getViewport();

        this.isPanning = false;
        this.activePointerId = null;

        viewport.style.cursor = "grab";

        if (
          viewport.hasPointerCapture?.(
            event.pointerId
          )
        ) {
          viewport.releasePointerCapture(
            event.pointerId
          );
        }
      },

      // Reset the diagram to its original size and position
      resetView() {
        this.zoomScale = 1;
        this.panX = 0;
        this.panY = 0;

        this.applyTransform();
      },

      // Process a selected Grist record
      async onRecord(record) {
        try {
          /*
           * Map the Grist record using the column mapping
           * configured for this widget.
           */
          const mapped =
            grist.mapColumnNames(record);

          if (!mapped.mermaid) {
            const msg =
              "Missing 'mermaid' column.";

            console.error(msg);

            this.svgContent =
              `<p>${msg}</p>`;

            return;
          }

          const graphDefinition =
            mapped.mermaid;

          this.svgContent =
            await this.runMermaid(
              graphDefinition
            );

          /*
           * Wait until Vue has inserted the newly rendered
           * Mermaid SVG into the page.
           */
          await this.$nextTick();

          this.setupPanZoom(true);
        } catch (error) {
          const msg =
            `Error rendering Mermaid diagram: ${error}`;

          console.error(msg);

          this.svgContent =
            `<p>${msg}</p>`;
        }
      },

      // Clear the diagram when Grist creates a new record
      onNewRecord() {
        this.svgContent = "No content";

        this.zoomScale = 1;
        this.panX = 0;
        this.panY = 0;
      }
    },

    mounted() {
      /*
       * Register the Grist event listeners after the
       * Vue component has been mounted.
       */
      grist.onRecord(this.onRecord);
      grist.onNewRecord(this.onNewRecord);

      const viewport = this.getViewport();

      /*
       * Store references to the handlers so that the listeners
       * can be removed cleanly if the component is unmounted.
       */
      this.panZoomHandlers = {
        wheel: event => {
          this.onWheel(event);
        },

        pointerDown: event => {
          this.onPointerDown(event);
        },

        pointerMove: event => {
          this.onPointerMove(event);
        },

        pointerUp: event => {
          this.onPointerUp(event);
        },

        doubleClick: () => {
          this.resetView();
        }
      };

      viewport.addEventListener(
        "wheel",
        this.panZoomHandlers.wheel,
        {
          passive: false
        }
      );

      viewport.addEventListener(
        "pointerdown",
        this.panZoomHandlers.pointerDown
      );

      viewport.addEventListener(
        "pointermove",
        this.panZoomHandlers.pointerMove
      );

      viewport.addEventListener(
        "pointerup",
        this.panZoomHandlers.pointerUp
      );

      viewport.addEventListener(
        "pointercancel",
        this.panZoomHandlers.pointerUp
      );

      viewport.addEventListener(
        "dblclick",
        this.panZoomHandlers.doubleClick
      );
    },

    beforeUnmount() {
      const viewport = this.getViewport();

      if (
        !viewport ||
        !this.panZoomHandlers
      ) {
        return;
      }

      viewport.removeEventListener(
        "wheel",
        this.panZoomHandlers.wheel
      );

      viewport.removeEventListener(
        "pointerdown",
        this.panZoomHandlers.pointerDown
      );

      viewport.removeEventListener(
        "pointermove",
        this.panZoomHandlers.pointerMove
      );

      viewport.removeEventListener(
        "pointerup",
        this.panZoomHandlers.pointerUp
      );

      viewport.removeEventListener(
        "pointercancel",
        this.panZoomHandlers.pointerUp
      );

      viewport.removeEventListener(
        "dblclick",
        this.panZoomHandlers.doubleClick
      );
    }
  });

  app.mount("#app");
}


// Execute the widget

function configureGristSettings() {
  loadVueApp();

  grist.ready({
    requiredAccess: "read table",
    columns: ["mermaid"]
  });
}


function ready(fn) {
  if (document.readyState !== "loading") {
    fn();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      fn
    );
  }
}


ready(() => {
  configureGristSettings();
});
