/* Runs the importer over a book and stores the result: Stage 1 (text) page by page, then the book-wide
   Stage 2 (layout) and Stage 3 (style sheet). Used by worker.js, and directly on the page when a browser
   cannot run module workers. */

import { getBook, putBook, putPage, putFile, getFile, pageKeys, getPages, putLayouts } from "./db.js";
import { extractPage, bookInfo, STAGE1_VERSION } from "./extract.js";
import { loadVocab } from "./vocab.js";
import { layoutPage, findFurniture, STAGE2_VERSION, eachBlock } from "./layout.js";
import { buildStyleSheet, applyRoles, STAGE3_VERSION } from "./styles.js";

let pdfjsP = null;
export function loadPdfjs(appBase) {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      const base = new URL("vendor/pdfjs/", appBase).href;
      const m = await import(base + "pdf.mjs");
      m.GlobalWorkerOptions.workerSrc = base + "pdf.worker.mjs";
      const opts = {
        cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/",
        isEvalSupported: false, disableFontFace: true, fontExtraProperties: true, useSystemFonts: false, useWorkerFetch: true,
        // images are not decoded: the importer needs text and shapes, and decoding art is most of the time on big books
        maxImageSize: 1, verbosity: 0,
      };
      return { m, opts };
    })().catch((e) => { pdfjsP = null; const err = new Error("Could not load the PDF reader: " + (e && e.message || e)); err.stage = "load"; throw err; });
  }
  return pdfjsP;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

function addStats(book, res) {
  const st = book.stats || (book.stats = { fonts: {}, colors: {}, sizes: {}, status: {} });
  st.status[res.quality.status] = (st.status[res.quality.status] || 0) + 1;
  for (const r of res.runs) {
    const n = r.t.replace(/\s/g, "").length;
    if (!n) continue;
    st.fonts[r.f] = (st.fonts[r.f] || 0) + n;
    st.colors[r.c] = (st.colors[r.c] || 0) + n;
    const sz = (Math.round(r.s * 4) / 4).toFixed(2);
    st.sizes[sz] = (st.sizes[sz] || 0) + n;
  }
}

/**
 * opts: { file (File or Blob), name?, appBase, from?, to?, storeFile?, post(msg), signal? }
 * Resolves with { id }. Pages already read (same Stage 1 version) are skipped, so a stopped import resumes.
 */
