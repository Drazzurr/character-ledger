/* Stage 3: the book's style sheet. Every text style (font family, weight, italic, small caps, size,
   colour class) is counted across the book and given a role: body text, heading levels, run-in labels,
   sub-headings, table text, sidebar text. Roles can be overridden per book, and the overrides are kept. */

import { eachBlock } from "./layout.js";

export const STAGE3_VERSION = 1;

export const ROLES = [
  ["body", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"], ["h5", "Heading 5"],
  ["sub", "Sub-heading (feature level, spell school)"], ["label", "Run-in label"], ["emph", "Inline emphasis"], ["quote", "Flavour text"],
  ["table", "Table text"], ["sidebar", "Sidebar text"], ["other", "Other"],
];

/* Common TTRPG fonts and the roles they usually play (from the Solbera font notes). Only used to break ties. */
const SEEDS = [
  [/bookinsanity|bookmania/i, "body"], [/mrs?eaves/i, "heading"], [/scal[ay]sans/i, "table"],
  [/nodesto|modesto/i, "heading"], [/zatanna|vernon/i, "heading"],
];

export function parseKey(k) {
  const p = String(k).split("|");
  return { family: p[0], weight: p[1], italic: p[2] === "i", sc: p[3] === "sc", size: +p[4], color: p[5], bold: p[1] === "b" };
}

const loud = (st, body) => st.size > body.size * 1.08 || st.sc || st.bold || st.color === "c" || st.color === "w" || (st.family !== body.family && st.size >= body.size * 1.05);

/** Builds the style sheet from laid-out pages. overrides: { styleKey: role } */
export function buildStyleSheet(layPages, overrides = {}) {
  const S = new Map();
  const get = (k) => {
    if (!S.has(k)) S.set(k, { key: k, chars: 0, standalone: 0, standaloneChars: 0, lead: 0, table: 0, panel: 0, para: 0, italicPara: 0, samples: [], pages: new Set(), digits: 0 });
    return S.get(k);
  };
  for (const P of layPages) {
    eachBlock(P.blocks, (B, parent) => {
      const inPanel = !!parent;
      if (B.type === "table") {
        for (const k in B.chars || {}) { const s = get(k); s.chars += B.chars[k]; s.table += B.chars[k]; s.pages.add(P.page); }
        return;
      }
      if (B.type === "panel") return;
      for (const k in B.chars || {}) {
        const s = get(k);
        s.chars += B.chars[k]; s.pages.add(P.page);
        if (inPanel) s.panel += B.chars[k];
        if (B.k === k && B.n > 2) s.para += B.chars[k];
      }
      if (B.lead) get(B.lead.k).lead++;
      // a heading-like use: a short block of one style, not starting with a label
      const short = B.n <= 3 && (B.t || "").length <= 90 && !B.lead && B.type === "para";
      if (short && B.k) {
        const s = get(B.k);
        s.standalone++; s.standaloneChars += (B.t || "").length;
        if (/\d/.test(B.t || "") && !/^(chapter|part|appendix|book)\b/i.test(B.t || "")) s.digits = (s.digits || 0) + 1;
        if (s.samples.length < 4 && !s.samples.includes(B.t)) s.samples.push(B.t);
      } else if (B.lead) {
        const s = get(B.lead.k);
        if (s.samples.length < 4 && !s.samples.includes(B.lead.t)) s.samples.push(B.lead.t);
      } else if (B.k) {
        const s = get(B.k);
        if (s.samples.length < 2) s.samples.push((B.t || "").slice(0, 70));
      }
    });
  }
  const all = [...S.values()];
  if (!all.length) return { body: null, styles: [] };

  // body: most characters in multi-line paragraphs outside tables; seeds break near-ties
  const seedBoost = (s) => SEEDS.some(([rx, r]) => r === "body" && rx.test(s.key)) ? 1.15 : 1;
  const body = all.slice().sort((a, b) => b.para * seedBoost(b) - a.para * seedBoost(a))[0];
  const bodySt = parseKey(body.key);

  // how often a style's short lines are followed by body text (what headings do), within the same flow
  for (const s of all) { s.next = 0; s.nextBody = 0; }
  const isBodyLike = (B) => B && (B.type === "para" || B.type === "item") && B.k && (B.k === body.key || (B.n >= 2 && parseKey(B.k).family === bodySt.family));
  for (const P of layPages) {
    const seq = (blocks) => {
      for (let i = 0; i < blocks.length; i++) {
        const B = blocks[i];
        if (B.blocks) { seq(B.blocks); continue; }
        const short = B.type === "para" && B.n <= 3 && (B.t || "").length <= 90 && !B.lead && B.k;
        if (!short) continue;
        const s = S.get(B.k); if (!s) continue;
        s.next++;
        // look past a sub-heading or a second heading line to the text
        let j = i + 1;
        while (j < blocks.length && j <= i + 3 && blocks[j].type === "para" && blocks[j].n <= 2 && !isBodyLike(blocks[j]) && (blocks[j].t || "").length < 90) j++;
        if (isBodyLike(blocks[j]) || (blocks[j] && blocks[j].type === "table")) s.nextBody++;
      }
    };
    seq(P.blocks);
  }

  for (const s of all) {
    const st = parseKey(s.key);
    s.st = st;
    let role = "other", why = "";
    const total = Math.max(1, s.chars);
    if (s === body) { role = "body"; why = "most paragraph text"; }
    else if (s.table / total > 0.7) { role = "table"; why = "mostly inside tables"; }
    else if (s.lead >= 2 && s.lead >= s.standalone) { role = "label"; why = "starts paragraphs as a run-in label"; }
    else if (s.standalone >= 1 && st.italic && !st.bold && !st.sc && st.size <= bodySt.size * 1.1 && s.standaloneChars / total > 0.5 && s.nextBody >= s.next * 0.5) { role = "sub"; why = "short italic lines before text"; }
    else if (s.panel / total > 0.8) { role = "sidebar"; why = "mostly inside boxed text"; }
    else if (s.standalone >= 1 && loud(st, bodySt) && s.standaloneChars / total > 0.5 && st.size >= bodySt.size * 0.9 &&
             s.nextBody >= Math.max(1, s.next * 0.5) && (s.standalone >= 2 || st.size >= bodySt.size * 1.6) &&
             s.standaloneChars / Math.max(1, s.standalone) <= 48 && s.digits <= s.standalone * 0.5) {
      role = "heading"; why = "short lines in a louder style, followed by text " + s.nextBody + " of " + s.next + " times";
    }
    else if (s.standalone >= 1 && st.size <= bodySt.size * 1.1 && s.standaloneChars / total > 0.5 && st.family !== bodySt.family) { role = "sub"; why = "short lines in a second font"; }
    else if (s.panel / total > 0.85) { role = "sidebar"; why = "mostly inside boxed text"; }
    else if (st.italic && s.para > total * 0.5) { role = "quote"; why = "italic paragraphs"; }
    else if (s.para / total < 0.3 && (st.bold || st.italic || st.color === "c")) { role = "emph"; why = "inside paragraphs"; }
    else if (st.family === bodySt.family && Math.abs(st.size - bodySt.size) < 0.8) { role = "body"; why = "same as body text"; }
    s.role = role; s.why = why;
  }

  // heading levels: louder first (size, then small caps or capitals, then weight); same look in another colour = same level
  const heads = all.filter((s) => s.role === "heading");
  const rank = (a, b) => (b.st.size - a.st.size) || ((b.st.sc ? 1 : 0) - (a.st.sc ? 1 : 0)) || ((b.st.bold ? 1 : 0) - (a.st.bold ? 1 : 0)) || (b.standalone - a.standalone);
  const looks = [...new Set(heads.map((s) => s.st.family + "|" + s.st.weight + "|" + (s.st.sc ? 1 : 0) + "|" + (Math.round(s.st.size * 2) / 2)))];
  const lookOf = (s) => s.st.family + "|" + s.st.weight + "|" + (s.st.sc ? 1 : 0) + "|" + (Math.round(s.st.size * 2) / 2);
  const orderLooks = looks.map((l) => heads.find((s) => lookOf(s) === l)).sort(rank).map(lookOf);
  // in a long book, looks used fewer than 3 times (signatures, one-off titles) don't take a level, unless they are the largest
  const minUses = layPages.length >= 40 ? 3 : 1;
  let lvl = 0;
  const levelOf = {};
  for (const l of orderLooks) {
    const uses = heads.filter((s) => lookOf(s) === l).reduce((a, s) => a + s.standalone, 0);
    if (uses < minUses && lvl > 0) { levelOf[l] = 0; continue; }
    lvl = Math.min(lvl + 1, 5);
    levelOf[l] = lvl;
  }
  // number the levels actually used from 1
  const used = [...new Set(Object.values(levelOf).filter(Boolean))].sort((a, b) => a - b);
  for (const l in levelOf) if (levelOf[l]) levelOf[l] = used.indexOf(levelOf[l]) + 1;
  for (const s of heads) {
    const L = levelOf[lookOf(s)];
    if (L) s.role = "h" + L; else { s.role = "other"; s.why = "used as a heading only " + s.standalone + " times"; }
  }

  // the user's choices win
  for (const s of all) {
    s.auto = s.role;
    if (overrides[s.key]) { s.role = overrides[s.key]; s.overridden = true; }
  }

  const styles = all.sort((a, b) => b.chars - a.chars).map((s) => ({
    key: s.key, role: s.role, auto: s.auto, overridden: !!s.overridden, why: s.why, chars: s.chars,
    standalone: s.standalone, lead: s.lead, pages: s.pages.size, samples: s.samples.slice(0, 3),
    family: s.st.family, size: s.st.size, bold: s.st.bold, italic: s.st.italic, sc: s.st.sc, color: s.st.color,
  }));
  return { body: body.key, styles, v: STAGE3_VERSION };
}

/**
 * Applies roles to laid-out pages, in book order: headings and their levels, sub-headings, labels,
 * multi-line headings joined, and paragraphs that continue from the previous column or page marked.
 */
export function applyRoles(layPages, sheet) {
  const role = {};
  for (const s of sheet.styles) role[s.key] = s.role;
  let lastText = null;
  for (const P of layPages) {
    const walk = (blocks) => {
      const out = [];
      for (const B of blocks) {
        delete B.role; delete B.level; delete B.cont;
        if (B.type === "panel") { const keep = lastText; lastText = null; B.blocks = walk(B.blocks); lastText = keep; out.push(B); continue; }
        if (B.type === "table") { out.push(B); continue; }
        const r = role[B.k];
        const short = B.n <= 3 && (B.t || "").length <= 120 && !B.lead;
        if (short && /^h\d$/.test(r || "")) { B.role = "heading"; B.level = +r.slice(1); }
        else if (short && r === "sub") B.role = "sub";
        else if (B.type === "item") B.role = "item";
        else B.role = r === "quote" ? "quote" : "para";
        // a short italic line straight after a heading is its sub-heading ("2nd-level evocation", "Wondrous item, rare")
        const last = out[out.length - 1];
        if (B.role !== "heading" && B.role !== "sub" && last && last.role === "heading" && B.n <= 2 && (B.t || "").length <= 90 && !B.lead &&
            String(B.k).split("|")[2] === "i") B.role = "sub";
        if (B.lead && role[B.lead.k] && role[B.lead.k] !== "label") B.lead.role = role[B.lead.k];
        // a heading set on two or three lines comes out as one heading
        const prev = out[out.length - 1];
        if (prev && B.role === "heading" && prev.role === "heading" && prev.k === B.k && B.y - prev.y2 < (B.s || 10) * 1.2 && B.y >= prev.y - 1) {
          prev.t += " " + B.t; prev.md = (prev.md || prev.t) + " " + (B.md || B.t); prev.n += B.n;
          prev.y = Math.min(prev.y, B.y); prev.y2 = Math.max(prev.y2, B.y2); prev.x = Math.min(prev.x, B.x); prev.x2 = Math.max(prev.x2, B.x2);
          continue;
        }
        // text continuing from the previous column or page: no full stop before, lower-case start here
        if ((B.role === "para" || B.role === "item") && lastText && !/[.!?:)"'\]]\**$/.test(lastText.t.trim()) && /^[a-z(,;]/.test(B.t.trim())) B.cont = true;
        if (B.role === "para" || B.role === "item" || B.role === "quote") lastText = B;
        else lastText = null;
        out.push(B);
      }
      return out;
    };
    P.blocks = walk(P.blocks);
    let i = 0;
    eachBlock(P.blocks, (B) => { B.i = i++; });
  }
  return layPages;
}
