/**
 * Builds the single Word deliverable from the markdown in ../docs.
 *
 * The markdown is the source of truth; this file only renders it. Edit the
 * documents, re-run this, and the Word file follows — so the two can never
 * disagree, which is the failure mode a hand-maintained .docx always reaches.
 *
 *   npm install docx && node tools/build-docx.js
 *
 * Deliberately a small markdown subset rather than a general parser: headings,
 * paragraphs, pipe tables, bullet and ordered lists, checkboxes, fenced code,
 * blockquotes, rules, and inline bold/italic/code/links. That is everything the
 * documents use, and a parser that handles only what exists cannot silently
 * mis-render something it half-understands.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Tab,
  HeadingLevel, AlignmentType, WidthType, ShadingType, BorderStyle,
  PageBreak, Footer, PageNumber, TableOfContents, LevelFormat,
  TabStopType, VerticalAlign, ImageRun,
} = require('docx');

const DOCS = path.join(__dirname, '..', 'docs');
const OUT = path.join(__dirname, '..', 'Bariatric-Digital-Care-Platform-Readiness-Report.docx');

/* ── page geometry (A4, DXA: 1440 = 1 inch) ───────────────────────────────── */
const PAGE_W = 11906, MARGIN = 1134;
const CONTENT_W = PAGE_W - MARGIN * 2;          // 9638
const CONTENT_PX = Math.floor(CONTENT_W / 1440 * 96);  // 642px at 96dpi

/** Intrinsic pixel size from a PNG's IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ── palette ──────────────────────────────────────────────────────────────── */
const NAVY = '1A3A5C', MID = '2C5F7C', LIGHT = '3D7A99';
const SLATE = '44546A', MUTED = '6B7A8C';
const TH_FILL = 'E8EEF3', CODE_FILL = 'F4F6F8', RULE = 'C6D2DC';

const LATIN = 'Calibri', ARABIC = 'Arial', MONO = 'Consolas';

/* ── direction ────────────────────────────────────────────────────────────── */
const arCount = (s) => (s.match(/[؀-ۿ]/g) || []).length;
const laCount = (s) => (s.match(/[A-Za-z]/g) || []).length;
// The Unicode first-strong rule, with a majority fallback. First-strong alone
// mis-reads "**AR:** <arabic sentence>"; majority alone mis-reads an Arabic
// sentence quoting a long Latin phrase. Either signal is enough for RTL.
const isRTL = (s) => {
  const strong = (s.match(/[\u0600-\u06FFA-Za-z]/) || [])[0];
  if (strong && /[\u0600-\u06FF]/.test(strong)) return true;
  return arCount(s) > 0 && arCount(s) >= laCount(s);
};

/* ── inline ───────────────────────────────────────────────────────────────── */
// Local .md links become plain text: inside one document they point nowhere.
const delink = (s) => s.replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, '$1');

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]*)\]\(([^)]+)\)/g;

function runs(text, opts = {}) {
  const rtl = opts.rtl ?? isRTL(text);
  const base = {
    font: opts.font || (rtl ? ARABIC : LATIN),
    size: opts.size,
    color: opts.color,
    bold: opts.bold,
    italics: opts.italics,
    rightToLeft: rtl || undefined,
  };
  const mk = (t, extra = {}) => new TextRun({ ...base, ...extra, text: t });

  const out = [];
  let last = 0, m;
  // A fresh regex per call: bold and italic recurse, and a shared instance's
  // lastIndex would be reset by the inner call mid-iteration.
  const re = new RegExp(INLINE.source, 'g');
  const s = delink(text);
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(mk(s.slice(last, m.index)));
    // Bold and italic recurse so inline code inside them renders as code rather
    // than as literal backticks — `**`super_admin` was removed**` is common in
    // these documents and used to print its own markup.
    if (m[1] !== undefined) out.push(...runs(m[1], { ...opts, rtl, bold: true }));
    else if (m[2] !== undefined) out.push(mk(m[2], { font: MONO, size: (opts.size || 21) - 2, color: NAVY }));
    else if (m[3] !== undefined) out.push(...runs(m[3], { ...opts, rtl, italics: true }));
    else out.push(mk(m[4] || m[5], { color: MID, underline: {} }));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(mk(s.slice(last)));
  return out.length ? out : [mk('')];
}

const dirProps = (text) => isRTL(text)
  ? { bidirectional: true, alignment: AlignmentType.RIGHT }
  : {};

