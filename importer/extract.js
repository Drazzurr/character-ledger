/* Stage 1: turn one PDF page into glyph runs (text + position + font + colour), boxes and images,
   and score how trustworthy its text layer is. No layout decisions are made here. */

import { knownWord } from "./vocab.js";

export const STAGE1_VERSION = 1;

const LIGS = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

/** Unicode clean-up shared by text items and glyphs. Dashes are kept as printed. */
export function cleanText(s) {
  return String(s || "")
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGS[c])
    .replace(/[   ]/g, " ")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/−/g, "-");
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r2 = (v) => Math.round(v * 100) / 100;

function hex(args) {
  const a = args && args[0];
  if (typeof a === "string") return a.toLowerCase();
  if (Array.isArray(args) && args.length >= 3) {
    return "#" + args.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }
  return null;
}

function boxOf(m, x0, y0, x1, y1) {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: r2(x), y: r2(y), w: r2(Math.max(...xs) - x), h: r2(Math.max(...ys) - y) };
}

const WEIGHTS = [
  [/^(black|heavy|ultra|ultrabold|extrabold|xbold|blk|hv|ub|eb)$/, 800],
  [/^(semibold|demibold|semi|demi|sb|sbd|dm)$/, 600],
  [/^(bold|bd|bol|b|bdit|boldit|bolditalic|boldoblique)$/, 700],
  [/^(medium|medi|med|md)$/, 500],
  [/^(light|lt|thin|hairline|extralight|xlight|book)$/, 300],
];

/** Weight, italic and small caps from a PostScript-style name such as MinionPro-BoldIt or NimbusRomNo9L-ReguItal. */
export function parseFontName(name) {
  const sep = name.search(/[-,]/);
  const family = (sep > 0 ? name.slice(0, sep) : name).replace(/(MT|PS|Std|Pro|LT)$/, "").trim() || name;
  const tail = sep > 0 ? name.slice(sep + 1) : name;
  const raw = tail.split(/(?<=[a-z0-9])(?=[A-Z])|[-_, +]/).map((t) => t.toLowerCase()).filter(Boolean);
  const toks = [];
  for (let i = 0; i < raw.length; i++) {
    // "Semi Bold", "Extra Light" and similar are one weight
    if (/^(semi|demi|extra|ultra|x)$/.test(raw[i]) && raw[i + 1]) { toks.push(raw[i] + raw[i + 1]); i++; } else toks.push(raw[i]);
  }
  let weight = 400;
  for (const t of toks) for (const [rx, w] of WEIGHTS) if (rx.test(t)) weight = Math.max(weight === 400 ? 0 : weight, w);
  if (weight === 0) weight = 400;
  if (/^CMB|^CMBX|^CMSSBX/.test(name)) weight = 700; // TeX bold fonts
  const italic = toks.some((t) => /^(italic|ital|it|oblique|obl|slanted|kursiv|bdit|boldit|bolditalic|boldoblique|ita)$/.test(t)) || /^CM(TI|SL|MI|BXTI|SSI)/.test(name);
  const smallCaps = toks.some((t) => /^(sc|smcp|smallcaps|caps|capitals)$/.test(t)) || (toks.includes("small") && toks.includes("caps"));
  return { family, weight, italic, smallCaps };
}

/** Font record from pdf.js's font object. Subset prefixes (ABCDEF+) are removed. */
export function fontRecord(page, id, style) {
  let f = null;
  try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch (e) { f = null; }
  const raw = String((f && f.name) || (style && style.fontFamily) || id);
  const name = raw.replace(/^[A-Z]{6}\+/, "");
  const pn = parseFontName(name);
  const sys = f && f.systemFontInfo && f.systemFontInfo.style;
  let weight = pn.weight;
  if (f && f.black) weight = Math.max(weight, 800);
  else if (f && f.bold) weight = Math.max(weight, 700);
  if (sys && /bold|[6-9]00/.test(String(sys.weight))) weight = Math.max(weight, 700);
  return {
    id, name, family: pn.family, weight, bold: weight >= 600,
    italic: pn.italic || !!(f && f.italic) || !!(sys && /italic|oblique/.test(String(sys.style))),
    smallCaps: pn.smallCaps,
    type3: !!(f && f.isType3Font),
    serif: f ? !!f.isSerifFont : null,
    mono: f ? !!f.isMonospace : null,
  };
}

