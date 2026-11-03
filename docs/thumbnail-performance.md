# Annotation thumbnails: verification and performance

Measured locally on 2026-10-28 against the baseline commit recorded in
[the raw measurements](thumbnail-performance.json). The comparison uses production builds,
the same Electron runtime and fixtures, 100 tool switches and 120 page visits per run.
Measurements are individual local samples, not a statistical performance guarantee.

## Rendering behavior

Visible thumbnails retain a small page bitmap and compose the current highlight, text and image
records over it. Edits notify only subscribers for the affected page and updates are coalesced
with requestAnimationFrame. Leaving the visible area (including a 200px preload margin), closing
the navigation modal or deactivating the document releases thumbnail canvases and subscriptions.

Thumbnails do not import annotations for unvisited pages. Those pages retain PDF.js's original
annotation rendering. When the editor imports editable originals, it invalidates that thumbnail's base bitmap
once, then subsequent annotation edits reuse the bitmap. Pages without editable originals keep
their bitmap. This keeps document imports and image
assets bounded by editor use rather than thumbnail scrolling.

## Measurements

| Fixture                                     | Version              | First page | Tool p95 | Navigation p95 | Resident memory | Heap after first / second navigation pass |
| ------------------------------------------- | -------------------- | ---------: | -------: | -------------: | --------------: | ----------------------------------------: |
| 300 pages, 62,800 highlights, 35.8 MiB      | Before               |   1,376 ms |   102 ms |         217 ms |       521.2 MiB |                           28.2 / 27.3 MiB |
| Same                                        | After, confirmed run |   1,236 ms |   104 ms |         217 ms |       574.0 MiB |                           25.9 / 26.6 MiB |
| 1,000 pages, 22,980 highlights, 1,113.1 MiB | Before, repeat       |   1,930 ms |   101 ms |         236 ms |       477.1 MiB |                           18.9 / 21.5 MiB |
| Same                                        | After                |   1,513 ms |    99 ms |         266 ms |       498.9 MiB |                           19.1 / 20.1 MiB |

The large file contains 89.1 MiB of vector/annotation content plus a 1 GiB sparse, unreferenced
stream. It tests range access for a large file, not decoding 1 GiB of scanned images. Opening read
17.2 MiB after the change and opened the source once. The 1,000-page fixture uses a 32 MiB opening
read budget; the original 300-page fixture retains its 8 MiB budget.

Navigation in the larger fixture took about 30 ms more at p95. The confirmed 300-page run matched
the baseline navigation p95. Resident memory varies substantially between runs: another passing
300-page sample measured 395.2 MiB. Neither fixture showed continuing heap growth above the existing
30 MiB regression limit after repeated navigation; no orphan annotation layers remained.

Thirty recolorings on a page containing 3,000 highlights updated its thumbnail in **42 ms at p95**
(maximum 83 ms), with **zero additional PDF text renders**. Navigation memory and long-task metrics
in this confirmed run were sampled before edits to separate thumbnail work from draft serialization.

An earlier run measured a 2,029 ms opening and failed the existing 2-second opening budget; the
later confirmed run passed all budgets. That outlier, the other samples and their exact metrics
are retained in the JSON report. The measurements support bounded overhead, not identical timings
under all workloads. The larger fixture's final passing run stayed below 200 ms for interactive
long tasks and 768 MiB for resident memory.

## Follow-up review, 2026-10-29

The review shares orientation geometry between editor layers and thumbnails, keeps the document
and its thumbnail source in one React state, and avoids invalidating thumbnails when an imported
page has no editable originals. Editor changes target the affected page, including deletion of
new annotations. Tool and selection updates skip record reconciliation when the model revision
and viewport are unchanged.

The final 300-page run passed all existing budgets: 1,431 ms opening, 149 ms tool-switch p95,
268 ms navigation p95 and 758.5 MiB resident memory. Thirty thumbnail edits measured 65 ms at p95
and 146 ms maximum, with no additional PDF text renders. Heap grew from 26.7 to 28.0 MiB over the
navigation passes, with no orphan layers. Tool-switch latency and resident memory remain close
to their existing limits; this is one local sample. The raw sample is `after_review_300`.

Two earlier review samples exceeded the tool-switch budget (151 ms and 150 ms, against a strict
150 ms limit). The final sample includes the editor reconciliation optimization. The pixel test
also now samples inside the highlight rather than near its antialiased edge, so the same color
thresholds work at all four intrinsic page rotations.

## Reproduction

```sh
pnpm build
LEPIS_PERF_THUMBNAIL_EDITS=1 LEPIS_PERF_REPORT=/tmp/thumbnails-300.json \
  pnpm exec electron tests/annotation-performance.integration.mjs
LEPIS_PERF_PAGES=1000 LEPIS_PERF_ANNOTATIONS_PER_PAGE=20 \
  LEPIS_PERF_SPARSE_GB=1 LEPIS_PERF_OPENING_READ_MB=32 \
  LEPIS_PERF_REPORT=/tmp/thumbnails-1000.json \
  pnpm exec electron tests/annotation-performance.integration.mjs
```

Avoid running other CPU-heavy test processes concurrently with these measurements. Sparse-file
size and thumbnail edit measurements are separate: editing a sparse gigabyte fixture would also
exercise full-document draft serialization.

## Functional checks

`pnpm test:navigation` runs navigation and pixel-based annotation thumbnail regressions. The latter
checks existing and newly created highlights, overlapping highlight colors, pasted multiline text,
size and color changes, pasted image colors, deletion, undo/redo and save/reopen. Edits happen with
the modal closed, then the test reopens it and checks the rendered pixels. The optional thumbnail
benchmark counts PDF text renders for the edited thumbnail to detect unnecessary page redraws.

The same test passed with intrinsic page rotations 0, 90, 180 and 270 degrees. To run another
orientation after building:

```sh
LEPIS_THUMBNAIL_ROTATION=90 pnpm exec electron tests/thumbnail-annotations.integration.mjs
```

The existing navigation, annotation loading/forms, highlight, text and image integration suites
passed, as did all 68 unit tests, TypeScript checks and lint for changed source/test files.
The integration suites' dirty-state selectors were corrected to target the indicator itself;
their old selector also matched the tab close button.