export async function run(opts) {
  const { file, appBase, post = () => {}, signal } = opts;
  const name = opts.name || file.name || "book.pdf";
  post({ type: "status", text: "Opening " + name + "..." });
  const { m, opts: po } = await loadPdfjs(appBase);
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await m.getDocument(Object.assign({ data }, po)).promise;
  } catch (e) {
    const err = new Error(e && e.name === "PasswordException" ? "This PDF is password protected." : "This file could not be opened as a PDF.");
    err.stage = "open"; err.cause = e;
    throw err;
  }
  try {
    const info = await bookInfo(doc);
    const id = (info.fingerprint || hashStr(name + ":" + file.size)) + "-" + info.numPages;
    let book = await getBook(id);
    const fresh = !book || book.stage1 !== STAGE1_VERSION;
    if (!book) {
      book = { id, created: Date.now(), title: info.meta.title || name.replace(/\.pdf$/i, ""), file: { name, size: file.size || data.length } };
    }
    if (fresh) { book.fonts = {}; book.stats = null; book.pageStatus = {}; }
    Object.assign(book, { info, stage1: STAGE1_VERSION, updated: Date.now() });

    if (opts.storeFile !== false) {
      try {
        if (!(await getFile(id))) await putFile(id, file instanceof Blob ? file : new Blob([data], { type: "application/pdf" }));
        book.fileStored = true;
      } catch (e) { book.fileStored = false; }
    }
    await putBook(book);
    post({ type: "book", id, title: book.title, numPages: info.numPages });

    post({ type: "status", text: "Loading word list..." });
    const vocab = await loadVocab(appBase);
    const n = info.numPages;
    const from = Math.max(1, opts.from | 0 || 1);
    const to = Math.min(n, opts.to | 0 || n);
    const done = new Set(fresh ? [] : await pageKeys(id));
    let since = 0;
    for (let p = from; p <= to; p++) {
      if (signal && signal.aborted) break;
      if (done.has(p)) { post({ type: "progress", page: p, from, to, skipped: true }); continue; }
      const label = info.labels && info.labels[p - 1] != null ? String(info.labels[p - 1]) : null;
      let res;
      try {
        res = await extractPage(m, doc, p, { vocab, knownFonts: book.fonts, label });
      } catch (e) {
        res = { page: p, label, w: 0, h: 0, rot: 0, runs: [], boxes: [], images: [], fonts: {}, struct: null,
          quality: { status: "error", why: "Page could not be read: " + (e && e.message || e), needsOcr: true, chars: 0 } };
      }
      Object.assign(book.fonts, res.fonts);
      delete res.fonts;
      res.book = id;
      res.v = STAGE1_VERSION;
      await putPage(res);
      book.pageStatus[p] = res.quality.status;
      addStats(book, res);
      post({ type: "progress", page: p, from, to, status: res.quality.status });
      if (++since >= 10) { since = 0; book.updated = Date.now(); await putBook(book); }
    }
    book.range = { from, to };
    book.complete = Object.keys(book.pageStatus).length >= n;
    book.updated = Date.now();
    await putBook(book);
    const stopped = !!(signal && signal.aborted);
    if (!stopped) await analyse(id, { appBase, post, vocab, signal });
    return { id, stopped };
  } finally {
    try { await doc.destroy(); } catch (e) { /* ignore */ }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Stages 2 and 3 over every page read so far: furniture, layout, style sheet, roles. Re-run after the
 * user changes a style's role (overrides are kept on the book record).
 */
export async function analyse(id, opts = {}) {
  const post = opts.post || (() => {});
  const book = await getBook(id);
  if (!book) throw new Error("Book not found");
  const vocab = opts.vocab || await loadVocab(opts.appBase);
  post({ type: "status", text: "Working out columns, tables and reading order..." });
  const pages = (await getPages(id)).sort((a, b) => a.page - b.page);
  if (!pages.length) return;
  // pages with no text: in a book that is mostly digital text they are art or maps; in a book that is mostly
  // without text, they are scans that need OCR
  const ok = pages.filter((p) => p.quality.status === "ok" || p.quality.status === "garbled").length;
  const scanned = ok < pages.length * 0.5;
  for (const p of pages) {
    if (p.quality.status !== "scan" && p.quality.status !== "empty" && p.quality.status !== "art") continue;
    const st = scanned ? "scan" : "art";
    p.quality.status = st; p.quality.needsOcr = scanned;
    p.quality.why = scanned ? "No text layer: a scanned page" : "No text: art, a map or a blank page";
    book.pageStatus[p.page] = st;
  }
  if (book.stats) { book.stats.status = {}; for (const k in book.pageStatus) book.stats.status[book.pageStatus[k]] = (book.stats.status[book.pageStatus[k]] || 0) + 1; }
  const furn = findFurniture(pages);
  const lays = [];
  for (let i = 0; i < pages.length; i++) {
    if (opts.signal && opts.signal.aborted) return;
    const L = layoutPage(pages[i], { fonts: book.fonts || {}, furn, vocab });
    L.book = id;
    lays.push(L);
    if (i % 25 === 24) { post({ type: "progress2", done: i + 1, total: pages.length }); await tick(); }
  }
  post({ type: "status", text: "Working out the book's styles..." });
  await tick();
  const sheet = buildStyleSheet(lays, book.styleOverrides || {});
  applyRoles(lays, sheet);
  for (let i = 0; i < lays.length; i += 50) await putLayouts(lays.slice(i, i + 50));
  // a short summary for the report
  const count = { heading: 0, para: 0, item: 0, table: 0, panel: 0, sub: 0 };
  for (const L of lays) eachBlock(L.blocks, (B) => { const k = B.type === "table" || B.type === "panel" ? B.type : B.role; if (count[k] != null) count[k]++; });
  Object.assign(book, { styles: sheet, layoutCount: count, stage2: STAGE2_VERSION, stage3: STAGE3_VERSION, laidOut: lays.length, updated: Date.now() });
  await putBook(book);
}

/** Saves a role change for one style and re-runs the layout with it. */
export async function setStyleRole(id, key, role, opts = {}) {
  const book = await getBook(id);
  if (!book) return;
  book.styleOverrides = book.styleOverrides || {};
  if (!role || role === "auto") delete book.styleOverrides[key]; else book.styleOverrides[key] = role;
  await putBook(book);
  await analyse(id, opts);
}
