# PDF annotations

`createPdfViewer.ts` owns the PDF document, passwords, permissions, navigation and disposal.
PDF.js's native annotation editors are disabled. `createAnnotationController.ts` owns one editing
session per document and prepares each visible page's annotations before its first canvas render.
Changing tools never changes PDF.js's rendering mode or reloads a page.

## State, interaction and PDF output

- `model.ts` owns immutable annotation records and a single undo/redo history. Imports do not mark
  the document dirty. Live typing and pointer gestures form reversible commands. Original records
  remain available so saving can identify updates and deletions without rebuilding untouched objects.
- `annotationLayer.ts` renders the app's editors over a page. It updates geometry only when a record
  or viewport changes. Tool selection changes interaction, not annotation content. Page redraws
  retain the overlay DOM, focused input and caret. Page eviction
  disposes editor DOM and listeners; an evicted or cancelled page draw cannot recreate the overlay; document disposal also releases image assets and history.
  Selection mode enables annotation hover, selection and resize handles. Creation tools let pointer
  input pass through existing annotations and native PDF controls; the text block currently being
  edited remains interactive.
- `geometry.ts` uses PDF coordinates and saved annotation orientation. Viewport conversion handles
  zoom, intrinsic page rotation and user rotation. Resize handles act on visual edges.
  Text blocks fit their content until manually resized. After resizing, they wrap at their current
  width without changing font size; their height grows to fit. The PDF stores the resize state in
  `SunnyTextResized` so this policy survives reopening. Editing hides the outline and resize handles.
  `text/textLayout.ts` computes visual lines separately from the editable text for PDF output and thumbnails.
- `pdfAnnotationReader.ts` imports editable text highlights, freehand Ink strokes, FreeText and image Stamps. Original object
  references and popup references stay attached to the imported records. Other annotation types and
  locked annotations remain on PDF.js's original rendering path and are preserved in the PDF.
  Annotations with NoZoom/NoRotate flags or without an indirect object reference also remain on that
  path until their editing geometry and reference handling are supported.
- `pdfAnnotationWriter.ts` adapts changed records to the installed PDF.js worker's serialized
  annotation protocol. `saveDocument()` writes incremental PDF updates and preserves encryption.
  Image assets stay in the model; each save creates fresh transferable bitmap copies and releases
  them afterward. Never run PDF.js's bitmap-closing storage hash inspection over these records.

The document revision advances on user edits, including native form input. Recovery snapshots do
not change the document's save state. Explicit saving retains the dirty flag if another edit arrives
while the PDF is being written. Pending text remains editable and retains its caret during recovery.

The native Copy command copies a selected text annotation as plain text or an image annotation as
PNG to the system clipboard. The controller handles copy events only within its active viewer;
editable text fields keep native character-selection copying. Copying does not change the model.
Pasting images or plain text centers the element at the pointer on the active document's page. The insertion
point is captured before asynchronous image decoding; page viewport conversion handles zoom and
rotation. Editable fields retain native paste behavior.

## PDF.js patch

`patches/pdfjs-dist@6.3.289.patch` is applied by pnpm. It adds `setOverlayAnnotationIds()` to storage
and includes those IDs in the existing display-render exclusion/cache path, separately for each page.
Importing another page does not invalidate already prepared rendering data. The native HTML layer
also skips those IDs rather than creating duplicate hidden elements. Exclusions are not PDF
edits and do not apply to printing. The FreeText writer accepts visual `textLines` for its
appearance while preserving the original text in Contents, so reopening a block retains soft wraps.
Links, form widgets and annotations outside the app's imported
set keep their normal rendering behavior.

The patch also contains a native Line/ClosedArrow writer used by the round-trip proof. Shape tools
are a separate delivery; this backend proof adds no toolbar controls. It updates the original PDF
object and regenerates its appearance rather than flattening an arrow into page content.

The serialized worker protocol and patch are tied to the pinned PDF.js release. Updating PDF.js
requires reviewing the patch and running the writer, rendering, editing and recovery tests.

## Adding a tool

Add its record geometry, overlay behavior and PDF serialization together. Keep creation tools
separate from the normal selection mode. Reuse the document model and history. New types must pass
create, save, reopen, edit, undo and delete tests, including existing annotations from other readers.
Do not import a type into the overlay until its rendering and save path are implemented.

