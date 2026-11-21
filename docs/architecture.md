# Architecture

- `src/shared/contracts.ts`: document, session, save request, and preload API types shared by all processes.
- `src/shared/shortcuts.ts`: central shortcut configuration shared by native menus and the renderer.
- `src/main/index.ts`: Electron startup and application lifecycle.
- `src/main/window.ts` and `menu.ts`: native window and application menus.
- `src/main/ipc.ts` and `pdf-dialogs.ts`: IPC handlers and native file dialogs.
- `src/main/drafts.ts`: atomic recovery copies with original-file metadata and serialized writes/deletion.
- `src/main/pdf-files.ts`, `session.ts`, and `atomic-write.ts`: PDF file access, backups, session persistence, and atomic writes. These modules do not depend on Electron.
- `src/preload`: narrow IPC API exposed to the renderer and checked against the shared `LepisApi` contract.
- `src/shared/ai.ts`, `src/main/ai` and `src/renderer/src/features/chat`: chat contracts, local storage, provider connections and the chat interface. See [AI chat](ai-chat.md) for data flow, limits and deferred features.
- `src/renderer`: React interface, shadcn components, Tailwind theme, and PDF.js viewer/editor.
- `src/renderer/src/App.tsx`: interface composition, preferences, and PDF file drops.
- `src/renderer/src/features/documents/documentsReducer.ts`: atomic tab and selection transitions, including merging session restore with documents opened during startup.
- `src/renderer/src/features/documents/useDocuments.ts`: document operations, viewer handles, save/close/conflict workflows, and external file checks.
- `src/renderer/src/features/session/useDocumentSession.ts`: session restore, debounced persistence, and the explicit write awaited before window closure.
- `src/renderer/src/features/documents/components`: tab bar, toolbar, document workspace, and close/conflict dialogs. Components receive state and callbacks.
- `src/renderer/src/features/documents/types.ts`: renderer tab and close request types.
- `src/renderer/src/features/pdf/createPdfViewer.ts`: PDF.js document loading, navigation, permissions, saving, and resource cleanup. Annotation commands are delegated to the annotation controller.
- `src/renderer/src/features/pdf/usePdfViewer.ts`: React lifecycle integration and the document command handle.
- `src/renderer/src/features/pdf/PdfDocumentView.tsx` and `PasswordDialog.tsx`: viewer containers, loading indicator, and password form.
- `src/renderer/src/features/pdf/types.ts`: viewer contracts. PDF.js inspects existing digital signature fields before editing is enabled.
- `src/renderer/src/features/pdf/signatures`: visible signature acquisition and library UI. `src/main/signatures.ts` stores the local library separately from documents.
- `src/renderer/src/features/pdf/annotations`: shared PDF.js editor events and annotation lifecycle, with separate `highlight`, `images`, and `text` modules. Each module owns its editor behavior and interface; image input, paste, and drop handling live in `images`. See [the annotation architecture](../src/renderer/src/features/pdf/annotations/README.md) for the extension points.

Sunny uses the official `pdfjs-dist` package directly. The renderer has no Node.js access and runs
with Electron context isolation and sandboxing enabled.
