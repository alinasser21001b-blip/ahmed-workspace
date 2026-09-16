/**
 * A small SVG vocabulary for the project's diagrams.
 *
 * Hand-built rather than Mermaid/Graphviz for two reasons: the diagrams carry
 * annotations (rules, trust boundaries, "who owns this") that generic layout
 * engines place badly, and a rendered PNG has to survive being printed in a
 * Word document in greyscale. Every colour below also differs in weight or
 * stroke so the meaning does not depend on colour alone.
 */
'use strict';

const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
const MONO = "'Consolas','SF Mono',Menlo,monospace";

const C = {
  ink: '#1A3A5C', mid: '#2C5F7C', light: '#3D7A99', slate: '#44546A', muted: '#6B7A8C',
  rule: '#C6D2DC', wash: '#F7FAFC', fill: '#E8EEF3', paper: '#FFFFFF',
  dangerLine: '#A33A3A', dangerFill: '#FDF4F4',
  goodLine: '#2E6B4F', goodFill: '#F1F8F4',
  warnLine: '#9A6B1F', warnFill: '#FDF8EE',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy wrap by estimated advance width (~0.52em for this family). */
function wrap(text, widthPx, size) {
  const max = Math.max(4, Math.floor(widthPx / (size * 0.52)));
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!line) { line = word; continue; }
    if ((line + ' ' + word).length <= max) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

function text(x, y, s, o = {}) {
  const size = o.size || 12;
  const anchor = o.anchor || 'middle';
  const fill = o.color || C.slate;
  const weight = o.weight || 400;
  const family = o.mono ? MONO : FONT;
  const extra = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  const up = o.upper ? String(s).toUpperCase() : s;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(up)}</text>`;
}

/** Multi-line centred text block, returns svg + the height it consumed. */
function block(x, y, lines, o = {}) {
  const size = o.size || 12, lh = o.lh || size * 1.32;
  return lines.map((l, i) => text(x, y + i * lh, l, o)).join('');
}

const TONES = {
  plain:  { fill: C.wash,       stroke: C.mid,        sw: 1.5, title: C.ink },
  strong: { fill: C.fill,       stroke: C.ink,        sw: 2,   title: C.ink },
  danger: { fill: C.dangerFill, stroke: C.dangerLine, sw: 1.7, title: C.dangerLine },
  good:   { fill: C.goodFill,   stroke: C.goodLine,   sw: 1.7, title: C.goodLine },
  warn:   { fill: C.warnFill,   stroke: C.warnLine,   sw: 1.7, title: C.warnLine },
  ghost:  { fill: '#FAFBFC',    stroke: '#B8C4CE',    sw: 1.3, title: C.muted, dash: '5 4' },
};

/**
 * A labelled box. `title` is the name, `lines` the detail beneath it.
 * `tag` prints a small uppercase kicker above the title.
 */
function box(x, y, w, h, o = {}) {
  const t = TONES[o.tone || 'plain'];
  const dash = o.dash || t.dash;
  const r = o.r === undefined ? 6 : o.r;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${o.fill || t.fill}" stroke="${o.stroke || t.stroke}" stroke-width="${t.sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const cx = x + w / 2;
  const titleSize = o.titleSize || 13;
  const lines = o.lines ? wrap(o.lines, w - 16, 11).slice(0, 4) : [];
  const titleLines = wrap(o.title || '', w - 14, titleSize);

  // Stack the three bands explicitly. An earlier version derived the title
  // baseline from the tag's and left 8px between a 13pt title and an 8.5pt
  // kicker, which overlapped them in every box that used both.
  const TAG_BAND = o.tag ? 17 : 0;
  const titleBand = titleLines.length * titleSize * 1.25;
  const detailBand = lines.length ? 6 + lines.length * 14 : 0;
  const top = y + (h - (TAG_BAND + titleBand + detailBand)) / 2;

  if (o.tag) {
    s += text(cx, top + 9, o.tag, { size: 8.5, weight: 700, color: o.tagColor || C.light, upper: true, spacing: '0.09em' });
  }
  s += block(cx, top + TAG_BAND + titleSize * 0.95, titleLines,
             { size: titleSize, weight: 600, color: o.titleColor || t.title, lh: titleSize * 1.25 });
  if (lines.length) {
    s += block(cx, top + TAG_BAND + titleBand + 16, lines, { size: 11, color: o.lineColor || C.slate, lh: 14 });
  }
  return s;
}

/** A background region grouping boxes, with a kicker label at top-left. */
function zone(x, y, w, h, label, o = {}) {
  const stroke = o.stroke || C.rule;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${o.fill || 'none'}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="${o.dash || '6 5'}"/>`;
  if (label) s += text(x + 12, y + 16, label, { size: 9, weight: 700, color: o.color || C.light, anchor: 'start', upper: true, spacing: '0.1em' });
  if (o.note) s += text(x + w - 12, y + 16, o.note, { size: 9.5, color: C.muted, anchor: 'end' });
  return s;
}

