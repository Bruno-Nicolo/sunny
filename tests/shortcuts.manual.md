# Shortcut verification — 2026-10-02

## Printing — 2026-10-25

Verified the production renderer with a disposable two-page PDF and zero configured
printers on macOS. The `print` menu command opened the native dialog through
`window.print()`. Cancel closed the dialog; PDF → Save as PDF produced a valid two-page
PDF. The print container was removed after `afterprint`, and the document remained open.
`webContents.print()` reproduced “No printers available on the network” in the same
environment and is no longer used. `pnpm test:print` covers page content, mixed page
sizes, duplicate commands and cleanup after a thrown print error without requiring a printer.

## Other shortcuts

Verified through native computer-use input on macOS in the production renderer build.
The application used a temporary profile and nine disposable two-page PDF copies in
`/tmp/lepis-shortcut-check`. A generated blue PNG supplied the annotation fixture.

| Input                                                                                     | Observed result                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Command-O                                                                                 | Native PDF dialog opens; multiple PDFs open as tabs.                                                                     |
| Command-1 through Command-9                                                               | Each selects its own tab. Verified by assigning nine distinct zoom levels and checking every selection in reverse order. |
| Command-9 with eight tabs                                                                 | Selection and zoom stay unchanged.                                                                                       |
| Control-Tab                                                                               | Selects the next tab and wraps from the last to the first.                                                               |
| Control-Shift-Tab                                                                         | Selects the previous tab and wraps from the first to the last.                                                           |
| Command-Plus                                                                              | Increases PDF zoom.                                                                                                      |
| Command-Minus                                                                             | Decreases PDF zoom.                                                                                                      |
| Command-Equals                                                                            | Increases PDF zoom; verified using the keypad equals key.                                                                |
| Right / Left at fit-page zoom                                                             | Page number changes 1 → 2 → 1.                                                                                           |
| Right / Left with horizontal overflow                                                     | Image and horizontal scrollbar move right and back; page stays 1.                                                        |
| Right in the page input                                                                   | Page stays unchanged; the input retains focus.                                                                           |
| Command-Z                                                                                 | Inserted image disappears.                                                                                               |
| Command-Shift-Z                                                                           | Image returns.                                                                                                           |
| Backspace, then Command-Z                                                                 | Selected image is removed, then restored.                                                                                |
| Command-C / Command-V                                                                     | Selected image is duplicated.                                                                                            |
| Command-X / Command-V                                                                     | Selected copy is removed, then pasted again.                                                                             |
| Command-S                                                                                 | “Saved” appears and the dirty indicator clears; saved image remains after restarting the app.                            |
| Command-W, clean tab                                                                      | Closes the active tab and selects its neighbor.                                                                          |
| Command-W, dirty tab                                                                      | Opens the save confirmation. Cancel preserves the tab; Save and close saves and closes on the first click.               |
| Command-Z / redo / Backspace / tab selection / zoom / open while the close dialog is open | Dialog stays open; after dismissal both images, original selection, and zoom are preserved.                              |
| View → Next Page / Previous Page                                                          | Page number changes 1 → 2 → 1.                                                                                           |

The computer-use key names follow physical key positions. On the active keyboard layout,
`minus`, `equal`, and `plus` produced apostrophe/circumflex characters. Zoom was therefore
checked with `slash` for minus, `bracketright` for plus, and `KP_Equal` for equals.

Changes prompted by verification:

- Zoom bindings accept plus and equals with Shift as well as without it.
- Modal keyboard capture prevents PDF.js's own handlers from modifying annotations behind dialogs.
- Save-and-close uses the successful save result rather than React's still-pending dirty state.

Automated regression checks cover shifted zoom symbols, modal undo/deletion, and closing a
dirty tab on the first save confirmation. Build, lint, 19 unit tests, and both Electron
integration suites passed. This matrix covers application shortcuts and annotation editing;
macOS window-management shortcuts are outside its scope.
