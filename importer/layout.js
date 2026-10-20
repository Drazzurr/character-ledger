/* Stage 2: layout analysis. Turns a page's glyph runs (Stage 1) into blocks in reading order:
   paragraphs, headings-to-be, list items, tables and panels (sidebars, boxed text, framed tables).
   Pure functions over plain data, so it runs the same in the worker, on the page and in tests.

   Approach (see the design spec): remove page furniture, build lines, find panels and tables first,
   split the page into bands at elements that cross a column gutter, cut each band into columns
   (XY-cut, columns before rows), then build paragraphs inside each column. */

import { knownWord } from "./vocab.js";

export const STAGE2_VERSION = 1;

const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const r1 = (v) => Math.round(v * 10) / 10;
const BULLET = /^\s*([•●▪◦‣■□➢➤►–—-]|\(\w\)|\d{1,2}[.)])\s/;
const BULLET_ONLY = /^\s*[•●▪◦‣■□➢➤►]\s*$/;

/* ---------------- runs and style keys ---------------- */

/** Colour class used in style keys: dark text, light text, or coloured. */
export function colorClass(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx - mn < 40) return l < 110 ? "k" : l > 200 ? "w" : "g";
  return "c";
}

/** A style key: family | weight | italic | small caps | size | colour class. */
export function styleKey(run, fonts) {
  const f = fonts[run.f] || {};
  const w = run.fb ? 700 : (f.weight || 400);
  return [f.family || f.name || "?", w >= 600 ? "b" : w === 500 ? "m" : "r", f.italic ? "i" : "", f.smallCaps ? "sc" : "",
    (Math.round(run.s * 2) / 2).toFixed(1), colorClass(run.c)].join("|");
}

/* ---------------- furniture (running heads, page numbers, edge tabs) ---------------- */

const normFurn = (t) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function zoneOf(run, page) {
  const h = page.h || 792, w = page.w || 612;
  if (run.r) return "rot";
  if (run.b < h * 0.1) return "top";
  if (run.y > h * 0.9) return "bot";
  if (run.x + run.w < w * 0.08 || run.x > w * 0.92) return "side";
  return "";
}

/** The outer strip of the page, where running heads and feet sit (tighter than the furniture zone). */
const edgeZone = (run, page) => run.b < (page.h || 792) * 0.065 || run.y > (page.h || 792) * 0.935;

/** True when other text continues the run on its line (so it is the start of body text, not a running head). */
function hasLineMates(run, runs) {
  for (const q of runs) {
    if (q === run || Math.abs(q.b - run.b) > run.s * 0.4) continue;
    if (q.t === run.t && Math.abs(q.x - run.x) < 1.5) continue; // the same text drawn twice
    const gap = q.x >= run.x ? q.x - (run.x + run.w) : run.x - (q.x + q.w);
    if (gap < run.s * 1.2) return true;
  }
  return false;
}

/** Book-wide pass: text that repeats at the same place on many pages is furniture. */
export function findFurniture(pages) {
  const sizes = {};
  for (const p of pages) for (const r of p.runs) { const k = Math.round(r.s * 2) / 2; sizes[k] = (sizes[k] || 0) + r.t.length; }
  const body = +Object.keys(sizes).sort((a, b) => sizes[b] - sizes[a])[0] || 10;
  // the body font: the font with the most text at the body size
  const bf = {};
  for (const p of pages) for (const r of p.runs) if (Math.abs(r.s - body) < 0.6) bf[r.f] = (bf[r.f] || 0) + r.t.length;
  const bodyFont = Object.keys(bf).sort((a, b) => bf[b] - bf[a])[0];
  // how often each font+size is used away from the page edges: running-head styles are not
  const styleUse = new Map();
  for (const p of pages) for (const r of p.runs) {
    const sk = r.f + "|" + Math.round(r.s * 2);
    const u = styleUse.get(sk) || { edge: 0, body: 0 };
    if (edgeZone(r, p)) u.edge++; else u.body++;
    styleUse.set(sk, u);
  }
  const edgeOnly = (r) => { const u = styleUse.get(r.f + "|" + Math.round(r.s * 2)); return u && u.body <= Math.max(2, u.edge * 0.05); };
  const seen = new Map();
  for (const p of pages) {
    const keys = new Set();
    for (const r of p.runs) {
      const z = zoneOf(r, p);
      if (!z || z === "rot") continue;
      const num = /^\d+$/.test(r.t.trim());
      if (!num && hasLineMates(r, p.runs)) continue;
      if (z !== "side" || num) keys.add(z + "|" + normFurn(r.t) + "|" + Math.round(r.b / 6));
      // running heads and feet change wording by chapter but keep their font, size and place
      if (edgeZone(r, p) && r.f !== bodyFont && r.s <= body * 1.25 && edgeOnly(r)) keys.add("sig|" + z + "|" + r.f + "|" + Math.round(r.s * 2) + "|" + Math.round(r.b / 4));
    }
    for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const n = pages.length;
  const need = Math.max(2, Math.min(8, Math.ceil(n * 0.2)));
  // printed page numbers run at a fixed offset from the PDF page number (often 0, sometimes -1 or -7)
  const offs = new Map();
  for (const p of pages) {
    const seenP = new Set();
    for (const r of p.runs) {
      const z = zoneOf(r, p);
      if (!z || z === "rot" || !/^\d{1,4}$/.test(r.t.trim())) continue;
      const o = +r.t.trim() - p.page;
      if (!seenP.has(o)) { seenP.add(o); offs.set(o, (offs.get(o) || 0) + 1); }
    }
  }
  const offsets = new Set([...offs].filter(([o, c]) => c >= Math.max(2, n * 0.15)).map(([o]) => o));
  const keys = new Set();
  for (const [k, c] of seen) if (c >= need) keys.add(k);
  return { keys, body, bodyFont, need, offsets };
}

function isFurniture(run, page, furn) {
  const z = zoneOf(run, page);
  if (!z) return false;
  if (z === "rot") return true;
  const t = run.t.trim();
  if (!/^\d+$/.test(t) && hasLineMates(run, page.runs)) return false;
  if (/^\d{1,4}$/.test(t) && (z === "top" || z === "bot" || z === "side")) {
    // page numbers: match the printed label, or the book's usual offset from the PDF page number
    const off = +t - page.page;
    if ((page.label && t === String(page.label)) || (furn && furn.offsets && furn.offsets.has(off))) return true;
  }
  if (page.label && t === String(page.label) && z) return true;
  if (furn && furn.keys.has(z + "|" + normFurn(run.t) + "|" + Math.round(run.b / 6)) && run.s <= (furn.body || 10) * 1.3) return true;
  if (furn && edgeZone(run, page) && furn.keys.has("sig|" + z + "|" + run.f + "|" + Math.round(run.s * 2) + "|" + Math.round(run.b / 4))) return true;
  return false;
}

/* ---------------- lines ---------------- */

function prepRuns(page, furn) {
  const keep = [], furniture = [];
  const runs = page.runs.filter((r) => r.t && r.t.trim() && !(r.inv && !page.quality.ocrLayer));
  // text drawn twice at the same place (outlines, fake bold, coloured overprint): keep the last one drawn
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    let dup = false;
    for (let j = i + 1; j < Math.min(runs.length, i + 40); j++) {
      const q = runs[j];
      if (q.t === r.t && Math.abs(q.x - r.x) < 1.5 && Math.abs(q.b - r.b) < 1.5) { dup = true; break; }
    }
    if (!dup) out.push(r);
  }
  for (const r of out) (isFurniture(r, page, furn) ? furniture : keep).push(r);
  return { runs: keep, furniture };
}

