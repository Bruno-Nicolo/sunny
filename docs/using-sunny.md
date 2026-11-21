# Using Sunny

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
