# PDF Content Importer v2

Design spec: https://claude.ai/code/artifact/5b29c98b-8fde-46ce-8de7-267e6ce544eb

## Status

| Phase | What | Status |
| --- | --- | --- |
| 1 | Foundation: pdf.js v6 in the app, background worker, Library in IndexedDB, Stage 1 extraction, test page | Done |
| 2 | Layout and styles (columns, reading order, tables, sidebars, book style sheet) | Done |
| 3 | Spells, classes, subclasses + review screen | Next |
| 4 | Feats, species, backgrounds, items, magic items | |
| 5 | OCR for scanned PDFs | |
| 6 | Book profiles and monsters | |

## Phase 1: what changed

- **pdf.js 6.4.299** (legacy build, Apache-2.0) lives in `vendor/pdfjs/`, so both importers work offline. The old CDN copy is only a fallback.
- **Library storage** moved to IndexedDB (`ledger-library`). localStorage keeps a quick-start copy while it fits. On first run the old localStorage copy is saved inside IndexedDB as `backup-localstorage-v1`. The newest copy always wins.
- **Full backup** now includes the Library, and restoring a backup adds any Library entries that are missing.
- **Service worker** (`ledger-v12` after Phase 2) precaches the importer and pdf.js; pdf.js has its own cache that survives app updates.
- **New importer preview** under Library > Import a book. It reads a PDF and reports bookmarks, printed page numbers, fonts, colours and pages that need OCR. It adds nothing to the Library yet.

## Phase 2: what changed

- **Stage 2, layout** (`importer/layout.js`): page furniture removed (running heads and feet, page numbers, rotated edge tabs); lines built by baseline; boxed sidebars, striped tables and aligned-text tables found first; columns and reading order by XY-cut with full-width elements as band breaks; paragraphs, list items (text or drawn bullets), run-in labels ("Hit Dice:", "Rage Damage."), hyphen repair, fake small caps, and tables with titles, multi-row headers, spanning labels and wrapped cells.
- **Stage 3, styles** (`importer/styles.js`): every text style gets a role (body, heading levels, sub-heading, run-in label, table, sidebar). Headings must lead into body text; levels are ranked by size and emphasis. Your role changes are kept per book.
- **Speed:** Stage 1 no longer decodes images (it only needs text and shapes): Ryoko's Guide went from 161 s to about 8 s in the browser.
- **Preview:** a page viewer (the page with numbered blocks over it, and the reading-order text below) and a Book styles panel where any style's role can be changed.

Tested on three third-party books (Homebrewery export, two InDesign books; 800 pages in total) plus the synthetic fixtures (39 automated checks).

## Files

| File | Purpose |
| --- | --- |
| `importer/importer.js` | Page side: starts the worker, builds the preview report |
| `importer/worker.js` | Background worker wrapper |
| `importer/core.js` | Runs Stage 1 over a book, saves pages, resumes |
| `importer/extract.js` | Stage 1: glyph runs (text, position, font, size, weight, italic, colour), boxes, images, page quality |
| `importer/layout.js` | Stage 2: furniture, lines, panels, tables, columns, reading order, paragraphs |
| `importer/styles.js` | Stage 3: the book's style sheet and roles; applies roles to the layout |
| `importer/vocab.js` | Word list for the text-quality check, built from the SRD JSON files |
| `importer/db.js` | Importer storage (IndexedDB `ledger-importer`: books, pages, files) |
| `importer/test.html` | Test page: fixture checks, or read any PDF and see the raw output |
| `importer/tests/make_fixtures.py` | Builds the synthetic test PDFs (original text only) |

## Testing

Open `importer/test.html` on the live site and tap **Run fixture checks** (39 checks), or **Read a PDF** to see the raw Stage 1 output for any book.