const rx2 = (r) => r.x + r.w;

/** Groups runs into lines by baseline and horizontal closeness. Lines never jump a column gutter. */
export function buildLines(runs, fonts) {
  const rs = runs.slice().sort((a, b) => a.b - b.b || a.x - b.x);
  const lines = [];
  const open = [];
  for (const r of rs) {
    let best = null, bestD = 1e9;
    for (const L of open) {
      const tolB = (Math.abs(r.s - L.s) > 0.5 ? 0.55 : 0.32) * Math.max(Math.min(r.s, L.s), 4);
      if (Math.abs(r.b - L.b) > tolB) continue;
      const gap = r.x - L.x2;
      const maxGap = Math.max(1.0 * Math.max(r.s, L.s), 6);
      if (gap > maxGap || r.x2 < L.x - 1) continue;
      if (gap < -Math.min(r.w, L.x2 - L.x) * 0.6) continue; // overlapping text: different layer
      const d = Math.abs(r.b - L.b) + Math.max(0, gap) * 0.1;
      if (d < bestD) { bestD = d; best = L; }
    }
    const item = Object.assign({}, r, { x2: rx2(r), k: styleKey(r, fonts) });
    if (best) {
      best.runs.push(item);
      best.x2 = Math.max(best.x2, item.x2);
      best.y = Math.min(best.y, r.y);
      best.y2 = Math.max(best.y2, r.b + r.s * 0.22);
      if (r.s > best.s * 1.05 && r.t.trim().length > 1) { best.s = r.s; best.b = r.b; }
    } else {
      const L = { runs: [item], x: r.x, x2: item.x2, y: r.y, y2: r.b + r.s * 0.22, b: r.b, s: r.s };
      lines.push(L); open.push(L);
      if (open.length > 60) open.shift();
    }
  }
  for (const L of lines) finishLine(L);
  return lines;
}

function mergeFakeSmallCaps(runs) {
  const out = [];
  const caps = (t) => /[A-Z]/.test(t) && !/[a-z]/.test(t);
  for (const r of runs) {
    const p = out[out.length - 1];
    if (p && caps(p.t) && caps(r.t) && p.f === r.f && p.c === r.c && Math.abs(p.s - r.s) > 0.4 &&
        Math.min(p.s, r.s) / Math.max(p.s, r.s) > 0.6 && r.x - p.x2 < Math.max(p.s, r.s) * 0.35 && Math.abs(p.b - r.b) < 1.5) {
      const big = p.s >= r.s ? p : r;
      const gap = r.x - p.x2 > Math.min(p.s, r.s) * 0.15 && !/\s$/.test(p.t) && !/^\s/.test(r.t) ? " " : "";
      const k = big.k.split("|"); k[3] = "sc";
      out[out.length - 1] = Object.assign({}, big, { t: p.t + gap + r.t, x: p.x, x2: r.x2, w: r.x2 - p.x, s: big.s, b: big.b, y: Math.min(p.y, r.y), k: k.join("|"), fsc: 1 });
    } else out.push(r);
  }
  return out;
}

/** "14 (+2) 12 (+1) 10 (+0) ..." printed as one piece of text: split into one cell per score. */
function splitScoreRuns(runs) {
  const out = [];
  for (const r of runs) {
    const m = r.t.match(/\d+\s*\([+\-−–]?\d+\)/g);
    if (m && m.length >= 4 && r.t.replace(/\d+\s*\([+\-−–]?\d+\)|\s/g, "") === "") {
      const per = r.w / r.t.length;
      let at = 0;
      for (const piece of m) {
        const i = r.t.indexOf(piece, at);
        out.push(Object.assign({}, r, { t: piece, x: r.x + i * per, w: piece.length * per, x2: r.x + (i + piece.length) * per }));
        at = i + piece.length;
      }
    } else out.push(r);
  }
  return out;
}

function finishLine(L) {
  L.runs.sort((a, b) => a.x - b.x);
  L.runs = splitScoreRuns(mergeFakeSmallCaps(L.runs));
  let t = "";
  let prev = null;
  for (const r of L.runs) {
    if (prev) {
      const gap = r.x - prev.x2;
      if (gap > Math.min(r.s, prev.s) * 0.15 && !/\s$/.test(t) && !/^\s/.test(r.t)) t += " ";
    }
    t += r.t;
    prev = r;
  }
  L.t = t.replace(/\s+/g, " ").trim();
  L.x = Math.min(...L.runs.map((r) => r.x));
  L.x2 = Math.max(...L.runs.map((r) => r.x2));
  // dominant style by characters
  const by = {};
  for (const r of L.runs) by[r.k] = (by[r.k] || 0) + r.t.replace(/\s/g, "").length;
  L.k = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
  L.hy = L.runs.length && L.runs[L.runs.length - 1].hy ? 1 : 0;
  return L;
}

/* ---------------- panels (boxed areas) and table shading ---------------- */

const inside = (L, b, pad = 1) => (L.x + L.x2) / 2 >= b.x - pad && (L.x + L.x2) / 2 <= b.x + b.w + pad && (L.y + L.y2) / 2 >= b.y - pad && (L.y + L.y2) / 2 <= b.y + b.h + pad;
const lightFill = (hex) => hex && colorClass(hex) !== "k";

function findPanels(page, lines, body) {
  const W = page.w, H = page.h;
  const cands = [];
  for (const b of page.boxes || []) {
    if (b.w > W * 0.9 && b.h > H * 0.9) continue;                // page background
    if (b.w < 40 || b.h < Math.max(18, body * 2.2)) continue;   // rules, underlines, text highlights
    if (b.x + b.w < 0 || b.x > W || b.y + b.h < 0 || b.y > H) continue; // other half of a spread
    const inner = lines.filter((L) => inside(L, b));
    if (!inner.length) continue;
    // a dark box that only sits behind one line of text is a highlight, not a panel
    if (!lightFill(b.fill) && b.fill && inner.length === 1 && b.h < inner[0].s * 2.2) continue;
    cands.push({ x: b.x, y: b.y, w: b.w, h: b.h, fill: b.fill, stroke: b.stroke, n: inner.length });
  }
  // keep the outermost of nested boxes, and drop exact duplicates
  cands.sort((a, b) => b.w * b.h - a.w * a.h);
  const out = [];
  for (const c of cands) {
    if (out.some((o) => c.x >= o.x - 2 && c.y >= o.y - 2 && c.x + c.w <= o.x + o.w + 2 && c.y + c.h <= o.y + o.h + 2)) continue;
    // a "panel" that holds most of the page's text is a page frame, not a sidebar
    if (c.n > lines.length * 0.85 && c.w > W * 0.6 && c.h > H * 0.6) continue;
    out.push(c);
  }
  return out;
}

