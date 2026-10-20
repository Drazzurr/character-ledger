/* Importer v2, page side. Reads a PDF with the new engine (in a background worker) and shows what it found:
   the book's styles (with roles you can change), and a page viewer that draws the detected blocks over the
   page and lists them in reading order. Nothing is added to the Library yet (that starts in Phase 3).
   index.html loads this file only when it is needed. */

import { listBooks, getBook, getFile, deleteBook, getLayout } from "./db.js";
import { ROLES } from "./styles.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** The importer's **bold** and *italic* markup as HTML. */
const mdHTML = (s) => esc(s).replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");

let fbCtrl = null, worker = null, busy = false, msgText = "", progress = null, current = null, report = "", books = null;
let refresh = () => {}, appBase = null;
const view = { page: 0, html: "", layout: null, drawn: null };
// which sections are open, so a redraw doesn't fold them away
const openSec = new Set(["viewer"]);
const sec = (k) => `data-i2d="${k}"${openSec.has(k) ? " open" : ""}`;

function setMsg(t) { msgText = t; refresh(); }

/** Runs a job (read a book, re-run layout, change a style's role) in the worker, or on the page if workers fail. */
function runJob(job, onMsg) {
  return new Promise((resolve, reject) => {
    let settled = false, started = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const fallback = async () => {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      try {
        const core = await import("./core.js");
        fbCtrl = new AbortController();
        let r;
        if (job.cmd === "analyse") { await core.analyse(job.id, { appBase: job.appBase, post: onMsg }); r = { id: job.id }; }
        else if (job.cmd === "role") { await core.setStyleRole(job.id, job.key, job.role, { appBase: job.appBase, post: onMsg }); r = { id: job.id }; }
        else r = await core.run(Object.assign({}, job, { post: onMsg, signal: fbCtrl.signal }));
        fbCtrl = null;
        finish(resolve, r);
      } catch (e) { finish(reject, e); }
    };
    try {
      worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    } catch (e) { fallback(); return; }
    worker.onerror = (ev) => { if (!started) { if (ev && ev.preventDefault) ev.preventDefault(); fallback(); } else finish(reject, new Error("The background reader stopped unexpectedly.")); };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "ready") {
        started = true;
        const msg = Object.assign({}, job);
        msg.cmd = job.cmd || "run";
        worker.postMessage(msg);
        return;
      }
      if (m.type === "done") { worker.terminate(); worker = null; finish(resolve, m); return; }
      if (m.type === "error") {
        worker.terminate(); worker = null;
        if (m.stage === "load") fallback(); else finish(reject, new Error(m.message));
        return;
      }
      onMsg(m);
    };
    setTimeout(() => { if (!started && !settled) fallback(); }, 15000);
  });
}