/* ── block parser ─────────────────────────────────────────────────────────── */
function parse(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let i = 0;

  const isTableSep = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-') && l.includes('|');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    // Fences may be indented — inside a list item, for instance. Matching only
    // at column zero turned an indented block into a paragraph and printed its
    // own backticks.
    const fence = line.match(/^(\s*)```/);
    if (fence) {
      const indent = fence[1].length;
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        const l = lines[i++];
        body.push(l.slice(0, indent).trim() === '' ? l.slice(indent) : l);
      }
      i++;
      blocks.push({ t: 'code', lines: body });
      continue;
    }

    if (!line.trim()) { i++; continue; }                        // blank

    const img = line.match(/^!\[(.*)\]\(([^)]+)\)\s*$/);          // standalone image
    if (img) { blocks.push({ t: 'image', alt: img[1], src: img[2] }); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);                  // heading
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() }); i++; continue; }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (line.trim().startsWith('|') && isTableSep(lines[i + 1] || '')) {   // table
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push({ t: 'table', header, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {                                   // blockquote
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', text: body.join(' ').trim() });
      continue;
    }

    const cb = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);       // checkbox list
    if (cb) {
      const items = [];
      while (i < lines.length) {
        const m2 = lines[i].match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (!m2) break;
        items.push({ checked: m2[1].toLowerCase() === 'x', text: m2[2] });
        i++;
      }
      blocks.push({ t: 'checks', items });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {                                // bullet list
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        let txt = lines[i++].replace(/^[-*]\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^[-*]\s/.test(lines[i].trim())) {
          txt += ' ' + lines[i++].trim();
        }
        items.push(txt);
      }
      blocks.push({ t: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {                               // ordered list
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const n = lines[i].match(/^(\d+)\.\s+(.*)$/);
        let txt = n[2];
        i++;
        while (i < lines.length && /^\s{3,}\S/.test(lines[i])) txt += ' ' + lines[i++].trim();
        items.push({ n: n[1], text: txt });
      }
      blocks.push({ t: 'ol', items });
      continue;
    }

    const body = [];                                            // paragraph
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|[-*]\s|\d+\.\s)/.test(lines[i])
           && !lines[i].trim().startsWith('|') && !/^\s*(---+|\*\*\*+)\s*$/.test(lines[i])) {
      body.push(lines[i++].trim());
    }
    if (body.length) blocks.push({ t: 'p', text: body.join(' ') });
    else i++;
  }
  return blocks;
}

/* ── column widths ────────────────────────────────────────────────────────── */
// Weighted by compressed average cell length: a column of long prose gets more
// room than a column of ticks, without one 200-character cell eating the table.
function widths(header, rows, total) {
  const n = header.length;
  const w = header.map((h, c) => {
    const lens = [h, ...rows.map((r) => r[c] ?? '')].map((x) => String(x).length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    return Math.pow(Math.max(avg, 3), 0.7);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  const min = Math.floor(total / n * 0.42);
  let px = w.map((x) => Math.max(min, Math.floor(x / sum * total)));
  const drift = total - px.reduce((a, b) => a + b, 0);
  px[px.indexOf(Math.max(...px))] += drift;
  return px;
}

/* ── renderers ────────────────────────────────────────────────────────────── */
const HEADINGS = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2,
                  HeadingLevel.HEADING_3, HeadingLevel.HEADING_4,
                  HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function render(blocks) {
  const out = [];

  for (const b of blocks) {
    switch (b.t) {
      case 'h':
        out.push(new Paragraph({
          heading: HEADINGS[Math.min(b.level, 6)],
          ...dirProps(b.text),
          children: runs(b.text, { rtl: isRTL(b.text) }),
        }));
        break;

      case 'p':
        out.push(new Paragraph({ ...dirProps(b.text), children: runs(b.text) }));
        break;

      case 'quote':
        out.push(new Paragraph({
          ...dirProps(b.text),
          indent: { left: 340 },
          spacing: { before: 120, after: 160 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: LIGHT, space: 10 } },
          children: runs(b.text, { italics: true, color: SLATE }),
        }));
        break;

      case 'ul':
        for (const it of b.items) {
          out.push(new Paragraph({
            numbering: { reference: 'md-bullets', level: 0 },
            ...dirProps(it),
            spacing: { after: 60 },
            children: runs(it),
          }));
        }
        break;

      // Literal numerals, not a numbering instance: Word continues a numbering
      // instance across every list in the document, so the fourth list in a
      // document would start at whatever the third one reached.
      case 'ol':
        for (const it of b.items) {
          const rtl = isRTL(it.text);
          out.push(new Paragraph({
            ...dirProps(it.text),
            // w:left is the *start* edge, which Word flips to the right in a
            // bidi paragraph — so one value is correct in both directions.
            indent: { left: 360, hanging: 300 },
            spacing: { after: 60 },
            children: [
              new TextRun({ text: `${it.n}.`, bold: true, color: MID, rightToLeft: rtl || undefined,
                            font: rtl ? ARABIC : LATIN }),
              new TextRun({ children: [new Tab()] }),
              ...runs(it.text),
            ],
          }));
        }
        break;

      case 'checks':
        for (const it of b.items) {
          out.push(new Paragraph({
            ...dirProps(it.text),
            indent: { left: 360, hanging: 300 },
            spacing: { after: 60 },
            children: [
              new TextRun({ text: it.checked ? '☒' : '☐', color: MID, size: 22 }),
              new TextRun({ children: [new Tab()] }),
              ...runs(it.text),
            ],
          }));
        }
        break;

      case 'code':
        b.lines.forEach((l, idx) => {
          out.push(new Paragraph({
            spacing: { before: idx === 0 ? 120 : 0, after: idx === b.lines.length - 1 ? 160 : 0, line: 230 },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: CODE_FILL },
            indent: { left: 170, right: 170 },
            children: [new TextRun({ text: l || ' ', font: MONO, size: 17, color: '253544' })],
          }));
        });
        break;

      // Diagrams are rendered at 2x by tools/diagrams/render.js, so scaling to
      // the text column here preserves the detail rather than throwing it away.
      case 'image': {
        const file = path.join(DOCS, b.src);
        if (!fs.existsSync(file)) { console.warn('  ! missing image: ' + b.src); break; }
        const data = fs.readFileSync(file);
        const dim = pngSize(data);
        if (!dim) { console.warn('  ! not a readable PNG: ' + b.src); break; }
        const w = CONTENT_PX;
        const h = Math.round(dim.h * (w / dim.w));
        out.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: b.alt ? 60 : 220 },
          keepNext: !!b.alt,
          children: [new ImageRun({ type: 'png', data, transformation: { width: w, height: h } })],
        }));
        if (b.alt) {
          out.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 220 },
            children: [new TextRun({ text: b.alt, size: 17, italics: true, color: MUTED })],
          }));
        }
        break;
      }

      case 'hr':
        out.push(new Paragraph({
          spacing: { before: 100, after: 180 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
          children: [new TextRun({ text: '' })],
        }));
        break;

      case 'table': {
        const cols = widths(b.header, b.rows, CONTENT_W);
        const fs = b.header.length >= 7 ? 16 : b.header.length >= 5 ? 17 : 18;
        const cell = (txt, opts) => new TableCell({
          width: { size: opts.w, type: WidthType.DXA },
          shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({
            ...dirProps(txt),
            spacing: { before: 0, after: 0, line: 240 },
            children: runs(txt, { size: fs, bold: opts.bold, color: opts.color }),
          })],
        });

        out.push(new Table({
          columnWidths: cols,
          width: { size: CONTENT_W, type: WidthType.DXA },
          borders: ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical']
            .reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 2, color: RULE }, a), {}),
          rows: [
            new TableRow({
              tableHeader: true,
              children: b.header.map((h, c) => cell(h, { w: cols[c], fill: TH_FILL, bold: true, color: NAVY })),
            }),
            ...b.rows.map((r) => new TableRow({
              children: cols.map((w, c) => cell(r[c] ?? '', { w })),
            })),
          ],
        }));
        out.push(new Paragraph({ spacing: { after: 180 }, children: [new TextRun('')] }));
        break;
      }
    }
  }
  return out;
}

/* ── document assembly ────────────────────────────────────────────────────── */
const PARTS = [
  { file: 'docs/00-EXECUTIVE-SUMMARY-AR.md', title: 'ملخص تنفيذي', dropH1: true },
  { file: 'docs/00-READINESS-REPORT.md', label: 'PART I', title: 'Project Readiness Report', dropH1: true },
  { file: 'docs/01-CAPABILITY-ASSESSMENT.md', label: 'PART II', title: 'Capability Assessment', dropH1: true },
  { file: 'docs/02-RISK-REGISTER.md', label: 'PART III', title: 'Risk Register', dropH1: true },
  { file: 'docs/03-STACK-EVALUATION.md', label: 'PART IV', title: 'Stack Evaluation', dropH1: true },
  { file: 'docs/04-ARCHITECTURE-DRAFT.md', label: 'PART V', title: 'Architecture (Draft)', dropH1: true },
  { file: 'docs/05-MVP-AND-ROADMAP.md', label: 'PART VI', title: 'MVP Recommendation and Roadmap', dropH1: true },
  { file: 'docs/06-OPEN-DECISIONS.md', label: 'PART VII', title: 'Open Decisions — Questions for Ali', dropH1: true },
  { file: 'docs/07-COST-DRIVERS.md', label: 'PART VIII', title: 'Technical Cost Drivers', dropH1: true },
  { file: 'docs/08-WAYS-OF-WORKING.md', label: 'PART IX', title: 'Ways of Working', dropH1: true },
  { file: 'docs/09-CLINICAL-CONTENT-REQUESTS.md', label: 'PART X', title: 'Clinical Content Requests', dropH1: true },
  { file: 'docs/11-ARCHITECTURE-DECISION-ADDENDUM.md', label: 'PART XI', title: 'Final Architecture Decision Addendum', dropH1: true },
  { file: 'docs/12-REVIEW-RESPONSE-AND-ACCESS-DESIGN.md', label: 'PART XII', title: 'Review Response and Access Design', dropH1: true },
  { file: 'docs/adr/README.md', label: 'APPENDIX A', title: 'Architecture Decision Records', dropH1: true },
  { file: 'docs/adr/0001-modular-monolith-typescript.md', sub: true },
  { file: 'docs/adr/0002-long-lived-container.md', sub: true },
  { file: 'docs/adr/0003-single-authorization-layer.md', sub: true },
  { file: 'docs/adr/0004-one-public-clinical-data-gateway.md', sub: true },
];

function partHeading(p, first) {
  const kids = [];
  if (!first) kids.push(new Paragraph({ children: [new PageBreak()] }));
  if (p.label) {
    kids.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: p.label.toUpperCase(), bold: true, size: 19, color: LIGHT,
                               characterSpacing: 60 })],
    }));
  }
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    ...dirProps(p.title),
    spacing: { before: 0, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 8 } },
    children: runs(p.title, { rtl: isRTL(p.title) }),
  }));
  return kids;
}

const body = [];
PARTS.forEach((p, idx) => {
  const md = fs.readFileSync(path.join(__dirname, '..', p.file), 'utf8');
  let blocks = parse(md);

  if (p.sub) {
    body.push(new Paragraph({ children: [new PageBreak()] }));
    blocks = blocks.map((b) => (b.t === 'h' ? { ...b, level: Math.min(b.level + 1, 6) } : b));
  } else {
    body.push(...partHeading(p, idx === 0));
    // Dropping the document's own title frees the top level for the PART
    // heading. A document carrying further H1s (05 and 08 each have several)
    // still needs its headings pushed down one so those become sections; a
    // single-H1 document does not, and shifting it anyway would bury every
    // section a level below what the table of contents collects.
    const tops = blocks.filter((b) => b.t === 'h' && b.level === 1).length;
    if (p.dropH1) {
      const at = blocks.findIndex((b) => b.t === 'h' && b.level === 1);
      if (at !== -1) blocks.splice(at, 1);
    }
    if (tops > 1) {
      blocks = blocks.map((b) => (b.t === 'h' ? { ...b, level: Math.min(b.level + 1, 6) } : b));
    }
  }
  body.push(...render(blocks));
});

/* ── cover ────────────────────────────────────────────────────────────────── */
const coverLine = (text, o = {}) => new Paragraph({
  alignment: o.align || AlignmentType.LEFT,
  spacing: { before: o.before || 0, after: o.after ?? 100 },
  children: [new TextRun({ text, size: o.size || 22, bold: o.bold, color: o.color || SLATE,
                           font: LATIN, characterSpacing: o.spacing })],
});

const metaRow = (k, v) => new Paragraph({
  spacing: { after: 90 },
  tabStops: [{ type: TabStopType.LEFT, position: 2400 }],
  children: [
    new TextRun({ text: k, bold: true, size: 20, color: MUTED }),
    new TextRun({ children: [new Tab()] }),
    new TextRun({ text: v, size: 21, color: '1F2933' }),
  ],
});

const cover = [
  new Paragraph({ spacing: { before: 2600, after: 0 }, children: [
    new TextRun({ text: 'PROJECT READINESS REPORT', bold: true, size: 20, color: LIGHT, characterSpacing: 90 }),
  ] }),
  new Paragraph({
    spacing: { before: 220, after: 0 },
    children: [new TextRun({ text: 'Bariatric Digital Care Platform', bold: true, size: 56, color: NAVY })],
  }),
  new Paragraph({
    spacing: { before: 120, after: 260 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: RULE, space: 14 } },
    children: [new TextRun({ text: 'A digital care pathway for a bariatric and general surgery clinic',
                             size: 24, color: SLATE, italics: true })],
  }),
  metaRow('Prepared for', 'Ali — Product Owner · Medical Reviewer · Technical Operator'),
  metaRow('Prepared by', 'Claude Code'),
  metaRow('Date', '16 September 2026'),
  metaRow('Status', 'Pre-approval draft — no code written, nothing approved'),
  metaRow('Repository', 'bariatric-care/ · branch claude/bariatric-platform-readiness-d9rp2o'),

  new Paragraph({ spacing: { before: 700 }, children: [new TextRun('')] }),
  new Table({
    columnWidths: [CONTENT_W],
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 18, color: NAVY },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F7FAFC' },
      margins: { top: 200, bottom: 200, left: 240, right: 240 },
      children: [
        new Paragraph({ spacing: { after: 120 }, children: [
          new TextRun({ text: 'Two markers are used throughout, and both mean “not settled”.',
                        bold: true, size: 20, color: NAVY }) ] }),
        new Paragraph({ spacing: { after: 90 }, children: [
          new TextRun({ text: '[MEDICAL REVIEW REQUIRED]', bold: true, font: MONO, size: 18, color: 'A33A3A' }),
          new TextRun({ text: '  Clinical content or a clinical rule. Not approved until the Medical '
                            + 'Reviewer approves it in writing. Nothing clinical in this report was invented.',
                        size: 19, color: SLATE }) ] }),
        new Paragraph({ spacing: { after: 0 }, children: [
          new TextRun({ text: '[DECISION REQUIRED]', bold: true, font: MONO, size: 18, color: 'A33A3A' }),
          new TextRun({ text: '  A product, legal or infrastructure decision that cannot be derived from '
                            + 'engineering reasoning alone.', size: 19, color: SLATE }) ] }),
      ],
    })] })],
  }),

  new Paragraph({ spacing: { before: 420 }, children: [
    new TextRun({ text: 'This platform is not an emergency service, not a monitoring service, and not a '
                      + 'diagnostic device. No component autonomously diagnoses, recommends treatment, '
                      + 'changes medication, or reassures a patient that a symptom is benign.',
                  size: 19, italics: true, color: MUTED }) ] }),
];

/* ── contents ─────────────────────────────────────────────────────────────── */
const contents = [
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 8 } },
    children: [new TextRun({ text: 'Contents' })],
  }),
  new Paragraph({ spacing: { after: 200 }, children: [
    new TextRun({ text: 'If the entries below appear empty, select them and press F9 in Word to build '
                      + 'the table of contents.', size: 18, italics: true, color: MUTED }) ] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
];

const footer = new Footer({
  children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 8 } },
    children: [
      new TextRun({ text: 'Bariatric Digital Care Platform — Project Readiness Report', size: 16, color: MUTED }),
      new TextRun({ children: [new Tab()] }),
      new TextRun({ text: 'Page ', size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED, bold: true }),
      new TextRun({ text: ' of ', size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
    ],
  })],
});

const heading = (size, color, before, after) => ({
  run: { font: LATIN, size, bold: true, color },
  paragraph: { spacing: { before, after }, keepNext: true },
});

const doc = new Document({
  creator: 'Claude Code',
  title: 'Bariatric Digital Care Platform — Project Readiness Report',
  description: 'Capability assessment, risk register, stack evaluation, architecture, MVP critique and roadmap. Pre-approval.',
  features: { updateFields: true },
  styles: {
    default: {
      document: {
        run: { font: LATIN, size: 21, color: '1F2933' },
        paragraph: { spacing: { after: 140, line: 276 } },
      },
      heading1: heading(32, NAVY, 340, 160),
      heading2: heading(26, MID, 300, 140),
      heading3: heading(23, LIGHT, 260, 120),
      heading4: heading(21, SLATE, 220, 100),
      heading5: heading(20, SLATE, 200, 90),
      heading6: heading(19, MUTED, 180, 80),
    },
  },
  numbering: {
    config: [{
      reference: 'md-bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 240 } },
                 run: { color: MID } },
      }],
    }],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE_W, height: 16838 },
                            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children: cover,
    },
    {
      properties: { page: { size: { width: PAGE_W, height: 16838 },
                            margin: { top: MARGIN, bottom: 1000, left: MARGIN, right: MARGIN } } },
      footers: { default: footer },
      children: [...contents.slice(1), ...body],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${OUT} (${(buf.length / 1024).toFixed(0)} KB)`);
});