/** Alternating shaded rows (striped tables). Returns row bands merged across cells. */
function shadedRows(page, body) {
  const bands = [];
  for (const b of page.boxes || []) {
    if (!b.fill || !lightFill(b.fill) || b.fill === "#ffffff") continue;
    if (b.h < body * 0.8 || b.h > body * 3.2 || b.w < 8) continue;
    const m = bands.find((o) => o.fill === b.fill && Math.abs(o.y - b.y) < 1.5 && Math.abs(o.h - b.h) < 1.5 && b.x <= o.x + o.w + 2 && b.x + b.w >= o.x - 2);
    if (m) { const x2 = Math.max(m.x + m.w, b.x + b.w); m.x = Math.min(m.x, b.x); m.w = x2 - m.x; }
    else bands.push({ x: b.x, y: b.y, w: b.w, h: b.h, fill: b.fill });
  }
  // groups of 2+ bands with the same left and right edges, stacked
  bands.sort((a, b) => a.y - b.y);
  const groups = [];
  for (const b of bands) {
    if (b.w < 60) continue;
    const g = groups.find((G) => Math.abs(G.x - b.x) < 4 && Math.abs(G.x + G.w - (b.x + b.w)) < 4 && b.y - (G.y + G.h) < b.h * 3.5);
    if (g) { g.bands.push(b); g.h = b.y + b.h - g.y; } else groups.push({ x: b.x, y: b.y, w: b.w, h: b.h, bands: [b] });
  }
  return groups.filter((g) => g.bands.length >= 2);
}

/* ---------------- tables from aligned text ---------------- */

/** Baseline rows: fragments (lines) that share a baseline within the given set. */
function baselineRows(lines) {
  const rows = [];
  for (const L of lines.slice().sort((a, b) => a.b - b.b || a.x - b.x)) {
    const r = rows.find((R) => Math.abs(R.b - L.b) < Math.min(R.s, L.s) * 0.35);
    if (r) { r.frags.push(L); r.s = Math.max(r.s, L.s); } else rows.push({ b: L.b, s: L.s, frags: [L] });
  }
  for (const r of rows) r.frags.sort((a, b) => a.x - b.x);
  return rows;
}

/** Finds tables made only of aligned text (no shading or rules) among a set of lines. */
function alignedTables(lines, area, opts = {}) {
  const rows = baselineRows(lines);
  const W = area.w || 500;
  const prose = (f) => f.t.length > 45 && f.x2 - f.x > W * 0.25 && /[a-z]{2,} [a-z]{2,} [a-z]{2,}/.test(f.t);
  const isRow = (R) => {
    if (opts.noProse && R.frags.some(prose)) return false; // across columns, a line of running text is not a cell
    if (R.frags.length >= 3) {
      // short cells; a row of 4+ cells may have one long description cell
      const wide = R.frags.filter((f) => f.x2 - f.x > W * 0.42).length;
      return wide === 0 || (wide === 1 && R.frags.length >= 4);
    }
    if (R.frags.length === 2) return R.frags.every((f) => f.x2 - f.x < W * 0.3) && R.frags[1].x - R.frags[0].x2 > R.s * 1.2;
    return false;
  };
  const anchorsMatch = (A, B) => {
    let n = 0;
    for (const f of A.frags) if (B.frags.some((g) => Math.abs(g.x - f.x) < 3 || Math.abs(g.x2 - f.x2) < 3 || Math.abs((g.x + g.x2) / 2 - (f.x + f.x2) / 2) < 3)) n++;
    return n >= Math.min(2, A.frags.length);
  };
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3 || (run.length === 2 && run.every((r) => r.frags.length >= 4))) {
      const fr = run.flatMap((R) => R.frags);
      out.push({ x: Math.min(...fr.map((f) => f.x)), x2: Math.max(...fr.map((f) => f.x2)), y: Math.min(...fr.map((f) => f.y)), y2: Math.max(...fr.map((f) => f.y2)), rows: run.slice() });
    }
    run = [];
  };
  for (const R of rows) {
    const prev = run[run.length - 1];
    const lastReal = [...run].reverse().find((x) => !x.cont) || prev;
    if (isRow(R) && (!prev || (R.b - prev.b < R.s * 3.2 && anchorsMatch(R, lastReal)))) run.push(R);
    else if (prev && R.b - prev.b < R.s * 1.8 && R.frags.length <= 2 && R.frags.every((f) => f.x >= Math.min(...lastReal.frags.map((g) => g.x)) - 2)) {
      // a wrapped cell inside the table: keep going
      run.push(Object.assign(R, { cont: true }));
    } else { flush(); if (isRow(R)) run.push(R); }
  }
  flush();
  // a "table" needs 3 real rows, or 2 rows of 4+ cells (an ability score row: STR DEX CON ... over the values)
  return out.filter((t) => { const real = t.rows.filter((r) => !r.cont); return real.length >= 3 || (real.length === 2 && real.every((r) => r.frags.length >= 4)); });
}

/* ---------------- table structure ---------------- */

function splitFragment(f, bounds) {
  // a fragment that spans several columns (e.g. "2nd 3rd 4th" in one run): share its words across them
  const words = f.t.split(/\s+/);
  // only value-like words are shared out ("2nd 3rd 4th", "— — —", "1 2 3"); header phrases are spanning labels
  if (!words.every((w) => /^(\+?-?\d+(st|nd|rd|th)?|[—–-]|\d*d\d+|[A-F][+-]?)$/i.test(w))) return null;
  const cover = bounds.filter((c) => c.x2 > f.x + 1 && c.x < f.x2 - 1);
  if (cover.length < 2 || words.length !== cover.length) return null;
  return cover.map((c, i) => ({ col: bounds.indexOf(c), t: words[i] }));
}