async function start(job, doneText) {
  if (busy) return;
  busy = true; progress = null;
  setMsg("Starting...");
  try {
    const r = await runJob(job, (m) => {
      if (m.type === "status") setMsg(m.text);
      else if (m.type === "book") { current = m.id; setMsg("Reading " + m.title + " (" + m.numPages + " pages)..."); }
      else if (m.type === "progress") {
        progress = m;
        const n = m.to - m.from + 1, k = m.page - m.from + 1;
        if (k % 2 === 0 || k === n) setMsg("Reading page " + m.page + " of " + m.to + (m.skipped ? " (already read)" : "") + "...");
      } else if (m.type === "progress2") {
        progress = { from: 1, to: m.total, page: m.done };
        setMsg("Working out the layout: page " + m.done + " of " + m.total + "...");
      }
    });
    current = r.id;
    books = null;
    progress = null;
    await openBook(r.id);
    msgText = r.stopped ? "Stopped. Choose Resume to continue where it left off." : (doneText || "Done. Here is what the new reader found.");
  } catch (e) {
    msgText = String(e && e.message || e);
  } finally {
    busy = false; refresh();
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function labelOf(book, p) {
  const l = book.info && book.info.labels && book.info.labels[p - 1];
  return l != null && String(l) !== String(p) ? String(l) + " (PDF page " + p + ")" : "page " + p;
}

const ROLE_COLOR = { heading: "#d0342c", sub: "#0e8a8a", para: "#2f6fd6", item: "#1f9a55", quote: "#7a7a7a", table: "#d98a00", panel: "#9b3fb5" };
const roleName = (B) => B.type === "table" ? "table" : B.type === "panel" ? "panel" : B.role || "para";

/** Builds the HTML summary for one book from what is stored. */
async function buildReport(id) {
  const book = await getBook(id);
  if (!book) return "";
  const info = book.info || {};
  const statusPages = book.pageStatus || {};
  const read = Object.keys(statusPages).length;
  const need = Object.keys(statusPages).filter((p) => /scan|garbled|error/.test(statusPages[p])).map(Number).sort((a, b) => a - b);
  const art = Object.keys(statusPages).filter((p) => statusPages[p] === "art" || statusPages[p] === "empty").length;
  const meta = info.meta || {};
  const labels = info.labels;
  const labelSample = labels ? labels.slice(0, 6).join(", ") + (labels.length > 6 ? ", ..." : "") : "";
  const kv = (l, v) => `<div class="kv"><span>${esc(l)}</span><b style="font-weight:500">${v}</b></div>`;
  const c = book.layoutCount || {};
  let h = `<h3 style="margin:.8em 0 .4em">${esc(book.title)}</h3><div class="kvs">` +
    kv("Pages", `${info.numPages} in the PDF, ${read} read`) +
    kv("Made with", esc([meta.creator, meta.producer].filter(Boolean).join(" / ") || "Not recorded")) +
    kv("Printed page numbers", labels ? "Yes: " + esc(labelSample) : "No, PDF page numbers are used") +
    kv("Text check", `${read - need.length - art} with text${art ? ", " + art + " art or blank" : ""}${need.length ? ", <b>" + need.length + " need OCR</b>" : ""}`) +
    (book.laidOut ? kv("Found", `${c.heading || 0} headings, ${c.para || 0} paragraphs, ${c.item || 0} list items, ${c.table || 0} tables, ${c.panel || 0} boxed sections`) : "") +
    `</div>`;
  if (need.length) h += `<p class="hint">Pages that will need OCR: ${esc(need.slice(0, 30).map((p) => labelOf(book, p)).join(", "))}${need.length > 30 ? ", and " + (need.length - 30) + " more" : ""}. OCR arrives in Phase 5.</p>`;

  // the page viewer goes first: it is the quickest way to judge the result
  if (book.laidOut) {
    h += `<details class="item" ${sec("viewer")} style="margin-top:10px"><summary><span class="sum-t">Page viewer</span></summary><div class="ibody">
      <p class="hint" style="margin-top:0">Coloured boxes show what the importer found, numbered in reading order: <span style="color:${ROLE_COLOR.heading}">headings</span>, <span style="color:${ROLE_COLOR.sub}">sub-headings</span>, <span style="color:${ROLE_COLOR.para}">paragraphs</span>, <span style="color:${ROLE_COLOR.item}">list items</span>, <span style="color:${ROLE_COLOR.table}">tables</span> and <span style="color:${ROLE_COLOR.panel}">boxed text</span>. The text below is what the importer will work from.</p>
      <div class="btns" style="align-items:flex-end"><button class="btn sm" type="button" data-i2="prev">Previous</button>
      <label class="fld" style="margin:0;max-width:7em"><span>PDF page</span><input data-i2page inputmode="numeric" value="${view.page || ""}" aria-label="PDF page number"></label>
      <button class="btn sm" type="button" data-i2="next">Next</button></div>
      <div id="i2view">${view.html}</div></div></details>`;
  }

  // the book's styles, with the role each one plays; changing a role re-runs the layout
  const sheet = book.styles;
  if (sheet && sheet.styles) {
    const total = sheet.styles.reduce((a, x) => a + x.chars, 0);
    const shown = sheet.styles.filter((s) => s.chars >= 20 || /^h\d$|label|sub/.test(s.role)).slice(0, 30);
    const opts = (s) => ROLES.map(([v, t]) => `<option value="${v}"${s.role === v ? " selected" : ""}>${esc(t)}${s.auto === v && s.overridden ? " (automatic)" : ""}</option>`).join("") + (s.overridden ? `<option value="auto">Back to automatic</option>` : "");
    h += `<details class="item" ${sec("styles")}><summary><span class="sum-t">Book styles (${sheet.styles.length})</span></summary><div class="ibody">
      <p class="hint" style="margin-top:0">Every text style in the book and the part it plays. If one is wrong, change it here; the layout is worked out again and your choice is kept for this book.</p>
      <ul style="list-style:none;margin:0;padding:0">` + shown.map((s) => {
        const look = [s.family, s.size + " pt", s.bold ? "bold" : "", s.italic ? "italic" : "", s.sc ? "small caps" : "", s.color === "c" ? "coloured" : s.color === "w" ? "light" : ""].filter(Boolean).join(", ");
        const share = pct(s.chars, total);
        return `<li style="padding:8px 0;border-bottom:1px solid var(--line)">
          <div style="overflow-wrap:anywhere;font-weight:600">${esc(((s.samples && s.samples[0]) || "(no sample)").slice(0, 70))}</div>
          <div style="color:var(--muted);font-size:12.5px">${esc(look)} · ${share ? share + "%" : "under 1%"} of the text${s.why ? " · " + esc(s.why) : ""}${s.overridden ? " · <b>your choice</b>" : ""}</div>
          <select data-i2role="${esc(s.key)}" aria-label="Role of this style" style="margin-top:6px;max-width:100%">${opts(s)}</select></li>`;
      }).join("") + `</ul>${sheet.styles.length > shown.length ? `<p class="hint">${sheet.styles.length - shown.length} more styles are used for very little text.</p>` : ""}</div></details>`;
  }

  const ol = info.outline || [];
  h += `<details class="item" ${sec("bookmarks")}><summary><span class="sum-t">Bookmarks (${ol.length})</span></summary><div class="ibody">`;
  if (ol.length) {
    h += `<ul style="list-style:none;margin:0;padding:0">` + ol.slice(0, 120).map((o) => `<li style="padding:5px 0 5px ${Math.min(o.level, 4) * 16}px;border-bottom:1px solid var(--line)"><span style="${o.level ? "" : "font-weight:600"}">${esc(o.title)}</span> ${o.page ? (book.laidOut ? `<button class="btn sm" type="button" data-i2="go" data-p="${o.page}" style="padding:2px 8px;min-height:0">${esc(labelOf(book, o.page))}</button>` : `<span style="color:var(--muted);font-size:12.5px">${esc(labelOf(book, o.page))}</span>`) : ""}</li>`).join("") + `</ul>`;
    if (ol.length > 120) h += `<p class="hint">And ${ol.length - 120} more.</p>`;
  } else h += `<p class="hint">This PDF has no bookmarks. Chapters will be found from headings instead.</p>`;
  h += `</div></details>`;

  h += `<div class="btns">${!book.complete && book.fileStored ? `<button class="btn" type="button" data-act="imp2-resume" data-id="${esc(id)}">Resume</button>` : ""}${!book.laidOut && read ? `<button class="btn" type="button" data-i2="analyse">Work out the layout</button>` : ""}<button class="btn" type="button" data-act="imp2-del" data-id="${esc(id)}">Delete this book's import data</button></div>`;
  return h;
}

/* ---------------- page viewer ---------------- */

function blockHTML(B) {
  const n = `<span style="display:inline-block;min-width:1.6em;color:#fff;background:${ROLE_COLOR[roleName(B)] || "#666"};border-radius:4px;padding:0 4px;font-size:11px;text-align:center;margin-right:6px;vertical-align:1px">${B.i}</span>`;
  if (B.type === "panel") {
    return `<div style="border:2px solid ${ROLE_COLOR.panel};border-radius:8px;padding:8px 10px;margin:8px 0">${n}<span style="color:var(--muted);font-size:12.5px">Boxed text</span>${(B.blocks || []).map(blockHTML).join("")}</div>`;
  }
  if (B.type === "table" && B.table) {
    const T = B.table;
    const head = (T.head || []).map((r) => `<tr>${r.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`).join("");
    const body = T.rows.slice(0, 40).map((r) => `<tr>${r.map((c) => `<td>${mdHTML(c)}</td>`).join("")}</tr>`).join("");
    return `<div style="margin:8px 0">${n}${T.title ? `<b>${esc(T.title)}</b>` : `<span style="color:var(--muted);font-size:12.5px">Table</span>`}<div class="tblwrap"><table class="ctab"><thead>${head}</thead><tbody>${body}</tbody></table></div>${T.rows.length > 40 ? `<p class="hint">And ${T.rows.length - 40} more rows.</p>` : ""}</div>`;
  }
  if (B.type === "table") return `<p>${n}${esc(B.t)}</p>`;
  const text = mdHTML(B.md || B.t || "");
  const cont = B.cont ? `<span style="color:var(--muted);font-size:12px">continues from before · </span>` : "";
  if (B.role === "heading") {
    const sz = [0, 20, 18, 16, 15, 14][B.level] || 14;
    return `<div style="margin:12px 0 4px;font-size:${sz}px;font-weight:700">${n}<span style="color:var(--muted);font-size:11px;font-weight:600;margin-right:6px">H${B.level}</span>${text}</div>`;
  }
  if (B.role === "sub") return `<div style="margin:2px 0 6px;font-style:italic;color:var(--muted)">${n}${text}</div>`;
  if (B.role === "item") return `<div style="margin:4px 0 4px 0.6em">${n}${esc(B.bullet || "•")} ${cont}${text}</div>`;
  if (B.role === "quote") return `<p style="margin:6px 0;font-style:italic">${n}${cont}${text}</p>`;
  return `<p style="margin:6px 0">${n}${cont}${text}</p>`;
}

async function loadView(page) {
  const book = await getBook(current);
  if (!book) return;
  const n = book.info.numPages;
  page = Math.max(1, Math.min(n, page | 0 || 1));
  view.page = page;
  const L = await getLayout(current, page);
  view.layout = L;
  if (!L) {
    view.html = `<p class="hint">This page has not been read yet.</p>`;
  } else {
    const st = book.pageStatus && book.pageStatus[page];
    const note = st && st !== "ok" ? `<p class="hint">Text check for this page: ${esc(st === "art" ? "art or a map, no text" : st === "empty" ? "little or no text" : "needs OCR (Phase 5)")}.</p>` : "";
    view.html = `<div style="position:relative;margin:8px 0;max-width:640px" id="i2pagebox"><canvas id="i2canvas" style="width:100%;display:block;border:1px solid var(--line);border-radius:6px;background:#fff"></canvas><div id="i2overlay" style="position:absolute;inset:0"></div></div>
      <p class="hint" style="margin:4px 0 8px">${esc(labelOf(book, page))} of ${n}${L.furniture && L.furniture.length ? " · left out as page furniture: " + esc(L.furniture.slice(0, 6).map((f) => f.t).join(" · ")) : ""}</p>${note}
      <div style="border-top:1px solid var(--line);padding-top:6px">${L.blocks.map(blockHTML).join("") || `<p class="hint">No text blocks on this page.</p>`}</div>`;
  }
  view.drawn = null;
  report = await buildReport(current);
  refresh();
}

let pdfDocP = null, pdfDocFor = null;
async function pdfDoc() {
  if (pdfDocFor === current && pdfDocP) return pdfDocP;
  pdfDocFor = current;
  pdfDocP = (async () => {
    const blob = await getFile(current);
    if (!blob) return null;
    const base = new URL("vendor/pdfjs/", appBase).href;
    const m = await import(base + "pdf.mjs");
    m.GlobalWorkerOptions.workerSrc = base + "pdf.worker.mjs";
    return m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", isEvalSupported: false }).promise;
  })().catch(() => null);
  return pdfDocP;
}

/** Draws the page image and the block outlines after the viewer's HTML is on screen. */
async function drawView() {
  const cv = document.getElementById("i2canvas"), ov = document.getElementById("i2overlay");
  if (!cv || !view.layout || view.drawn === cv) return;
  view.drawn = cv;
  const L = view.layout;
  cv.style.aspectRatio = L.w + " / " + L.h;
  // outlines: positioned in percent of the page, so they follow the canvas size
  const boxes = [];
  const add = (B) => {
    const col = ROLE_COLOR[roleName(B)] || "#666";
    boxes.push(`<div title="${esc(roleName(B))} ${B.i}" style="position:absolute;left:${(B.x / L.w) * 100}%;top:${(B.y / L.h) * 100}%;width:${((B.x2 - B.x) / L.w) * 100}%;height:${((B.y2 - B.y) / L.h) * 100}%;border:1.5px solid ${col};background:${col}14;box-sizing:border-box"><span style="position:absolute;left:-1px;top:-1px;transform:translateY(-100%);background:${col};color:#fff;font:600 9px/1.3 system-ui,sans-serif;padding:0 3px;border-radius:2px">${B.i}</span></div>`);
    (B.blocks || []).forEach(add);
  };
  L.blocks.forEach(add);
  ov.innerHTML = boxes.join("");
  try {
    const doc = await pdfDoc();
    if (!doc || view.drawn !== cv) return;
    const page = await doc.getPage(view.page);
    const box = cv.parentElement.getBoundingClientRect();
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, (Math.max(320, box.width) * (window.devicePixelRatio || 1)) / vp1.width);
    const vp = page.getViewport({ scale });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
  } catch (e) {
    const ctx = cv.getContext("2d");
    cv.width = 600; cv.height = Math.round(600 * L.h / L.w);
    ctx.fillStyle = "#888"; ctx.font = "16px system-ui"; ctx.fillText("The page image could not be drawn here.", 20, 40);
  }
}

/* ---------------- book list and public API ---------------- */

async function booksHTML() {
  const list = (await listBooks()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!list.length) return `<p class="hint">No books read with the new importer yet.</p>`;
  return `<ul style="list-style:none;margin:0;padding:0">` + list.map((b) => {
    const read = Object.keys(b.pageStatus || {}).length;
    return `<li style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">${esc(b.title)}</div>
      <div style="color:var(--muted);font-size:12.5px">${read} of ${b.info ? b.info.numPages : "?"} pages read${b.laidOut ? "" : " · layout not worked out yet"}${b.fileStored ? "" : " · PDF not stored"}</div></div>
      <button class="btn sm" type="button" data-act="imp2-open" data-id="${esc(b.id)}">Open</button></li>`;
  }).join("") + `</ul>`;
}

async function openBook(id) {
  const same = current === id;
  current = id;
  const book = await getBook(id);
  if (!book) { report = ""; return; }
  // start the viewer on a page with a good amount of text
  let start = same && view.page ? view.page : 0;
  if (!start) {
    const ps = book.pageStatus || {};
    const okPages = Object.keys(ps).map(Number).sort((a, b) => a - b).filter((p) => ps[p] === "ok");
    start = okPages[Math.min(okPages.length - 1, 2)] || okPages[0] || 1;
  }
  if (book.laidOut) await loadView(start); else { view.layout = null; view.html = ""; report = await buildReport(id); }
}

/** HTML for the importer area inside Library > Import a book. */
export function html() {
  let h = `<div class="msg" role="status">${esc(msgText)}</div>`;
  if (busy && progress) {
    const n = progress.to - progress.from + 1, k = progress.page - progress.from + 1;
    h += `<div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:.4em 0"><div style="height:100%;width:${pct(k, n)}%;background:var(--accent)"></div></div>
      <div class="btns"><button class="btn sm" type="button" data-act="imp2-cancel">Stop</button></div>`;
  }
  if (books) h += `<h3 style="margin:.8em 0 .3em">Books read so far</h3>` + books;
  else if (report) h += report;
  if (view.layout && !books) setTimeout(drawView, 0);
  return h;
}

let wired = false;
/** Wires the module to the app: onChange is called whenever html() would change. */
export function attach(onChange, base) {
  refresh = () => { view.drawn = null; (onChange || (() => {}))(); };
  appBase = base || appBase || document.baseURI;
  if (wired) return;
  wired = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i2]");
    if (!b || busy) return;
    const a = b.dataset.i2;
    if (a === "prev") loadView(view.page - 1);
    else if (a === "next") loadView(view.page + 1);
    else if (a === "go") { loadView(+b.dataset.p).then(() => { const v = document.getElementById("i2view"); if (v) v.scrollIntoView({ block: "start" }); }); }
    else if (a === "analyse") start({ cmd: "analyse", id: current, appBase }, "Layout worked out.");
  });
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d && d.dataset && d.dataset.i2d) { if (d.open) openSec.add(d.dataset.i2d); else openSec.delete(d.dataset.i2d); }
  }, true);
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.i2page != null) loadView(+t.value);
    if (t.dataset.i2role != null && !busy) start({ cmd: "role", id: current, key: t.dataset.i2role, role: t.value, appBase }, "Style updated and the layout worked out again.");
  });
}

