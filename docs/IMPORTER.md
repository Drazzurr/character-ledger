# PDF Content Importer v2

Design spec: https://claude.ai/code/artifact/5b29c98b-8fde-46ce-8de7-267e6ce544eb

## Status

| Phase | What | Status |
| --- | --- | --- |
| 1 | Foundation: pdf.js v6 in the app, background worker, Library in IndexedDB, Stage 1 extraction, test page | Done |
| 2 | Layout and styles (columns, reading order, tables, sidebars, book style sheet) | Next |
| 3 | Spells, classes, subclasses + review screen | |
| 4 | Feats, species, backgrounds, items, magic items | |
| 5 | OCR for scanned PDFs | |
| 6 | Book profiles and monsters | |

## Phase 1: what changed

- **pdf.js 6.4.299** (legacy build, Apache-2.0) lives in `vendor/pdfjs/`, so both importers work offline. The old CDN copy is only a fallback.
- **Library storage** moved to IndexedDB (`ledger-library`). localStorage keeps a quick-start copy while it fits. On first run the old localStorage copy is saved inside IndexedDB as `backup-localstorage-v1`. The newest copy always wins.
- **Full backup** now includes the Library, and restoring a backup adds any Library entries that are missing.
- **Service worker** (`ledger-v5`) precaches the importer and pdf.js; pdf.js has its own cache that survives app updates.
- **New importer preview** under Library > Import a book. It reads a PDF and reports bookmarks, printed page numbers, fonts, colours and pages that need OCR. It adds nothing to the Library yet.

## Files

| File | Purpose |
| --- | --- |
| `importer/importer.js` | Page side: starts the worker, builds the preview report |
| `importer/worker.js` | Background worker wrapper |
| `importer/core.js` | Runs Stage 1 over a book, saves pages, resumes |
| `importer/extract.js` | Stage 1: glyph runs (text, position, font, size, weight, italic, colour), boxes, images, page quality |
| `importer/vocab.js` | Word list for the text-quality check, built from the SRD JSON files |
| `importer/db.js` | Importer storage (IndexedDB `ledger-importer`: books, pages, files) |
| `importer/test.html` | Test page: fixture checks, or read any PDF and see the raw output |
| `importer/tests/make_fixtures.py` | Builds the synthetic test PDFs (original text only) |

## Testing

Open `importer/test.html` on the live site and tap **Run fixture checks** (24 checks), or **Read a PDF** to see the raw Stage 1 output for any book.