/** Builds rows and columns from the lines inside a table area. */
export function tableStructure(lines, opts = {}) {
  // work on runs, not lines: lines can join neighbouring cells ("— — —")
  const frags = [];
  for (const L of lines) for (const r of L.runs || [L]) {
    const t = (r.t || "").trim();
    if (!t) continue;
    frags.push({ t, x: r.x, x2: r.x2 != null ? r.x2 : r.x + r.w, y: r.y, y2: r.b + r.s * 0.22, b: r.b, s: r.s, k: r.k });
  }
  // a title: the top row when it is a single piece of text in its own style ("The Swordmage", "THE ALCHEMIST")
  let title = null;
  const rows0 = baselineRows(frags);
  if (rows0.length > 2) {
    const top = rows0[0];
    const styleCount = {};
    for (const f of frags) styleCount[f.k] = (styleCount[f.k] || 0) + 1;
    const common = Object.keys(styleCount).sort((a, b) => styleCount[b] - styleCount[a])[0];
    if (top.frags.length <= 2 && top.frags.every((f) => f.k !== common) && rows0[1].b - top.b > top.s * 0.9) {
      title = top.frags.map((f) => f.t).join(" ");
      top.frags.forEach((f) => { f._title = true; });
    }
  }
  const rows = baselineRows(frags.filter((f) => !f._title));
  if (!rows.length) return null;
  const minX = Math.min(...frags.map((l) => l.x)), maxX = Math.max(...frags.map((l) => l.x2));
  // column boundaries: x positions covered by few fragments are gaps between columns
  const span = Math.ceil(maxX - minX) + 2;
  const cov = new Array(span).fill(0);
  const bodyRows = rows.filter((r) => r.frags.length >= Math.max(2, median(rows.map((x) => x.frags.length)) * 0.6));
  for (const r of bodyRows) for (const f of r.frags) {
    // multi-word fragments in a row that has many fragments are split later; count each word roughly
    for (let x = Math.floor(f.x - minX); x < Math.ceil(f.x2 - minX); x++) cov[x]++;
  }
  const thr = Math.max(0, Math.floor(bodyRows.length * 0.12));
  const cols = [];
  let inCol = false, start = 0;
  for (let i = 0; i < span; i++) {
    const on = cov[i] > thr;
    if (on && !inCol) { inCol = true; start = i; }
    if (!on && inCol) {
      // gaps narrower than ~a space don't split a column
      let j = i; while (j < span && cov[j] <= thr) j++;
      if (j - i >= 4 || j >= span) { cols.push({ x: start + minX, x2: i + minX }); inCol = false; i = j - 1; }
    }
  }
  if (inCol) cols.push({ x: start + minX, x2: span + minX });
  if (cols.length < 2) return null;

  const cellRows = rows.map((R) => {
    const cells = cols.map(() => []);
    const style = {};
    for (const f of R.frags) {
      style[f.k] = (style[f.k] || 0) + f.t.length;
      const parts = splitFragment(f, cols);
      if (parts) { for (const p of parts) cells[p.col].push(p.t); continue; }
      // otherwise the column it overlaps most
      let best = 0, bo = -1;
      cols.forEach((c, i) => { const o = Math.min(c.x2, f.x2) - Math.max(c.x, f.x); if (o > bo) { bo = o; best = i; } });
      const covered = cols.filter((c) => c.x2 > f.x + 2 && c.x < f.x2 - 2);
      if (covered.length > 1) best = cols.indexOf(covered[0]); // a spanning label starts at its first column
      cells[best].push(f.md || f.t);
      if (covered.length > 1) cells[best].span = covered.length;
    }
    return { b: R.b, s: R.s, cells: cells.map((c) => c.join(" ")), spans: cells.map((c) => c.span || 1), k: Object.keys(style).sort((a, b) => style[b] - style[a])[0] };
  });

  // header rows: before the first row that starts with a value and looks like data
  const dataLike = (r) => { const ne = r.cells.filter(Boolean); return ne.length ? ne.filter((c) => /\d|^[—–-]$/.test(c)).length / ne.length : 0; };
  const bodyStyle = (() => { const c = {}; for (const r of cellRows) c[r.k] = (c[r.k] || 0) + 1; return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; })();
  let h = 0;
  while (h < cellRows.length - 1) {
    const r = cellRows[h];
    const styled = r.k !== bodyStyle && /\|b\||\|sc\|/.test(r.k + "|");
    const filled = r.cells.filter(Boolean);
    // an empty first cell marks a header row only for styled rows or short sub-header labels ("1st 2nd 3rd")
    const subHead = !r.cells[0] && filled.length >= 2 && filled.every((c) => c.length <= 14);
    if (styled || subHead || (!r.cells[0] && h === 0) || (r.cells[0] && dataLike(r) < 0.34 && dataLike(cellRows[h + 1] || r) >= 0.34)) h++;
    else break;
  }
  if (h >= cellRows.length - 1) h = Math.min(1, cellRows.length - 1);

  // merge wrapped lines into their row
  const body = cellRows.slice(h);
  const gaps = body.map((r, i) => (i ? r.b - body[i - 1].b : 0)).filter((d) => d > 0);
  const lead = median(gaps) || 12;
  const minGap = gaps.length ? Math.min(...gaps) : 0;
  const merged = cellRows.slice(0, h).map((r) => ({ cells: r.cells.slice(), spans: r.spans, b: r.b, s: r.s }));
  const addTo = (row, r) => r.cells.forEach((c, i) => { if (c) row.cells[i] = (row.cells[i] ? row.cells[i] + " " : "") + c; });
  // rows set apart by extra space: group lines by that spacing (handles labels centred in tall rows)
  const spaced = gaps.length >= 3 && gaps.filter((g) => g > minGap * 1.25).length >= 2 && gaps.filter((g) => g <= minGap * 1.25).length >= 2;
  let clusters = null;
  if (spaced) {
    clusters = [[body[0]]];
    for (let i = 1; i < body.length; i++) {
      if (body[i].b - body[i - 1].b > minGap * 1.25) clusters.push([body[i]]); else clusters[clusters.length - 1].push(body[i]);
    }
    // only when each cluster holds at most one row that starts a new first-column value
    if (clusters.some((c) => c.filter((r) => r.cells[0]).length > 1)) clusters = null;
  }
  if (clusters) {
    for (const c of clusters) {
      const row = { cells: c[0].cells.map(() => ""), spans: c[0].spans, b: c[c.length - 1].b };
      for (const r of c) addTo(row, r);
      merged.push(row);
    }
  } else {
    let last = null;
    for (const r of body) {
      if (last && !r.cells[0] && r.b - last.b <= Math.max(lead * 0.8, r.s * 1.35)) { addTo(last, r); last.b = r.b; }
      else { last = { cells: r.cells.slice(), spans: r.spans, b: r.b }; merged.push(last); }
    }
  }
  // stacked header lines in the same column ("Proficiency" over "Bonus") become one label
  const head = merged.slice(0, h);
  const headRows = [];
  for (const r of head) {
    const prev = headRows[headRows.length - 1];
    // header text set on two lines close together is one header row
    if (prev && r.b - prev.b <= Math.max(r.s, prev.s) * 1.3) {
      r.cells.forEach((c, i) => { if (c) { prev.cells[i] = prev.cells[i] ? prev.cells[i] + " " + c : c; prev.spans[i] = Math.max(prev.spans[i] || 1, r.spans[i] || 1); } });
      prev.b = r.b;
    } else headRows.push({ cells: r.cells.slice(), spans: r.spans.slice(), b: r.b, s: r.s });
  }
  return { title, cols: cols.map((c) => ({ x: r1(c.x), x2: r1(c.x2) })), head: headRows.map((r) => r.cells), headSpans: headRows.map((r) => r.spans), rows: merged.slice(h).map((r) => r.cells) };
}

/** Flattens a table's header rows into one label per column (spanning labels are repeated). */
export function headerLabels(T) {
  const n = T.cols.length;
  const labels = new Array(n).fill("");
  (T.head || []).forEach((row, ri) => {
    const spans = (T.headSpans && T.headSpans[ri]) || [];
    row.forEach((c, i) => {
      if (!c) return;
      const sp = spans[i] || 1;
      for (let j = i; j < Math.min(n, i + sp); j++) labels[j] = (labels[j] ? labels[j] + " " : "") + c;
    });
  });
  return labels.map((l) => l.trim());
}

/* ---------------- reading order ---------------- */

const ux = (u) => u.x, ux2 = (u) => u.x2, uy = (u) => u.y, uy2 = (u) => u.y2;

