# Lepis

Lepis is a lightweight, local-first PDF viewer and annotation editor for macOS.
Documents never leave the computer.

## Current scope

- Open one or more PDFs through the file dialog, Finder, or drag and drop.
- Keep documents in tabs and restore the last session.
- Scroll pages vertically, jump to a page, zoom, fit width, and fit page.
- Highlight selectable text with a small color palette.
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
pnpm build
```

Build the unsigned macOS application:

```bash
pnpm build:mac
```

## Architecture

- `src/shared/shortcuts.ts`: central shortcut configuration shared by native menus and the renderer.
- `src/main`: native window, menus, file access, session persistence, and atomic saves.
- `src/preload`: narrow IPC API exposed to the renderer.
- `src/renderer`: React interface, shadcn components, Tailwind theme, and PDF.js viewer/editor.

Lepis uses the official `pdfjs-dist` package directly. The renderer has no Node.js access and runs
with Electron context isolation and sandboxing enabled.

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
