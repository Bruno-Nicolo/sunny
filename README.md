# Lepis

Lepis is a lightweight, local-first PDF viewer and annotation editor for macOS.
Documents never leave the computer.

## Current scope

- Open one or more PDFs through the file dialog, Finder, or drag and drop.
- Keep documents in tabs and restore the last session.
- Keep local recovery copies of unsaved annotations and offer recovery after an interrupted session.
- Scroll pages vertically, jump to a page, zoom, fit width, and fit page.
- Highlight selectable text with a small color palette.
- Add editable text boxes by choosing Add text and clicking on a page; open Text settings next to the selected box to choose a preset color and size.
- Type multiple lines, move text boxes, and edit saved text by selecting it and pressing Enter.
- Add images from the toolbar, paste them with Command-V, or drop image files into the active PDF.
- Move and resize inserted images; delete them with Backspace and save them with Command-S.
- Undo and redo annotations with the standard macOS shortcuts.
- Save changes to the original PDF with Command-S.
- Detect external file changes and protect signed or restricted PDFs from edits.

## Development

Requirements: Node.js 20.19 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

The development command watches the renderer, main process, and preload scripts, so shortcut
configuration changes also update the native menus.

Run the checks and create a production bundle:

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:images
pnpm test:text
pnpm test:documents
pnpm test:recovery
pnpm test:memory
```

Build the unsigned macOS application:

```bash
pnpm build:mac
```

## Architecture

- `src/shared/contracts.ts`: document, session, save request, and preload API types shared by all processes.
- `src/shared/shortcuts.ts`: central shortcut configuration shared by native menus and the renderer.
- `src/main/index.ts`: Electron startup and application lifecycle.
- `src/main/window.ts` and `menu.ts`: native window and application menus.
- `src/main/ipc.ts` and `pdf-dialogs.ts`: IPC handlers and native file dialogs.
- `src/main/drafts.ts`: atomic recovery copies with original-file metadata and serialized writes/deletion.
- `src/main/pdf-files.ts`, `session.ts`, and `atomic-write.ts`: PDF file access, backups, session persistence, and atomic writes. These modules do not depend on Electron.
- `src/preload`: narrow IPC API exposed to the renderer and checked against the shared `LepisApi` contract.
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
- `src/renderer/src/features/pdf/types.ts` and `signatures.ts`: viewer contracts and conservative signature marker detection.
- `src/renderer/src/features/pdf/annotations`: shared PDF.js editor events and annotation lifecycle, with separate `highlight`, `images`, and `text` modules. Each module owns its editor behavior and interface; image input, paste, and drop handling live in `images`. See [the annotation architecture](src/renderer/src/features/pdf/annotations/README.md) for the extension points.

Lepis uses the official `pdfjs-dist` package directly. The renderer has no Node.js access and runs
with Electron context isolation and sandboxing enabled.

`pnpm test` covers annotation event commands, mode confirmation/interruption, subscription cleanup,
viewer isolation, shortcuts, document state transitions, and filesystem behavior, including
backups, save conflicts, copy saves, failed atomic writes, and session persistence.
`pnpm test:text` checks multiline text insertion, formatting, consecutive saves, saving with the
formatting menu open, undo/redo, empty text boxes, tab isolation, and editing text after reopening.
`pnpm test:images` checks image editing in Electron. `pnpm test:documents` checks concurrent startup
and close operations, partial open failures, and save/close/conflict workflows.
It also checks page and zoom retention on reload, password retries, active-tab password prompts,
external changes to edited PDFs, close failures, and session persistence before window closure.
Session writes are serialized in the main process so earlier writes cannot overwrite newer state.
If saving the session fails, the window stays open and the error is shown.
The document and image integration suites use a simulated file API and temporary session data.
`pnpm test:memory` runs the development renderer with the real preload and PDF file reader,
two 32 MB PDFs, repeated tab operations, and a 384 MB JavaScript heap limit.

Opened PDF bytes use `ArrayBuffer` across IPC and React props. React's development performance
tracing enumerates typed-array entries when describing props; exposing a large `Uint8Array`
there can exhaust the renderer heap. PDF.js accepts the opaque buffer directly, and receives
a copy because it transfers ownership to its worker. Saved PDF output remains `Uint8Array`.

## Recovery copies

While edited documents are open, Lepis checks for changes every three seconds and writes a
local recovery copy when the annotations have changed. PDF.js supplies the annotation hash,
so unchanged annotations do not trigger a full PDF export. Recovery copies store PDF bytes
and metadata in one binary file without Base64 encoding. Recovery does not overwrite the original
PDF. Live text is included while retaining editing focus and the caret; snapshots wait until
IME composition ends. The latest changes since the last completed snapshot may be lost if the
application crashes.

At startup, choose **Recover changes** to reopen recovery copies as unsaved documents, or
**Discard recovery copies** to delete them. Copies remain available until changes are saved
or explicitly discarded. Recovery also works when the original file is missing; save the
recovered document as a copy. If the original has changed, the existing conflict workflow
prevents overwriting it silently.

Recovery copies are distinct from the previous-version backups created by manual saves.
Saving, closing without saving, or reloading and discarding removes the corresponding recovery
copy. Pending snapshots are drained before deletion so they cannot recreate a discarded copy.

`pnpm test:recovery` checks focused text and caret retention, renderer termination and recovery,
failed saves, external-file conflicts, explicit discard, and closure during a pending draft write.

## Keyboard shortcuts

| Shortcut                  | Action                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| ⌘+ / ⌘−                   | Zoom in / out                                                              |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab, wrapping at either end                                |
| ⌘1–⌘9                     | Select the tab at that position; missing tabs are ignored                  |
| ← / →                     | Scroll horizontally when the PDF overflows; otherwise previous / next page |
| ⌘W                        | Close the active tab, prompting to save unsaved changes                    |
| ⌘O / ⌘S                   | Open / save PDF                                                            |
| ⌘Z / ⌘Shift+Z             | Undo / redo annotations                                                    |

Configure shortcuts in `src/shared/shortcuts.ts`: `accelerator` defines the native menu shortcut,
and `keys` defines renderer bindings for additional keys or navigation inside the viewer.
Use the `control` modifier for Ctrl and `command` for ⌘ on macOS (Ctrl on other platforms).
⌘= also zooms in. Arrow shortcuts leave input fields, editable text, menus, and popovers alone.
Application commands are suspended while a save/close or file-conflict dialog is open.

## License

MIT