/** Vertical gutters: x ranges no narrow text line crosses, with text on both sides. */
function findGutters(lines, area) {
  const flow = lines.filter((l) => l.x2 - l.x < (area.x2 - area.x) * 0.55);
  if (flow.length < 6) return [];
  const minX = Math.floor(Math.min(...flow.map(ux))), maxX = Math.ceil(Math.max(...flow.map(ux2)));
  const cov = new Array(maxX - minX + 2).fill(0);
  for (const l of flow) for (let x = Math.floor(l.x - minX); x < Math.ceil(l.x2 - minX); x++) cov[x]++;
  // a gutter may be crossed by a heading or two (they become full-width elements), not by column text
  const thr = Math.max(1, Math.floor(flow.length * 0.04));
  const gut = [];
  let s = -1;
  for (let i = 0; i < cov.length; i++) {
    if (cov[i] <= thr && s < 0) s = i;
    if ((cov[i] > thr || i === cov.length - 1) && s >= 0) {
      const e = i;
      if (e - s >= 6) {
        const gx = s + minX, gx2 = e + minX;
        const left = flow.filter((l) => l.x2 <= gx + 1 && l.x2 > gx - 60).length;
        const right = flow.filter((l) => l.x >= gx2 - 1 && l.x < gx2 + 60).length;
        const crossing = flow.filter((l) => l.x < gx - 1 && l.x2 > gx2 + 1).length;
        if (left >= 3 && right >= 3 && gx > minX + 20 && gx2 < maxX - 20 && crossing <= Math.min(left, right) / 3) gut.push({ x: gx, x2: gx2 });
      }
      s = -1;
    }
  }
  return gut;
}

/** Recursive XY-cut over units; columns are cut before rows. */
function xycut(units, depth = 0) {
  if (units.length <= 1 || depth > 40) return units.slice();
  const sortedX = units.slice().sort((a, b) => a.x - b.x);
  // vertical cut: widest gap in the x projection
  let best = null, reach = sortedX[0].x2;
  for (let i = 1; i < sortedX.length; i++) {
    const g = sortedX[i].x - reach;
    if (g >= 6 && (!best || g > best.g)) best = { g, at: sortedX[i].x };
    reach = Math.max(reach, sortedX[i].x2);
  }
  if (best) {
    const L = units.filter((u) => u.x2 <= best.at), R = units.filter((u) => u.x2 > best.at);
    if (L.length && R.length) return xycut(L, depth + 1).concat(xycut(R, depth + 1));
  }
  // horizontal cuts at every gap in the y projection
  const sortedY = units.slice().sort((a, b) => a.y - b.y);
  const groups = [];
  let cur = [sortedY[0]], bottom = sortedY[0].y2;
  for (let i = 1; i < sortedY.length; i++) {
    const u = sortedY[i];
    if (u.y >= bottom - 0.5) { groups.push(cur); cur = [u]; } else cur.push(u);
    bottom = Math.max(bottom, u.y2);
  }
  groups.push(cur);
  if (groups.length > 1) return groups.flatMap((g) => xycut(g, depth + 1));
  return sortedY.sort((a, b) => a.b - b.b || a.x - b.x);
}

/** Orders units (lines, panels, tables) for one area: bands at gutter-crossing elements, then XY-cut. */
function orderUnits(units, lines, area) {
  // text in the top and bottom strips of the page (what is left of headers and footers) is ordered on its own,
  // so a stray footer in the gap between columns can't hide the column split
  if (area.page) {
    const H = area.y2 - area.y;
    const top = units.filter((u) => u.kind === "line" && u.y2 < area.y + H * 0.06);
    const bot = units.filter((u) => u.kind === "line" && u.y > area.y + H * 0.94);
    if (top.length || bot.length) {
      const mid = units.filter((u) => !top.includes(u) && !bot.includes(u));
      const r = orderUnits(mid, lines.filter((l) => !top.includes(l) && !bot.includes(l)), Object.assign({}, area, { page: false }));
      return { order: xycut(top).concat(r.order, xycut(bot)), gutters: r.gutters };
    }
  }
  const gut = findGutters(lines, area);
  const crosses = (u) => gut.some((g) => u.x < g.x - 2 && u.x2 > g.x2 + 2);
  const wide = units.filter(crosses).sort((a, b) => a.y - b.y);
  if (!wide.length) return { order: xycut(units), gutters: gut };
  const rest = units.filter((u) => !crosses(u));
  const out = [];
  let prevBottom = -1e9;
  for (const w of wide) {
    const above = rest.filter((u) => !u._done && (u.y + u.y2) / 2 < w.y + 1 && (u.y + u.y2) / 2 >= prevBottom - 1);
    above.forEach((u) => { u._done = true; });
    out.push(...xycut(above), w);
    prevBottom = w.y2;
  }
  const below = rest.filter((u) => !u._done);
  below.forEach((u) => { u._done = true; });
  out.push(...xycut(below));
  for (const u of units) delete u._done;
  return { order: out, gutters: gut };
}

/* ---------------- paragraphs ---------------- */

