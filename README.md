# Sunny

Sunny is a lightweight, local-first PDF viewer and annotation editor for macOS.
PDF viewing and editing run locally. Optional AI chat sends selected images, relevant document
excerpts and needed conversation history to the service chosen by the user, after consent.

## Current scope

- Open one or more PDFs through the file dialog, Finder, or drag and drop.
- Keep documents in tabs and restore the last session.
- Keep local recovery copies of unsaved annotations and offer recovery after an interrupted session.
- Scroll pages vertically, jump to a page, zoom, fit width, and fit page.
- Organize pages in the navigation dialog: select pages, move them together, delete them, or export them to one PDF.
- Preview page changes before saving them to the original PDF; discard the draft without changing annotations.
- Highlight selectable text with a small color palette.
- Add editable text boxes by choosing Add text and clicking on a page; open Text settings next to the selected box to choose a preset color and size.
- Type multiple lines, move text boxes, and edit saved text by selecting it and pressing Enter.
- Add images from the toolbar, paste them with Command-V, or drop image files into the active PDF.
- Move and proportionally resize inserted images; delete them with Backspace and save them with Command-S.
- Draw or import a visible signature, preview it, and click a page to place it. Save named signatures on this device for reuse, rename them, or delete them from the library.
- Undo and redo annotations with the standard macOS shortcuts.
- Save changes to the original PDF with Command-S.
- Choose **File → Export Without Annotations…** to save a separate PDF with selectable text, links and form fields. The copy uses the saved page layout and form values. If the original has password protection and allows export, the copy opens without a password.
- Choose **File → Export Flattened PDF…** to save a separate copy with unsaved annotations embedded in the page images. Text selection, search, links and interactive form fields are unavailable in the copy.
- Detect external file changes and protect signed or restricted PDFs from edits.
- Ask questions in a resizable right-hand AI panel, with clickable citations that reveal passages in the PDF.
- Attach selected text or rectangular regions, including figures and formulas, without modifying the PDF.
- Keep multiple local conversations per PDF, with saved selections, streaming, stop, retry and copy.
- Connect an eligible ChatGPT plan, or configure OpenAI, Anthropic, Google Gemini or OpenRouter API keys.
- Summarize the full document through a separate flow that processes every section of extractable text.

## Development

Requirements: Node.js 22.13 or newer and pnpm. Electron includes SQLite; no database server is needed.

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
pnpm test:signatures
pnpm test:text
pnpm test:documents
pnpm test:recovery
pnpm test:memory
pnpm test:chat
```

Build the unsigned macOS application:

```bash
pnpm build:mac
```

The application icon comes from `resources/branding/sunny-solid.png`. After updating it, run
`pnpm build:icons` on macOS to regenerate the PNG, ICNS, and ICO assets.

## Architecture

- `src/shared/contracts.ts`: document, session, save request, and preload API types shared by all processes.
- `src/shared/shortcuts.ts`: central shortcut configuration shared by native menus and the renderer.
- `src/main/index.ts`: Electron startup and application lifecycle.
- `src/main/window.ts` and `menu.ts`: native window and application menus.
- `src/main/ipc.ts` and `pdf-dialogs.ts`: IPC handlers and native file dialogs.
- `src/main/drafts.ts`: atomic recovery copies with original-file metadata and serialized writes/deletion.
- `src/main/pdf-files.ts`, `session.ts`, and `atomic-write.ts`: PDF file access, backups, session persistence, and atomic writes. These modules do not depend on Electron.
- `src/preload`: narrow IPC API exposed to the renderer and checked against the shared `LepisApi` contract.
- `src/shared/ai.ts`, `src/main/ai` and `src/renderer/src/features/chat`: chat contracts, local storage, provider connections and the chat interface. See [AI chat](docs/ai-chat.md) for data flow, limits and deferred features.
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
- `src/renderer/src/features/pdf/annotations`: shared PDF.js editor events and annotation lifecycle, with separate `highlight`, `images`, and `text` modules. Each module owns its editor behavior and interface; image input, paste, and drop handling live in `images`. See [the annotation architecture](src/renderer/src/features/pdf/annotations/README.md) for the extension points.

Sunny uses the official `pdfjs-dist` package directly. The renderer has no Node.js access and runs
with Electron context isolation and sandboxing enabled.

`pnpm test` covers annotation event commands, mode confirmation/interruption, subscription cleanup,
viewer isolation, shortcuts, document state transitions, and filesystem behavior, including
backups, save conflicts, copy saves, failed atomic writes, and session persistence.
`pnpm test:text` checks multiline text insertion, formatting, consecutive saves, saving with the
formatting menu open, undo/redo, empty text boxes, tab isolation, and editing text after reopening.
`pnpm test:signatures` checks drawing, image extraction, required local saving, renaming, deletion, placement cancellation and alignment, and PDF reopening in Electron.
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

## Organizing pages

Open PDF navigation to browse thumbnails or the document outline. Choose **Select pages** to
select individual pages, Shift-click an interval, or use Command-A to select all pages.
Move selected pages together by dragging a selected thumbnail. During dragging, remaining
pages compact around one empty cell that marks the insertion position. The drag preview shows
at most four cards and the total number of selected pages.
Deletion requires confirmation, and at least one page must remain.

Reordering and deletion remain in a temporary draft until **Save changes** writes the PDF,
including any unsaved annotations. Saving keeps the dialog open and clears the selection.
**Discard page changes** restores the page order and removed pages without discarding
annotations. Leaving with pending changes offers continue, discard, or save. A failed save
keeps the draft available. Draft page changes are not recovered after an interrupted session.

**Export** saves selected pages in the draft order as one separate PDF with their current
annotations. It does not apply the draft or open the exported file. Exports and conflict
copies cannot overwrite an open PDF.

Saved page changes cannot be undone, and saving them clears the previous annotation undo
history. Annotations added afterward have their own undo history. Existing AI conversations
remain readable but their citations are disabled when they refer to the previous document
version; start a new conversation to ask about the changed PDF.

## Recovery copies

While edited documents are open, Sunny checks for changes every three seconds and writes a
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