export function inspect(file, opts) {
  books = null;
  if (opts && opts.appBase) appBase = opts.appBase;
  return start({ cmd: "run", file, name: file.name, appBase, from: opts.from, to: opts.to, storeFile: true });
}

export async function action(name, id, opts) {
  try {
    if (opts && opts.appBase) appBase = opts.appBase;
    if (name === "cancel") { if (worker) worker.postMessage({ cmd: "cancel" }); else if (fbCtrl) fbCtrl.abort(); setMsg("Stopping after this page..."); return; }
    if (name === "list") { books = await booksHTML(); refresh(); return; }
    if (name === "open") { books = null; msgText = ""; view.page = 0; pdfDocFor = null; await openBook(id); refresh(); return; }
    if (name === "del") {
      await deleteBook(id);
      if (current === id) { current = null; report = ""; view.layout = null; view.html = ""; pdfDocFor = null; }
      books = await booksHTML(); setMsg("Deleted the stored copy and everything read from it.");
      return;
    }
    if (name === "resume") {
      const book = await getBook(id), file = await getFile(id);
      if (!book || !file) { setMsg("The PDF is no longer stored. Choose it again to continue."); return; }
      books = null;
      await start({ cmd: "run", file, name: book.file && book.file.name, appBase, from: 1, to: 0, storeFile: false });
    }
  } catch (e) { setMsg(String(e && e.message || e)); }
}

export const isBusy = () => busy;