function lineMd(L, baseBold, baseItalic) {
  // inline emphasis relative to the block's own style: **bold**, *italic*
  let out = "", prev = null;
  const parts = [];
  for (const r of L.runs) {
    const parts2 = r.k.split("|");
    const b = parts2[1] === "b", i = parts2[2] === "i";
    const fmt = (b && !baseBold ? "b" : "") + (i && !baseItalic ? "i" : "");
    const gap = prev ? r.x - prev.x2 : 0;
    const sp = prev && gap > Math.min(r.s, prev.s) * 0.15 && !/\s$/.test(prev.t) && !/^\s/.test(r.t) ? " " : "";
    if (parts.length && parts[parts.length - 1].fmt === fmt) parts[parts.length - 1].t += sp + r.t;
    else { if (parts.length && sp) parts[parts.length - 1].t += sp; parts.push({ fmt, t: r.t }); }
    prev = r;
  }
  for (const p of parts) {
    const m = p.t.match(/^(\s*)(.*?)(\s*)$/);
    if (!m[2]) { out += p.t; continue; }
    const w = p.fmt === "b" ? "**" : p.fmt === "i" ? "*" : p.fmt === "bi" ? "***" : "";
    out += m[1] + w + m[2] + w + m[3];
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Joins a line onto paragraph text, repairing hyphenation at the line break. */
export function joinLine(text, next, vocab) {
  if (!text) return next;
  const m = text.match(/([A-Za-z]+)[-\u00AD](\**)$/);
  const n = next.match(/^(\**)([a-z][A-Za-z]*)/);
  if (m && n) {
    const left = m[1], right = n[2];
    let keep = false;
    if (vocab) {
      const kj = knownWord(vocab, left + right), kl = knownWord(vocab, left), kr = knownWord(vocab, right);
      keep = !kj && kl && kr && left.length > 2 && right.length > 2; // a real compound such as half-elf
    }
    if (keep) return text + next;
    const pre = text.slice(0, text.length - m[0].length) + left;
    if (m[2] && m[2] === n[1]) return pre + next.slice(n[1].length); // "**addi-**" + "**tion" -> "**addition"
    return pre + m[2] + next;
  }
  return text + " " + next;
}

/** A line's own style, leaving out a run-in label or bullet at its start. */
function bodyK(L) {
  if (L._bk) return L._bk;
  const lab = runInLabel(L);
  const by = {};
  for (const r of L.runs) {
    if (BULLET_ONLY.test(r.t) || (lab && r.t.trim() === lab)) continue;
    by[r.k] = (by[r.k] || 0) + r.t.replace(/\s/g, "").length;
  }
  return (L._bk = Object.keys(by).sort((a, b) => by[b] - by[a])[0] || L.k);
}

const isBullet = (L) => BULLET.test(L.t) || BULLET_ONLY.test(L.runs[0].t) || !!L.mark;

/** A line that starts with a label in its own emphasis, such as "Hit Dice:" or "Rage Damage." */
function runInLabel(L) {
  if (L.runs.length < 2) return null;
  let i = 0;
  if (BULLET_ONLY.test(L.runs[0].t)) i = 1;
  const r = L.runs[i];
  if (!r || i + 1 >= L.runs.length) return null;
  const p = r.k.split("|");
  const emph = p[1] === "b" || p[3] === "sc" || (p[2] === "i" && L.runs[i + 1].k.split("|")[2] !== "i");
  const t = r.t.trim();
  if (!emph || r.k === L.runs[i + 1].k || t.length > 60 || !/[.:!?]$/.test(t)) return null;
  return t;
}

/** Splits an ordered list of lines (one column) into paragraph and list blocks. */
function paragraphs(lines, ctx) {
  const blocks = [];
  if (!lines.length) return blocks;
  const leads = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].b - lines[i - 1].b;
    if (d > 0 && lines[i].k === lines[i - 1].k) leads.push(d);
  }
  const lead = median(leads) || lines[0].s * 1.2;
  const colX = Math.min(...lines.map((l) => l.x)), colX2 = Math.max(...lines.map((l) => l.x2));
  let cur = null;
  const close = () => { if (cur) blocks.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], P = lines[i - 1];
    let brk = !cur;
    if (cur && P) {
      const gap = L.b - P.b;
      const Lk = bodyK(L), Pk = bodyK(P);
      const sizeChange = Math.abs(L.s - P.s) > Math.max(L.s, P.s) * 0.12 && Lk.split("|")[4] !== Pk.split("|")[4];
      const famChange = Lk.split("|")[0] !== Pk.split("|")[0] && (L.t.length < 60 || P.t.length < 60);
      const styleBreak = Lk !== Pk && (sizeChange || (famChange && (L.runs.length === 1 || P.runs.length === 1)));
      const bullet = isBullet(L);
      const label = runInLabel(L);
      const big = gap > lead * 1.45 || gap < 0;
      const contX = cur.contX != null ? cur.contX : null;
      let indent = false;
      if (contX != null) indent = L.x > contX + L.s * 0.6 || (cur.list && L.x < contX - L.s * 0.6); // a list item ends where the text moves back out
      else if (cur.lines.length === 1) {
        const hang = (cur.hang != null && Math.abs(L.x - cur.hang) < L.s * 0.6) || (cur.hangOK && L.x > cur.lines[0].x);
        indent = L.x > cur.lines[0].x + L.s * 0.6 && !hang;
      }
      const shortEnd = P.x2 < colX2 - L.s * 2.5 && /[.!?:"')\]]\**$/.test(P.t) && /^[\W_]*[A-Z0-9]/.test(L.t);
      // a short "Field: value" line ("Duration: 1 minute") is a block of its own
      const fieldEnd = cur.lines.length === 1 && cur.field && P.x2 < colX2 - L.s * 3 && !(L.x > cur.lines[0].x + L.s * 0.5);
      // a short line in italic (or out of italic) next to body text: "Wondrous item, rare" above its description
      const pi = Pk.split("|")[2] === "i", li = Lk.split("|")[2] === "i";
      const italicEdge = pi !== li && (pi ? P : L).runs.every((r) => r.k.split("|")[2] === "i") && P.x2 < colX2 - L.s * 3;
      brk = styleBreak || bullet || label || big || indent || fieldEnd || italicEdge || (shortEnd && !cur.list);
    }
    if (brk) {
      close();
      const bullet = isBullet(L);
      // hanging indent: the x where the text after a bullet or run-in label starts
      let hang = null;
      if (bullet && L.runs.length > 1) hang = L.runs[1].x;
      const lab0 = runInLabel(L);
      cur = { type: bullet ? "item" : "para", lines: [L], hang, list: bullet, hangOK: bullet || !!lab0, field: !!lab0 && /:$/.test(lab0) };
      continue;
    }
    if (cur.contX == null) cur.contX = L.x;
    cur.lines.push(L);
  }
  close();
  for (const B of blocks) finishBlock(B, ctx);
  return blocks;
}

function finishBlock(B, ctx) {
  const L = B.lines;
  B.x = Math.min(...L.map((l) => l.x)); B.x2 = Math.max(...L.map((l) => l.x2));
  B.y = Math.min(...L.map((l) => l.y)); B.y2 = Math.max(...L.map((l) => l.y2));
  const lab = runInLabel(L[0]);
  const by = {};
  let skip = lab ? L[0].runs.find((r) => r.t.trim() === lab) : null;
  for (const l of L) for (const r of l.runs) { if (r === skip || BULLET_ONLY.test(r.t)) continue; by[r.k] = (by[r.k] || 0) + r.t.replace(/\s/g, "").length; }
  B.k = Object.keys(by).sort((a, b) => by[b] - by[a])[0] || L[0].k;
  const parts = B.k.split("|");
  const bb = parts[1] === "b", bi = parts[2] === "i";
  let t = "", md = "";
  for (const l of L) {
    t = joinLine(t, l.t, ctx.vocab);
    md = joinLine(md, lineMd(l, bb, bi), ctx.vocab);
  }
  B.t = t; B.md = md;
  B.s = median(L.map((l) => l.s));
  // a first run in its own emphasis ending in a period or colon is a run-in label ("Rage Damage.", "Range:")
  const r0 = L[0].runs[0];
  if (lab && skip) B.lead = { t: lab, k: skip.k };
  if (r0 && BULLET_ONLY.test(r0.t)) B.bullet = r0.t.trim();
  // keep the bullet as a field, not as text
  const bm = B.t.match(/^\s*([•●▪◦‣■□➢➤►])\s+/);
  if (bm) { B.bullet = bm[1]; B.t = B.t.slice(bm[0].length); B.md = B.md.replace(/^\s*[•●▪◦‣■□➢➤►]\s+/, ""); }
  B.n = L.length;
  delete B.contX; delete B.hang; delete B.hangOK; delete B.field;
  for (const l of L) delete l._bk;
}

/* ---------------- the page ---------------- */

function boxUnit(b, kind) {
  return { kind, x: b.x, x2: b.x + b.w, y: b.y, y2: b.y + b.h, b: b.y, fill: b.fill, stroke: b.stroke };
}

