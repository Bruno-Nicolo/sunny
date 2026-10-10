# PDF annotations

`createPdfViewer.ts` owns the PDF document: loading, passwords, permissions, navigation,
saving, and disposal. It creates one annotation controller per viewer, initializes it after
`pagesinit`, forwards tool options, and commits pending edits before saving.

`createAnnotationController.ts` composes the tools. It owns readiness, permission and active-tab
checks, maps the selected tool to a PDF.js mode, and coordinates undo/redo with editor UI updates.
All subscriptions share the viewer's `AbortSignal` and are released when that viewer is destroyed.

`editorEvents.ts` is the shared PDF.js editor event adapter. It provides typed subscriptions,
parameter commands, active/selected editor access, commit, history commands, and confirmed mode
changes. `enterMode` waits for PDF.js confirmation and rejects on interruption, timeout, or disposal;
it releases its temporary subscription in each case. Feature modules use this adapter rather than
dispatching events or accessing the raw event bus.

The tool directories own their behavior and presentation:

- `highlight/`: PDF.js palette configuration, color commands, and toolbar controls.
- `images/`: file validation, image insertion, file input, clipboard, and drop routing.
- `text/`: editor selection, formatting, dirty tracking, focus handling, settings menu, and styles.

`AnnotationToolbar.tsx` composes these controls. `AnnotationToolButton.tsx` shares toggle behavior,
accessibility attributes and tooltips. The document toolbar handles page and zoom controls;
`App.tsx` owns preferences and passes active-document access to `useImageInsertion`.

## Adding a tool

1. Add a directory with its editor behavior and UI. Use `EditorEvents` for PDF.js communication;
   add event payload types to the adapter only when the new behavior requires them.
2. Compose the behavior in `createAnnotationController.ts` and the controls in
   `AnnotationToolbar.tsx`. For a persistent toggle, extend `AnnotationTool` and the mode mapping.
   Keep one-shot commands, such as inserting an image, separate from persistent tool selection.
3. Cover asynchronous event/lifecycle behavior with unit tests and editing/saving with an Electron
   integration test. Run the existing tool suites to check selection, tab isolation, undo/redo,
   focus, and resource cleanup.
