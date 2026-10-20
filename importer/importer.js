/* Importer v2, page side. Phase 1: reads a PDF with the new engine and reports what it found.
   Nothing is added to the Library yet. index.html loads this file only when it is needed. */

import { listBooks, getBook, getPages, getFile, deleteBook } from "./db.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let fbCtrl = null, worker = null, busy = false, msgText = "", progress = null, current = null, report = "", books = null, refresh = () => {};

function setMsg(t) { msgText = t; refresh(); }

/** Runs Stage 1 in a worker; falls back to the page itself if module workers are unavailable. */
function runJob(job, onMsg) {
  return new Promise((resolve, reject) => {
    let settled = false, started = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const fallback = async (why) => {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      try {
        const { run } = await import("./core.js");
        fbCtrl = new AbortController();
        const r = await run(Object.assign({}, job, { post: onMsg, signal: fbCtrl.signal }));
        fbCtrl = null;
        finish(resolve, r);
      } catch (e) { finish(reject, e); }
    };
    try {
      worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    } catch (e) { fallback("no worker"); return; }
    worker.onerror = (ev) => { if (!started) { if (ev && ev.preventDefault) ev.preventDefault(); fallback("worker failed"); } else finish(reject, new Error("The background reader stopped unexpectedly.")); };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "ready") { started = true; worker.postMessage({ cmd: "run", file: job.file, name: job.name, appBase: job.appBase, from: job.from, to: job.to, storeFile: job.storeFile }); return; }
      if (m.type === "done") { worker.terminate(); worker = null; finish(resolve, m); return; }
      if (m.type === "error") {
        worker.terminate(); worker = null;
        if (m.stage === "load") fallback("pdf.js in worker"); else finish(reject, new Error(m.message));
        return;
      }
      onMsg(m);
    };
    setTimeout(() => { if (!started && !settled) fallback("worker timeout"); }, 15000);
  });
}