/** Lays out one area (the page, or the inside of a panel). Returns ordered blocks. */
function layoutArea(lines, area, page, ctx, depth) {
  const blocks = [];
  // 1. panels (only on the page itself, and one level inside)
  const panels0 = depth < 2 ? findPanels(Object.assign({}, page, { w: area.x2 - area.x, h: area.y2 - area.y, boxes: (page.boxes || []).filter((b) => b.x >= area.x - 2 && b.y >= area.y - 2 && b.x + b.w <= area.x2 + 2 && b.y + b.h <= area.y2 + 2 && !(Math.abs(b.x - area.x) < 2 && Math.abs(b.w - (area.x2 - area.x)) < 2 && Math.abs(b.y - area.y) < 2)) }), lines, ctx.body) : [];
  // inside a panel, a band across its full width (a title or header strip) is decoration, not a nested panel
  const panels = depth >= 1 ? panels0.filter((P) => P.w < (area.x2 - area.x) * 0.9) : panels0;
  const used = new Set();
  const units = [];
  // 2. striped tables
  const tables = [];
  const stripes = shadedRows(Object.assign({}, page, { boxes: (page.boxes || []).filter((b) => b.x >= area.x - 2 && b.x + b.w <= area.x2 + 2 && b.y >= area.y - 2 && b.y + b.h <= area.y2 + 2) }), ctx.body);
  const freeNow = () => lines.filter((L) => !used.has(L));
  for (const S of stripes) {
    const top = S.y, bottom = S.y + S.h;
    const cand = freeNow().filter((L) => L.x >= S.x - 3 && L.x2 <= S.x + S.w + 3);
    const inner = cand.filter((L) => L.y >= top - 1 && L.y2 <= bottom + 1);
    if (inner.length < 3) continue;
    let y0 = top;
    const above = cand.filter((L) => L.y2 <= top + 1).sort((a, b) => b.y2 - a.y2);
    const medS = median(inner.map((l) => l.s));
    for (const L of above) {
      if (y0 - L.y2 >= ctx.body * 2.2) break;
      if (L.t.length > 45 && L.x2 - L.x > S.w * 0.5 && /[a-z]{3}/.test(L.t)) break; // a sentence introducing the table
      if (L.s > medS * 1.35) break; // a section heading above the table
      inner.push(L); y0 = L.y;
    }
    let y1 = bottom;
    const below = cand.filter((L) => L.y >= bottom - 1).sort((a, b) => a.y - b.y);
    // an unshaded last row: only lines that sit in a row of several cells
    for (const L of below) {
      if (L.y - y1 >= ctx.body * 0.9) break;
      const rowMates = cand.filter((M) => M !== L && Math.abs(M.b - L.b) < 2).length;
      if (!rowMates) break;
      inner.push(L); y1 = Math.max(y1, L.y2);
    }
    inner.forEach((L) => used.add(L));
    tables.push({ kind: "table", x: S.x, x2: S.x + S.w, y: y0, y2: y1, b: y0, lines: inner });
  }
  // 3. tables from aligned text, looked for one column at a time (so a line of the next column is never a "cell")
  const gutNow = findGutters(freeNow(), area);
  const ranges = [];
  let gx = area.x;
  for (const g of gutNow) { ranges.push([gx, g.x + 1]); gx = g.x2 - 1; }
  ranges.push([gx, area.x2]);
  const aligned = [];
  // inside a boxed area the box is the unit (its table may be as wide as the box)
  const inPanel = (L) => panels.some((P) => inside(L, P));
  for (const P of panels) aligned.push(...alignedTables(freeNow().filter((L) => inside(L, P)), { w: P.w }));
  for (const [a, b] of ranges) {
    const inCol = freeNow().filter((L) => !inPanel(L) && (L.x + L.x2) / 2 >= a && (L.x + L.x2) / 2 <= b);
    aligned.push(...alignedTables(inCol, { w: Math.max(80, b - a) }));
  }
  // and across the whole width, for tables wider than a column
  if (ranges.length > 1) {
    const covered = new Set(aligned.flatMap((T) => T.rows.flatMap((R) => R.frags)));
    for (const T of alignedTables(freeNow().filter((L) => !covered.has(L) && !inPanel(L)), { w: area.x2 - area.x }, { noProse: true })) {
      if (gutNow.some((g) => T.x < g.x - 2 && T.x2 > g.x2 + 2)) aligned.push(T);
    }
  }
  for (const T of aligned) {
    const inner = T.rows.flatMap((R) => R.frags).filter((L) => !used.has(L));
    if (inner.length < 6) continue;
    let y0 = T.y;
    const above = freeNow().filter((L) => !inner.includes(L) && L.y2 <= T.y + 1 && L.x >= T.x - 3 && L.x2 <= T.x2 + 3).sort((a, b) => b.y2 - a.y2);
    const medS2 = median(inner.map((l) => l.s));
    for (const L of above) {
      if (y0 - L.y2 >= L.s * 1.6) break;
      if (L.t.length > 45 && /[a-z]{3}/.test(L.t)) break;
      if (L.s > medS2 * 1.35) break;
      inner.push(L); y0 = L.y;
    }
    inner.forEach((L) => used.add(L));
    tables.push({ kind: "table", x: Math.min(...inner.map((l) => l.x)), x2: Math.max(...inner.map((l) => l.x2)), y: y0, y2: T.y2, b: y0, lines: inner });
  }
  // 4. panels: a panel that is mostly table is the table's frame; otherwise it is a sidebar laid out on its own
  for (const P of panels) {
    const pl = lines.filter((L) => inside(L, P));
    if (!pl.length) continue;
    const tabbed = tables.filter((T) => T.lines.some((L) => inside(L, P)));
    // measured in characters: a two-row stats table has many short cells but little text
    const chars = (ls) => ls.reduce((a, L) => a + L.t.length, 0);
    const inTables = chars(pl.filter((L) => tabbed.some((T) => T.lines.includes(L)))) * (pl.length / Math.max(1, chars(pl)));
    // several pieces of one table (a row the aligner did not recognise splits it): same left edge, stacked
    const sameCols = tabbed.length > 1 && tabbed.every((T) => Math.abs(T.x - tabbed[0].x) < 8);
    if ((tabbed.length === 1 || sameCols) && inTables >= pl.length * 0.5) {
      const T = tabbed[0];
      for (const O of tabbed.slice(1)) {
        for (const L of O.lines) if (!T.lines.includes(L)) T.lines.push(L);
        T.x = Math.min(T.x, O.x); T.x2 = Math.max(T.x2, O.x2); T.y = Math.min(T.y, O.y); T.y2 = Math.max(T.y2, O.y2);
        O.dead = true;
      }
      for (const L of pl) if (!T.lines.includes(L)) { T.lines.push(L); used.add(L); }
      T.x = Math.min(T.x, P.x); T.x2 = Math.max(T.x2, P.x + P.w); T.y = Math.min(T.y, P.y); T.y2 = Math.max(T.y2, P.y + P.h); T.b = T.y;
      T.frame = { fill: P.fill, stroke: P.stroke };
      continue;
    }
    // tables found inside a sidebar are worked out again inside it
    for (const T of tabbed) { if (T.lines.every((L) => inside(L, P))) { T.dead = true; T.lines.forEach((L) => used.delete(L)); } }
    const inner = lines.filter((L) => !used.has(L) && inside(L, P));
    inner.forEach((L) => used.add(L));
    if (!inner.length) continue;
    const u = boxUnit(P, "panel");
    u.lines = inner;
    units.push(u);
  }
  // rows that sit just above or below a table and line up with its columns belong to it
  // (headers set outside a shaded box, an unshaded last row)
  for (const T of tables) {
    if (T.dead) continue;
    const xs = T.x - 12, xe = T.x2 + 12;
    for (let guard = 0; guard < 12; guard++) {
      // a label straddling the table's edge (a header cell centred across two header rows)
      let grew = false;
      for (const L of lines) {
        if (used.has(L) || L.x < xs || L.x2 > xe) continue;
        if (L.y < T.y2 && L.y2 > T.y && L.t.length <= 50) { T.lines.push(L); used.add(L); T.y = Math.min(T.y, L.y); T.y2 = Math.max(T.y2, L.y2); T.b = T.y; grew = true; }
      }
      if (grew) continue;
      const free = lines.filter((L) => !used.has(L) && L.x >= xs && L.x2 <= xe);
      const sTab = median(T.lines.map((l) => l.s)) || ctx.body;
      const near = (above) => {
        const cand = free.filter((L) => above ? (L.y2 <= T.y + 2 && T.y - L.y2 < sTab * 1.6) : (L.y >= T.y2 - 2 && L.y - T.y2 < sTab * 1.6));
        if (!cand.length) return null;
        const b = above ? Math.max(...cand.map((l) => l.b)) : Math.min(...cand.map((l) => l.b));
        const row = cand.filter((L) => Math.abs(L.b - b) < sTab * 0.4);
        // a row of cells: pieces that are not running text and not much larger than the table text;
        // a single piece is allowed when it is a short label close to the table ("APL", "CR by Number of Players")
        const sentence = (L) => /[a-z]{2,} [a-z]{2,} [a-z]{2,}/.test(L.t) || /[a-z]{2,} [a-z]{3,}[.!?]$/.test(L.t);
        if (row.some((L) => L.t.length > 45 || L.s > sTab * 1.35 || sentence(L))) return null;
        if (row.length < 2 && (!above || row[0].t.length > 50 || Math.abs((above ? T.y - row[0].y2 : row[0].y - T.y2)) > sTab * 1.2)) return null;
        return row;
      };
      const up = near(true), down = up ? null : near(false);
      const row = up || down;
      if (!row) break;
      for (const L of row) { T.lines.push(L); used.add(L); }
      T.y = Math.min(T.y, ...row.map((l) => l.y)); T.y2 = Math.max(T.y2, ...row.map((l) => l.y2)); T.b = T.y;
      T.x = Math.min(T.x, ...row.map((l) => l.x)); T.x2 = Math.max(T.x2, ...row.map((l) => l.x2));
    }
  }
  for (const T of tables) if (!T.dead) units.push(T);
  // 5. everything else is a line in the flow
  for (const L of lines) if (!used.has(L)) units.push(Object.assign(L, { kind: "line" }));

  const { order, gutters } = orderUnits(units, lines.filter((L) => !used.has(L)), area);

  // 5. paragraphs: consecutive lines in the same column
  let run = [];
  const flush = () => { if (run.length) blocks.push(...paragraphs(run, ctx)); run = []; };
  let lastCol = null;
  for (const u of order) {
    if (u.kind === "line") {
      const col = colOf(u, gutters);
      if (lastCol != null && col !== lastCol) flush();
      lastCol = col;
      run.push(u);
      continue;
    }
    flush(); lastCol = null;
    if (u.kind === "table") {
      const T = tableStructure(u.lines);
      if (!T) {
        // not a table after all: lay its lines out as text
        const ls = u.lines.slice().sort((a, b) => a.b - b.b || a.x - b.x);
        blocks.push(...paragraphs(ls, ctx));
        continue;
      }
      blocks.push({ type: "table", x: u.x, x2: u.x2, y: u.y, y2: u.y2, table: T, t: u.lines.map((l) => l.t).join(" "), k: u.lines[0] && u.lines[0].k, lines: u.lines, n: u.lines.length });
    } else if (u.kind === "panel") {
      const inner = layoutArea(u.lines, { x: u.x, x2: u.x2, y: u.y, y2: u.y2 }, page, ctx, depth + 1);
      blocks.push({ type: "panel", x: u.x, x2: u.x2, y: u.y, y2: u.y2, fill: u.fill, stroke: u.stroke, blocks: inner, n: u.lines.length });
    }
  }
  flush();
  return blocks;
}