Run `test:annotations` for tool-switch canvas/layer identity, dirty-state and form-field regressions.
`LEPIS_ANNOTATION_COUNT=500` runs the same integration test against a densely annotated page.
The text, highlight, image, memory, layout and recovery suites cover the existing editing contract.

`test:annotation-performance` uses a synthetic 300-page, 35.8 MB vector PDF with 62,800 highlights,
including 3,000 on the first page. It measures opening, 100 tool switches, two passes through 60
spread-out pages, event-loop delays and memory after forced GC. It asserts canvas/editor identity,
no orphan overlays, bounded page DOM, less than 30 MB retained heap growth on the second pass, and
latency budgets (tool p95 <150 ms, page p95 <500 ms, first page <2 s, no event-loop pause >500 ms).
Interactive long tasks and resident memory have explicit budgets of 200 ms and 768 MB.
Startup long tasks have a 250 ms budget; the maximum including startup is always reported.
Forced debugger GC pauses are excluded from UI timings. Heap figures cover the
main renderer JavaScript context; resident memory is reported separately.
Run with `LEPIS_PERF_ANNOTATED=0` for the same vector workload without annotations, in a separate
process. This compares annotation overhead; it is not a benchmark of the previous implementation.
The fixture does not represent scanned images or every supported annotation type.

## Document loading and resource ownership

Local files use an opaque, range-only `lepis-pdf:` source. The main process creates a private,
immutable snapshot using macOS `/bin/cp -c` (APFS copy-on-write) so external replacements or
in-place writes cannot corrupt later reads or conflict-save copies. The renderer requests 16 KB
ranges through PDF.js's native DataRangeTransport. Opening never transfers the whole file over IPC.
Sources are released on replacement/unmount and on application window shutdown. Recovery drafts
remain serialized memory sources and can be saved before their viewer has ever been activated.

Only activated tabs load the PDF engine and create a viewer. The UI entry and PDF worker are
minified by Vite/esbuild; worker exports remain available for PDF.js. Session file preparation runs
concurrently and preserves the saved tab order. Thumbnail work is serialized and yields to idle time; cancelled
queued work never renders. Completed thumbnail renders release PDF page resources when the main
viewer does not own them. The main viewer retains the visible pages plus two neighbors, with a minimum of three pages.
Highlights share SVG drawing groups; transparent per-annotation hit areas retain editing behavior.
Pixel tests verify black text and overlapping highlight colors. Stamp import uses a 1-pixel carrier
canvas; each appearance retains its own canvas rather than allocating an unused full-page bitmap.

The PDF.js patch also cancels page requests belonging to a detached document and checks signature
fields without requiring optional SigFlags. Signature
inspection uses the worker's parsed objects rather than decoding the entire file as text.

`LEPIS_PERF_SPARSE_GB=1` adds a valid, unreferenced sparse 1 GB stream to the stress fixture. This
checks file-size-independent range access; it does not simulate decoding a gigabyte of image data.
The benchmark rejects startup reads of 8 MB or more. `LEPIS_PERF_REPORT=/absolute/path.json` writes
the measurements for comparison. Debugger GC intervals are excluded from latency measurements;
resident memory remains the actual process measurement, separate from main-context JS heap.

Measured on the development Mac with the final production build (100 tool switches and 120 page
visits per process):

| Workload                                             | First page | Tool p95 | Navigation p95 | Maximum timer delay | Renderer resident memory |
| ---------------------------------------------------- | ---------: | -------: | -------------: | ------------------: | -----------------------: |
| 300 pages, 62,800 highlights, 35.8 MB                |   1,250 ms |    37 ms |         233 ms |              104 ms |                 520.2 MB |
| Same content plus an unreferenced sparse 1 GB stream |   1,016 ms |    37 ms |         205 ms |              104 ms |                 665.7 MB |
| Same vector pages without annotations, 25.6 MB       |     486 ms |    34 ms |         132 ms |               42 ms |                 422.9 MB |

Both annotated runs read about 7.1 MB at opening and opened the document exactly once, including
focus-change checks. Maximum Long Tasks were 83 and 87 ms; interactive Long Tasks were at most
76 and 79 ms. Tool maximums were 44 and 184 ms. Main-context heap after the two navigation passes
was 27.9→27.7 MB and 24.8→26.5 MB; no orphan overlays remained. These are measurements for this
synthetic workload, not universal PDF/hardware guarantees. The sparse-file variant measures range
access, not decoding a gigabyte of scanned images.