async function start(job) {
  if (busy) return;
  busy = true; progress = null; report = "";
  setMsg("Starting...");
  try {
    const r = await runJob(job, (m) => {
      if (m.type === "status") setMsg(m.text);
      else if (m.type === "book") { current = m.id; setMsg("Reading " + m.title + " (" + m.numPages + " pages)..."); }
      else if (m.type === "progress") {
        progress = m;
        const n = m.to - m.from + 1, k = m.page - m.from + 1;
        if (k % 2 === 0 || k === n) setMsg("Reading page " + m.page + " of " + m.to + (m.skipped ? " (already read)" : "") + "...");
      }
    });
    current = r.id;
    report = await buildReport(r.id);
    books = null;
    setMsg(r.stopped ? "Stopped. Choose Resume to continue where it left off." : "Done. Here is what the new reader found.");
  } catch (e) {
    setMsg(String(e && e.message || e));
  } finally {
    busy = false; refresh();
  }
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function fontLabel(f) {
  if (!f) return "Unknown font";
  const bits = [f.bold ? "bold" : "", f.italic ? "italic" : "", f.smallCaps ? "small caps" : ""].filter(Boolean).join(", ");
  return f.name + (bits ? " (" + bits + ")" : "");
}

function labelOf(book, p) {
  const l = book.info && book.info.labels && book.info.labels[p - 1];
  return l != null && String(l) !== String(p) ? String(l) + " (PDF page " + p + ")" : "page " + p;
}

/** Builds the HTML summary for one book from what is stored. */
export async function buildReport(id) {
  const book = await getBook(id);
  if (!book) return "";
  const info = book.info || {}, st = book.stats || { fonts: {}, colors: {}, sizes: {}, status: {} };
  const statusPages = book.pageStatus || {};
  const read = Object.keys(statusPages).length;
  const need = Object.keys(statusPages).filter((p) => statusPages[p] === "scan" || statusPages[p] === "garbled" || statusPages[p] === "error").map(Number).sort((a, b) => a - b);
  const empty = Object.keys(statusPages).filter((p) => statusPages[p] === "empty").length;
  const totalChars = Object.values(st.fonts).reduce((a, b) => a + b, 0);
  // the same font can appear under several ids (one per embedded subset); group them by name and style
  const groups = {};
  for (const id of Object.keys(st.fonts)) {
    const f = (book.fonts && book.fonts[id]) || { name: id };
    const key = f.name + "|" + f.weight + "|" + f.italic;
    if (!groups[key]) groups[key] = { f, n: 0 };
    groups[key].n += st.fonts[id];
  }
  const fonts = Object.values(groups).sort((a, b) => b.n - a.n);
  const share = (n) => { const v = pct(n, totalChars); return v ? v + "%" : "<1%"; };
  const colors = Object.keys(st.colors).sort((a, b) => st.colors[b] - st.colors[a]).slice(0, 6);
  const meta = info.meta || {};
  const labels = info.labels;
  const labelSample = labels ? labels.slice(0, 6).join(", ") + (labels.length > 6 ? ", ..." : "") : "";

  const kv = (l, v) => `<div class="kv"><span>${esc(l)}</span><b style="font-weight:500">${v}</b></div>`;
  const good = read - need.length - empty;
  let h = `<h3 style="margin:.8em 0 .4em">${esc(book.title)}</h3><div class="kvs">` +
    kv("Pages", `${info.numPages} in the PDF, ${read} read`) +
    kv("Made with", esc([meta.creator, meta.producer].filter(Boolean).join(" / ") || "Not recorded")) +
    kv("Printed page numbers", labels ? "Yes: " + esc(labelSample) : "No, PDF page numbers are used") +
    kv("Tagged structure", info.tagged ? "Yes, headings and paragraphs are marked" : "No, layout comes from positions and fonts") +
    kv("Text check", `${good} good${empty ? ", " + empty + " art or blank" : ""}${need.length ? ", <b>" + need.length + " need OCR</b>" : ""}`) +
    `</div>`;

  if (need.length) {
    h += `<p class="hint">Pages that will need OCR (scanned or unreadable text): ${esc(need.slice(0, 40).map((p) => labelOf(book, p)).join(", "))}${need.length > 40 ? ", and " + (need.length - 40) + " more" : ""}. OCR arrives in Phase 5.</p>`;
  }

  const ol = info.outline || [];
  h += `<details class="item"${ol.length ? " open" : ""} style="margin-top:10px"><summary><span class="sum-t">Bookmarks (${ol.length})</span></summary><div class="ibody">`;
  if (ol.length) {
    h += `<ul style="list-style:none;margin:0;padding:0">` + ol.slice(0, 80).map((o) => `<li style="padding:5px 0 5px ${Math.min(o.level, 4) * 16}px;border-bottom:1px solid var(--line)"><span style="${o.level ? "" : "font-weight:600"}">${esc(o.title)}</span> <span style="color:var(--muted);font-size:12.5px;white-space:nowrap">${o.page ? esc(labelOf(book, o.page)) : "no page"}</span></li>`).join("") + `</ul>`;
    if (ol.length > 80) h += `<p class="hint">And ${ol.length - 80} more.</p>`;
  } else h += `<p class="hint">This PDF has no bookmarks. Chapters will be found from headings instead.</p>`;
  h += `</div></details>`;

  const sw = (c) => `<span style="display:inline-block;width:.9em;height:.9em;border-radius:2px;vertical-align:-.12em;border:1px solid var(--line);background:${esc(c)}"></span>`;
  const styleOf = (f) => [f.bold ? "bold" : f.weight === 500 ? "medium" : "", f.italic ? "italic" : "", f.smallCaps ? "small caps" : ""].filter(Boolean).join(", ") || "regular";
  h += `<details class="item"><summary><span class="sum-t">Fonts (${fonts.length})</span></summary><div class="ibody"><ul style="list-style:none;margin:0;padding:0">` +
    fonts.slice(0, 15).map(({ f, n }) => `<li style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)"><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(f.name)} <span style="color:var(--muted);font-size:12.5px">${esc(styleOf(f))}</span></span><span style="color:var(--muted);white-space:nowrap">${share(n)}</span></li>`).join("") +
    `</ul>${fonts.length > 15 ? `<p class="hint">And ${fonts.length - 15} more used for very little text.</p>` : ""}<p class="hint">Text colours: ${colors.map((c) => `${sw(c)} ${esc(c)} ${share(st.colors[c])}`).join(" &nbsp; ")}</p></div></details>`;

  // a sample of what one page looks like to the importer
  // sample: the fullest of the first good pages, so it shows body text rather than a title page
  const goodPages = Object.keys(statusPages).map(Number).sort((a, b) => a - b).filter((p) => statusPages[p] === "ok");
  if (goodPages.length) {
    const near = await getPages(id, goodPages[0], goodPages[Math.min(goodPages.length, 12) - 1]);
    const pg = near.filter((x) => x.quality.status === "ok").sort((a, b) => b.runs.length - a.runs.length)[0];
    const firstGood = pg && pg.page;
    if (pg) {
      const rows = pg.runs.slice(0, 25).map((r) => {
        const f = book.fonts[r.f] || {};
        return `<li style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="overflow-wrap:anywhere">${esc(r.t.length > 80 ? r.t.slice(0, 80) + "..." : r.t)}</div>
          <div style="color:var(--muted);font-size:12.5px">${sw(r.c)} ${esc(f.name || "")}${f.bold || r.fb ? ", bold" : ""}${f.italic ? ", italic" : ""}, ${r.s.toFixed(1)} pt</div></li>`;
      }).join("");
      h += `<details class="item"><summary><span class="sum-t">Sample: ${esc(labelOf(book, firstGood))}</span></summary><div class="ibody"><p class="hint">The first pieces of text on this page as the importer sees them. Boxes and shading found: ${pg.boxes.length}; images: ${pg.images.length}.</p><ul style="list-style:none;margin:0;padding:0">${rows}</ul></div></details>`;
    }
  }

  h += `<div class="btns">${!book.complete && book.fileStored ? `<button class="btn" type="button" data-act="imp2-resume" data-id="${esc(id)}">Resume</button>` : ""}<button class="btn" type="button" data-act="imp2-del" data-id="${esc(id)}">Delete this book's import data</button></div>`;
  return h;
}

async function booksHTML() {
  const list = (await listBooks()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!list.length) return `<p class="hint">No books read with the new importer yet.</p>`;
  return `<ul style="list-style:none;margin:0;padding:0">` + list.map((b) => {
    const read = Object.keys(b.pageStatus || {}).length;
    return `<li style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">${esc(b.title)}</div>
      <div style="color:var(--muted);font-size:12.5px">${read} of ${b.info ? b.info.numPages : "?"} pages read${b.fileStored ? "" : " · PDF not stored"}</div></div>
      <button class="btn sm" type="button" data-act="imp2-open" data-id="${esc(b.id)}">Open</button></li>`;
  }).join("") + `</ul>`;
}

/** HTML for the importer area inside Library > Import a book. */
export function html() {
  let h = `<div class="msg" role="status">${esc(msgText)}</div>`;
  if (busy && progress) {
    const n = progress.to - progress.from + 1, k = progress.page - progress.from + 1;
    h += `<div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:.4em 0"><div style="height:100%;width:${pct(k, n)}%;background:var(--accent)"></div></div>
      <div class="btns"><button class="btn sm" type="button" data-act="imp2-cancel">Stop</button></div>`;
  }
  if (report) h += report;
  if (books) h += `<h3 style="margin:.8em 0 .3em">Books read so far</h3>` + books;
  return h;
}

/** Wires the module to the app: onChange is called whenever html() would change. */
export function attach(onChange) { refresh = onChange || (() => {}); }

export function inspect(file, opts) {
  return start({ file, name: file.name, appBase: opts.appBase, from: opts.from, to: opts.to, storeFile: true });
}

export async function action(name, id, opts) {
  try {
    if (name === "cancel") { if (worker) worker.postMessage({ cmd: "cancel" }); else if (fbCtrl) fbCtrl.abort(); setMsg("Stopping after this page..."); return; }
    if (name === "list") { books = await booksHTML(); report = ""; refresh(); return; }
    if (name === "open") { current = id; report = await buildReport(id); books = null; msgText = ""; refresh(); return; }
    if (name === "del") {
      await deleteBook(id);
      if (current === id) { current = null; report = ""; }
      books = await booksHTML(); setMsg("Deleted the stored copy and everything read from it.");
      return;
    }
    if (name === "resume") {
      const book = await getBook(id), file = await getFile(id);
      if (!book || !file) { setMsg("The PDF is no longer stored. Choose it again to continue."); return; }
      await start({ file, name: book.file && book.file.name, appBase: opts.appBase, from: 1, to: 0, storeFile: false });
    }
  } catch (e) { setMsg(String(e && e.message || e)); }
}

export const isBusy = () => busy;