function colOf(u, gutters) {
  let c = 0;
  for (const g of gutters) if ((u.x + u.x2) / 2 > g.x2) c++;
  return c;
}

/** Lays out one page. ctx: { fonts, furn, vocab, body } */
export function layoutPage(page, ctx) {
  const { runs, furniture } = prepRuns(page, ctx.furn);
  const lines = buildLines(runs, ctx.fonts);
  // bullets drawn as small dots or squares rather than characters
  const marks = (page.boxes || []).filter((b) => b.w >= 1.5 && b.w <= 7 && b.h >= 1.5 && b.h <= 7 && Math.abs(b.w - b.h) < 1.6 && b.fill);
  for (const m of marks) {
    const cy = m.y + m.h / 2;
    const L = lines.find((l) => cy > l.y && cy < l.y2 && m.x + m.w < l.x && l.x - (m.x + m.w) < 16);
    if (L) L.mark = true;
  }
  const area = { x: 0, x2: page.w, y: 0, y2: page.h, page: true };
  const blocks = layoutArea(lines, area, page, Object.assign({ body: (ctx.furn && ctx.furn.body) || 10 }, ctx), 0);
  // number blocks in reading order (panels' children too) and drop heavy line data
  let i = 0;
  const strip = (B) => {
    B.i = i++;
    if (B.lines) {
      B.box = B.lines.map((l) => [r1(l.x), r1(l.y), r1(l.x2), r1(l.y2)]);
      B.styles = [...new Set(B.lines.flatMap((l) => l.runs.map((r) => r.k)))];
      B.chars = {};
      for (const l of B.lines) for (const r of l.runs) B.chars[r.k] = (B.chars[r.k] || 0) + r.t.replace(/\s/g, "").length;
      B.first = { x: r1(B.lines[0].x), k: B.lines[0].k, t: B.lines[0].t.slice(0, 80), runs: B.lines[0].runs.length };
      B.lastLine = { x2: r1(B.lines[B.lines.length - 1].x2), t: B.lines[B.lines.length - 1].t.slice(-40) };
      delete B.lines;
    }
    for (const k of ["x", "x2", "y", "y2", "s"]) if (B[k] != null) B[k] = r1(B[k]);
    if (B.blocks) B.blocks.forEach(strip);
  };
  blocks.forEach(strip);
  return {
    page: page.page, label: page.label, w: page.w, h: page.h, blocks,
    furniture: furniture.map((r) => ({ t: r.t, x: r1(r.x), y: r1(r.y), r: r.r || 0 })),
  };
}

/** Walks blocks including panel contents. */
export function eachBlock(blocks, fn, parent = null) {
  for (const B of blocks) { fn(B, parent); if (B.blocks) eachBlock(B.blocks, fn, B); }
}