/** Walks the operator list for colours, render modes, boxes and images, and a per-glyph colour stream. */
function walkOps(ops, OPS, vt) {
  const N = {};
  for (const k in OPS) N[OPS[k]] = k;
  const PAINT = new Set(["stroke", "closeStroke", "fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"]);
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000", stroke = "#000000", mode = 0, font = null;
  const stack = [], chars = [], boxes = [], images = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = N[ops.fnArray[i]], a = ops.argsArray[i];
    switch (fn) {
      case "save": stack.push([ctm, fill, stroke, mode]); break;
      case "restore": if (stack.length) [ctm, fill, stroke, mode] = stack.pop(); break;
      case "transform": ctm = mul(ctm, a); break;
      case "paintFormXObjectBegin": {
        stack.push([ctm, fill, stroke, mode]);
        const mtx = a && a[0];
        if (mtx && mtx.length === 6) ctm = mul(ctm, Array.from(mtx));
        break;
      }
      case "paintFormXObjectEnd": if (stack.length) [ctm, fill, stroke, mode] = stack.pop(); break;
      case "setFillRGBColor": fill = hex(a) || fill; break;
      case "setStrokeRGBColor": stroke = hex(a) || stroke; break;
      case "setTextRenderingMode": mode = a[0] | 0; break;
      case "setFont": font = a[0]; break;
      case "showText": case "showSpacedText": {
        const g = a[0] || [];
        for (const gl of g) {
          if (!gl || typeof gl !== "object" || !gl.unicode) continue;
          for (const ch of cleanText(gl.unicode)) if (!/\s/.test(ch)) chars.push({ c: ch, fill, mode, font });
        }
        break;
      }
      case "constructPath": {
        const paint = N[a[0]], mm = a[2];
        if (!PAINT.has(paint) || !mm || mm.length < 4) break;
        const b = boxOf(mul(vt, ctm), mm[0], mm[1], mm[2], mm[3]);
        if (b.w < 0.5 && b.h < 0.5) break;
        const filled = /fill|Fill/.test(paint), stroked = /troke/.test(paint);
        boxes.push(Object.assign(b, { fill: filled ? fill : null, stroke: stroked ? stroke : null }));
        break;
      }
      case "paintImageXObject": case "paintInlineImageXObject": case "paintImageMaskXObject":
      case "paintImageXObjectRepeat": case "paintImageMaskXObjectRepeat": {
        images.push(boxOf(mul(vt, ctm), 0, 0, 1, 1));
        break;
      }
      default: break;
    }
  }
  return { chars, boxes, images };
}

/** Quality score for a page's text layer; decides whether OCR is needed. */
export function pageQuality(text, images, area, vocab) {
  const all = text.replace(/\s/g, "");
  const n = all.length;
  let bad = 0, pua = 0;
  for (const ch of all) {
    const c = ch.codePointAt(0);
    if (c >= 0xe000 && c <= 0xf8ff) pua++;
    else if (c === 0xfffd || c < 32 || (c >= 0x7f && c < 0xa0)) bad++;
  }
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  let hits = 0;
  if (vocab) for (const w of words) if (knownWord(vocab, w)) hits++;
  // share of letters among the most common English letters: about 0.8 in real text, much lower in scrambled text
  const letters = (text.match(/[A-Za-z]/g) || []);
  const common = letters.length ? letters.filter((ch) => "etaoinshrdlu".indexOf(ch.toLowerCase()) >= 0).length / letters.length : 0;
  const cover = Math.min(1, images.reduce((s, b) => s + b.w * b.h, 0) / area);
  const printable = n ? (n - bad - pua) / n : 0;
  const dict = words.length ? hits / words.length : 0;
  let status = "ok", why = "";
  if (n < 40) {
    status = cover > 0.5 ? "scan" : "empty";
    why = cover > 0.5 ? "Page is an image with no text layer" : "Little or no text";
  } else if (printable < 0.9 || pua / n > 0.05) {
    status = "garbled"; why = "Text layer has unreadable characters";
  } else if (vocab && words.length >= 25 && (dict < 0.25 || (dict < 0.5 && common < 0.6))) {
    status = "garbled"; why = "Most words are not recognised";
  }
  return {
    status, why, needsOcr: status === "scan" || status === "garbled",
    chars: n, words: words.length, printable: r2(printable), dict: r2(dict), common: r2(common), pua, imageCover: r2(cover),
  };
}

/**
 * Extracts one page. Returns { page, label, w, h, rot, runs, boxes, images, quality, fonts, struct }.
 * fonts: font records first seen on this page (the caller keeps a book-wide table).
 */