/** Straight arrow with optional mid label. dir: 'down'|'up'|'right'|'left'. */
function arrow(x1, y1, x2, y2, o = {}) {
  const col = o.color || C.slate;
  const head = o.color === C.dangerLine ? 'headD' : (o.color === C.goodLine ? 'headG' : 'head');
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${o.w || 1.6}"${dash} marker-end="url(#${head})"${o.both ? ` marker-start="url(#${head}r)"` : ''}/>`;
  if (o.label) {
    const mx = (x1 + x2) / 2 + (o.lx || 0), my = (y1 + y2) / 2 + (o.ly || -6);
    const lw = o.label.length * 5.6 + 10;
    if (o.labelBg !== false) s += `<rect x="${mx - lw / 2}" y="${my - 9}" width="${lw}" height="13" fill="${C.paper}" opacity="0.95"/>`;
    s += text(mx, my + 1, o.label, { size: 9.5, color: o.labelColor || C.muted });
  }
  return s;
}

/** Orthogonal elbow: horizontal then vertical, or vertical then horizontal. */
function elbow(x1, y1, x2, y2, o = {}) {
  const col = o.color || C.slate;
  const head = o.color === C.dangerLine ? 'headD' : (o.color === C.goodLine ? 'headG' : 'head');
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  const d = o.vfirst ? `M ${x1} ${y1} V ${y2} H ${x2}` : `M ${x1} ${y1} H ${x2} V ${y2}`;
  let s = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${o.w || 1.6}"${dash} marker-end="url(#${head})"/>`;
  if (o.label) {
    const mx = o.lxAbs !== undefined ? o.lxAbs : (o.vfirst ? (x1 + x2) / 2 : x2);
    const my = o.lyAbs !== undefined ? o.lyAbs : (o.vfirst ? y2 - 7 : (y1 + y2) / 2);
    const lw = o.label.length * 5.6 + 10;
    s += `<rect x="${mx - lw / 2}" y="${my - 9}" width="${lw}" height="13" fill="${C.paper}" opacity="0.95"/>`;
    s += text(mx, my + 1, o.label, { size: 9.5, color: o.labelColor || C.muted });
  }
  return s;
}

/** Small annotation pinned beside something, with a leader line. */
function note(x, y, w, lines, o = {}) {
  const ls = Array.isArray(lines) ? lines : wrap(lines, w - 16, 10.5);
  const h = 10 + ls.length * 14;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${o.fill || '#FFFDF5'}" stroke="${o.stroke || '#D9C89A'}" stroke-width="1"/>`;
  s += block(x + w / 2, y + 18, ls, { size: 10.5, color: o.color || '#6B5A2B', lh: 14 });
  return { svg: s, h };
}

function legend(x, y, items) {
  let s = '', dx = x;
  for (const it of items) {
    const t = TONES[it.tone || 'plain'];
    s += `<rect x="${dx}" y="${y - 8}" width="14" height="11" rx="2.5" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.4"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''}/>`;
    s += text(dx + 20, y + 1, it.label, { size: 10, color: C.muted, anchor: 'start' });
    dx += 20 + it.label.length * 5.4 + 24;
  }
  return s;
}

function doc(w, h, body, o = {}) {
  const defs = `<defs>
    <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.slate}"/></marker>
    <marker id="headr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.slate}"/></marker>
    <marker id="headD" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.dangerLine}"/></marker>
    <marker id="headG" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${C.goodLine}"/></marker>
  </defs>`;
  const title = o.title ? text(o.pad || 24, 26, o.title, { size: 13.5, weight: 700, color: C.ink, anchor: 'start' }) : '';
  const sub = o.subtitle ? text(o.pad || 24, 43, o.subtitle, { size: 10.5, color: C.muted, anchor: 'start' }) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}<rect width="${w}" height="${h}" fill="${C.paper}"/>${title}${sub}${body}</svg>`;
}

module.exports = { C, FONT, MONO, esc, wrap, text, block, box, zone, arrow, elbow, note, legend, doc, TONES };