The 1 GB variant exposed a full-file copy in Node's macOS copyFile implementation even with
COPYFILE_FICLONE requested. Native `/bin/cp -c` reduced snapshot setup from about 1.3 seconds to
7–8 ms in the final integrated runs. Earlier runs reached 214-ms startup tasks; startup and
interactive-task budgets remain separate, and all startup samples remain in reports.

The worker's ChunkedStream stores received chunks instead of allocating a file-sized Uint8Array.
Byte reads cache the current chunk; multi-chunk stream reads return a contiguous range. Full-file
bytes are assembled once and reused only when GetData/save requires the complete PDF, then the
chunk map is released. Substreams share the same storage. Font ToUnicode hashing reads its range
without materializing the document. The range integration test covers a partial initial chunk,
chunk-crossing Unicode font data, exact original bytes and incremental annotation saves.

The original 512 MB process-memory target was not achieved consistently (the final gigabyte workload
measured 665.7 MB). The regression ceiling is 768 MB for the complete
renderer, including its worker and native graphics allocations. The separate retained-heap and
DOM checks remain in place. This is a regression budget, not a claim of constant memory use.
The benchmark uses real file stats and checks exactly one document read, including synthetic focus
changes; stale fake stats previously caused unintended reloads. Identity-check references are
cleared before navigation so the harness does not retain the first page after eviction.

Page cleanup also releases the worker's parsed annotation appearances, including pages rendered
only as thumbnails. Original indirect references stay stable when those annotations are parsed
again. Pages containing direct annotation dictionaries retain their native cache because their
synthetic IDs would otherwise change; a regression test covers this case. Page resources and font
caches remain available, and saves reconstruct annotations from the unchanged PDF objects.

Interaction suites use hidden windows with background throttling disabled and Chromium focus
emulation, via `tests/fixtures/focus.mjs`. They retain native input events and assert their actual
editing effects without stealing desktop focus or accepting unrelated keystrokes. The performance
window is visible, non-focusable and ignores physical mouse input; its measured interactions use
the app's actual toolbar and navigation handlers.

## Navigation modal annotation previews

`pageAnnotations.ts` exposes current page records and draws them for sidebar previews and AI region attachments.
Region attachments render the PDF crop with native annotations, then compose the editor's records
in the same viewport coordinates. Imported originals remain excluded from the base display render,
so edited or deleted annotations are not drawn twice. Captures include unsaved changes and omit
editor controls and selection overlays.

Visible thumbnails compose current annotation records over a cached PDF bitmap and coalesce
page-specific changes in animation frames. Pages not yet imported by the editor keep their native
PDF annotation rendering; thumbnails never trigger imports. Importing editable originals invalidates the page’s base
bitmap once so they are not drawn twice. Pages without editable originals keep their bitmap. Offscreen thumbnails release their bitmap
and subscription. The preview painter uses PDF.js viewport conversion for intrinsic page rotation.
Editor layers update tool and selection state without reconciling annotation records when the
model revision and viewport are unchanged.

`test:navigation` includes pixel regressions for highlights, formatted text and pasted images. Set
`LEPIS_THUMBNAIL_ROTATION` to 90, 180 or 270 when running
`tests/thumbnail-annotations.integration.mjs` for additional orientations.
`LEPIS_PERF_THUMBNAIL_EDITS=1` adds a 30-edit thumbnail latency and PDF-render reuse check to the
performance suite. The configurable larger fixture uses `LEPIS_PERF_PAGES`,
`LEPIS_PERF_ANNOTATIONS_PER_PAGE` and `LEPIS_PERF_OPENING_READ_MB`.
See [measurements and reproduction commands](../../../../../../docs/thumbnail-performance.md).

With the highlight tool active, dragging on text selects text and dragging from a blank area
creates a freehand stroke. The tool sidebar sets the highlight color and opacity, plus the freehand stroke size
(2–40 points). Defaults are a 12-point round stroke and 90% opacity with Multiply blending to preserve the text underneath. Page overlays,
gesture previews and thumbnails use the same blending. They save as standard editable Ink
annotations with a Multiply appearance stream. Pointer cancellation,
Escape, tool changes and loss of window focus discard the gesture; a completed stroke adds one
undo command. The page layer owns the gesture lifetime, including cancellation on viewport changes
and page disposal. The SVG preview appends points and updates bounds incrementally. `highlight/geometry.ts`
builds the shared path for page overlays, thumbnail previews and region captures.