export async function extractPage(pdfjs, doc, pageNo, opts) {
  const { vocab, knownFonts = {}, label = null } = opts || {};
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const vt = vp.transform;
  const ops = await page.getOperatorList();
  const tc = await page.getTextContent({ includeMarkedContent: true });
  const walked = walkOps(ops, pdfjs.OPS, vt);

  const fonts = {};
  const fontFor = (id) => {
    if (!id) return null;
    if (!knownFonts[id] && !fonts[id]) fonts[id] = fontRecord(page, id, tc.styles[id]);
    return id;
  };

  const runs = [];
  let p = 0, mcid = null;
  const mcStack = [];
  const oc = walked.chars;
  for (const it of tc.items) {
    if (it.type === "beginMarkedContentProps" || it.type === "beginMarkedContent") {
      mcStack.push(mcid); if (it.id != null) mcid = it.id; continue;
    }
    if (it.type === "endMarkedContent") { mcid = mcStack.length ? mcStack.pop() : null; continue; }
    if (typeof it.str !== "string") continue;
    let str = it.str;
    const hy = /­\s*$/.test(str);
    str = cleanText(str.replace(/­/g, ""));
    if (!str.trim()) continue;

    // match this item's characters against the operator stream to recover colour and render mode
    const fills = {}, modes = {};
    let matched = 0;
    for (const ch of str) {
      if (/\s/.test(ch)) continue;
      const lim = Math.min(oc.length, p + 400);
      for (let j = p; j < lim; j++) {
        if (oc[j].c === ch) {
          fills[oc[j].fill] = (fills[oc[j].fill] || 0) + 1;
          modes[oc[j].mode] = (modes[oc[j].mode] || 0) + 1;
          p = j + 1; matched++;
          break;
        }
      }
    }
    const top = (o) => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
    const tx = pdfjs.Util.transform(vt, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    const rot = Math.round(Math.atan2(tx[1], tx[0]) * 180 / Math.PI);
    const st = tc.styles[it.fontName] || {};
    const asc = st.ascent && st.ascent > 0.3 ? st.ascent : 0.8;
    const mode = matched ? +top(modes) : 0;
    runs.push({
      t: str,
      x: r2(tx[4]), b: r2(tx[5]), y: r2(tx[5] - size * asc),
      w: r2(it.width * Math.hypot(vt[0], vt[1])), s: r2(size), r: rot,
      f: fontFor(it.fontName),
      c: matched ? top(fills) : "#000000",
      fb: mode === 2 ? 1 : 0,          // text drawn with fill + stroke: printed as bold
      inv: mode === 3 || mode === 7 ? 1 : 0, // invisible text (often an OCR layer over a scan)
      eol: it.hasEOL ? 1 : 0,
      hy: hy ? 1 : 0,
      mc: mcid,
      m: str.replace(/\s/g, "").length ? r2(matched / str.replace(/\s/g, "").length) : 1,
    });
  }

  const area = vp.width * vp.height;
  const text = runs.map((r) => r.t).join(" ");
  const quality = pageQuality(text, walked.images, area, vocab);
  if (runs.length && runs.filter((r) => r.inv).length / runs.length > 0.8) quality.ocrLayer = true;

  let struct = null;
  try { struct = await page.getStructTree(); } catch (e) { struct = null; }

  const boxes = walked.boxes.filter((b) => !(b.w > vp.width * 0.98 && b.h > vp.height * 0.98 && b.fill === "#ffffff")).slice(0, 3000);
  page.cleanup();
  return {
    page: pageNo, label, w: r2(vp.width), h: r2(vp.height), rot: page.rotate || 0,
    runs, boxes, images: walked.images.slice(0, 500), quality, fonts, struct,
  };
}

/** Book-level information: metadata, outline with page numbers, page labels, tagging. */
export async function bookInfo(doc) {
  const out = { numPages: doc.numPages, fingerprint: (doc.fingerprints && doc.fingerprints[0]) || "", meta: {}, outline: [], labels: null, tagged: false };
  try {
    const m = await doc.getMetadata();
    const i = (m && m.info) || {};
    out.meta = { title: i.Title || "", author: i.Author || "", subject: i.Subject || "", creator: i.Creator || "", producer: i.Producer || "",
      created: i.CreationDate || "", modified: i.ModDate || "", pdfVersion: i.PDFFormatVersion || "" };
    if (!out.meta.title && m.metadata) { try { out.meta.title = m.metadata.get("dc:title") || ""; } catch (e) { /* none */ } }
  } catch (e) { /* no metadata */ }
  try { out.labels = await doc.getPageLabels(); } catch (e) { out.labels = null; }
  try { const mi = await doc.getMarkInfo(); out.tagged = !!(mi && mi.Marked); } catch (e) { out.tagged = false; }
  try {
    const ol = await doc.getOutline();
    const flat = [];
    const destPage = async (dest) => {
      try {
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (!Array.isArray(dest)) return null;
        const ref = dest[0];
        if (typeof ref === "number") return ref + 1;
        return (await doc.getPageIndex(ref)) + 1;
      } catch (e) { return null; }
    };
    const walk = async (items, level) => {
      for (const it of items || []) {
        if (flat.length > 5000) return;
        flat.push({ title: cleanText(it.title || "").trim(), level, page: await destPage(it.dest), bold: !!it.bold, italic: !!it.italic });
        await walk(it.items, level + 1);
      }
    };
    await walk(ol, 0);
    out.outline = flat;
  } catch (e) { out.outline = []; }
  return out;
}
