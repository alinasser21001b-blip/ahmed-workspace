'use strict';
const { C, text, block, box, zone, arrow, elbow, note, legend, doc } = require('./svg.js');

/* ── D5 — The care pathway the platform has to follow ─────────────────────── */
function journey() {
  const W = 1180, H = 560;
  let s = '';
  const stages = [
    { x: 40,  w: 150, t: 'First contact',   sub: 'onboarding' },
    { x: 200, w: 150, t: 'Pre-op pathway',  sub: 'checklist' },
    { x: 360, w: 120, t: 'Surgery',         sub: 'procedure record', tone: 'strong' },
    { x: 490, w: 120, t: 'Early post-op',   sub: 'days' },
    { x: 620, w: 110, t: '1 month' },
    { x: 740, w: 110, t: '3 months' },
    { x: 860, w: 110, t: '6 / 12 months' },
    { x: 980, w: 160, t: 'Annual follow-up', sub: 'for years' },
  ];
  s += `<line x1="40" y1="250" x2="1140" y2="250" stroke="${C.rule}" stroke-width="2.5"/>`;
  stages.forEach((st) => {
    s += box(st.x, 218, st.w, 64, { title: st.t, lines: st.sub, tone: st.tone || 'plain', titleSize: 12 });
  });

  s += text(40, 106, 'What the patient does', { size: 10, weight: 700, color: C.light, anchor: 'start', upper: true, spacing: '0.09em' });
  const above = [
    { x: 40,  w: 310, t: 'History, medications, allergies, weight' },
    { x: 360, w: 250, t: 'Daily tasks · hydration · symptoms' },
    { x: 620, w: 230, t: 'Weight · nutrition · supplements' },
    { x: 860, w: 280, t: 'Periodic check-ins · labs · attendance' },
  ];
  above.forEach((a) => { s += box(a.x, 122, a.w, 50, { title: a.t, tone: 'plain', titleSize: 11.5 }); s += arrow(a.x + a.w / 2, 172, a.x + a.w / 2, 214, { w: 1.3 }); });

  s += text(40, 348, 'What the clinic sees', { size: 10, weight: 700, color: C.light, anchor: 'start', upper: true, spacing: '0.09em' });
  const below = [
    { x: 40,  w: 310, t: 'Enrolment at the desk · record created' },
    { x: 360, w: 250, t: 'Procedure recorded · timeline starts' },
    { x: 620, w: 230, t: 'Follow-up queue · overdue detection', tone: 'good' },
    { x: 860, w: 280, t: 'Loss-to-follow-up detection', tone: 'good' },
  ];
  below.forEach((b) => { s += arrow(b.x + b.w / 2, 286, b.x + b.w / 2, 358, { w: 1.3 }); s += box(b.x, 362, b.w, 50, { title: b.t, tone: b.tone || 'plain', titleSize: 11.5 }); });

  const n = note(40, 440, 1100, [
    'Every stage name, every duration and every boundary on this line is configuration owned by the Medical Reviewer, not code — and every one of them is currently empty.',
    'The system provides the engine. [MEDICAL REVIEW REQUIRED] applies to the whole timeline.',
  ]);
  s += n.svg;
  return { name: 'd5-patient-journey', w: W, h: H, svg: doc(W, H, s, {
    title: 'The bariatric care pathway the platform has to follow',
    subtitle: 'The product is not a tracker; it is this pathway made operational' }) };
}

/* ── D6 — Milestones, and the fact that the critical path is not engineering ─ */
function roadmap() {
  const W = 1180, H = 560;
  let s = '';
  // Fixed-width slots with the name INSIDE the box. An earlier version put the
  // name to the right of each box, where it ran under the following milestone,
  // and derived box widths from effort, which overflowed the canvas.
  const GUT = 200, TRACK = 1150 - GUT, N = 12, SLOT = TRACK / N, BW = SLOT - 8;
  const ms = [
    ['M0', 'Foundations'], ['M1', 'Identity RBAC audit'], ['M2', 'Patients enrolment'],
    ['M3', 'Weights'], ['M4', 'Follow-up queue'], ['M5', 'Patient app'],
    ['M6', 'Pathway reminders'], ['M7', 'Symptoms triage'], ['M8', 'Documents content'],
    ['M9', 'Hardening'], ['M10', 'Pilot'], ['M11', 'Launch'],
  ];
  s += text(40, 92, 'Engineering', { size: 10, weight: 700, color: C.light, anchor: 'start', upper: true, spacing: '0.09em' });
  s += `<line x1="${GUT}" y1="138" x2="1150" y2="138" stroke="${C.rule}" stroke-width="2"/>`;
  ms.forEach((m, i) => {
    const x = GUT + i * SLOT + 4;
    const tone = m[0] === 'M4' ? 'good' : m[0] === 'M10' ? 'warn' : m[0] === 'M11' ? 'strong' : 'plain';
    s += box(x, 106, BW, 64, { title: m[0], lines: m[1], tone, titleSize: 12.5 });
  });

  s += text(40, 226, 'Not engineering', { size: 10, weight: 700, color: C.dangerLine, anchor: 'start', upper: true, spacing: '0.09em' });
  const crit = [
    ['Clinical content', 'Medical Reviewer', 0, 8, 'gates M6, M7'],
    ['Channel decision', 'WhatsApp / SMS', 0, 2, 'gates M1, M6'],
    ['Legal / privacy review', 'local counsel', 0, 8, 'gates M7 and launch'],
    ['Apple Developer enrolment', 'weeks of lead time', 0, 11, 'gates launch'],
  ];
  crit.forEach((c, i) => {
    const y = 244 + i * 54;
    s += text(190, y + 20, c[0], { size: 11, color: C.dangerLine, anchor: 'end', weight: 600 });
    s += text(190, y + 34, c[1], { size: 9, color: C.muted, anchor: 'end' });
    const x = GUT + c[2] * SLOT + 4, w = (c[3] - c[2]) * SLOT + BW;
    s += `<rect x="${x}" y="${y}" width="${w}" height="38" rx="5" fill="${C.dangerFill}" stroke="${C.dangerLine}" stroke-width="1.4" stroke-dasharray="6 4"/>`;
    s += text(x + w / 2, y + 24, c[4], { size: 10, color: C.dangerLine, weight: 600 });
  });

  // Where the launch actually sits, so the gates can be read against it.
  const lx = GUT + 11 * SLOT + 4 + BW / 2;
  s += `<line x1="${lx}" y1="178" x2="${lx}" y2="470" stroke="${C.ink}" stroke-width="1.3" stroke-dasharray="4 4"/>`;
  s += text(lx, 486, 'launch', { size: 10, weight: 700, color: C.ink });

  s += text(40, 512, 'Every gate on the lower track has a long lead time, and not one of them is code.', { size: 12, weight: 600, color: C.ink, anchor: 'start' });
  s += text(40, 532, 'Start the clinical content and the Apple account during M0. Milestones are sequence, not calendar.', { size: 10.5, color: C.muted, anchor: 'start' });
  return { name: 'd6-roadmap-critical-path', w: W, h: H, svg: doc(W, H, s, {
    title: 'Milestones \u2014 and the critical path that is not engineering',
    subtitle: 'The lower track is what actually decides the launch date' }) };
}

/* ── D7 — Who can actually do what ────────────────────────────────────────── */
function capability() {
  const W = 1180, H = 600;
  let s = '';
  const cols = [
    { x: 40,  t: 'Claude Code', sub: 'primary implementer', tone: 'plain', items: ['Backend, API, data model', 'Migrations, contracts', 'Dashboard and mobile code', 'Tests and CI pipelines', 'Docs, ADRs, runbooks', 'Infrastructure-as-code'] },
    { x: 325, t: 'Codex', sub: 'independent reviewer', tone: 'plain', items: ['Adversarial authz review', 'Negative / boundary tests', 'Medical-rule test cases', 'Data-model second opinion', 'Dependency + licence review', 'Security review of surfaces'] },
    { x: 610, t: 'Ali', sub: 'owner · reviewer · operator', tone: 'strong', items: ['ALL clinical content', 'Product decisions and scope', 'Final acceptance', 'Cloud, secrets, deploys', 'Pilot and enrolment', 'Clinic staff buy-in'] },
    { x: 895, t: 'Human specialists', sub: 'one-off engagements', tone: 'danger', items: ['Penetration test', 'Legal / privacy review', 'iOS release + signing', 'Real-device testing', 'Architecture review M0/M9', 'On-call backup'] },
  ];
  cols.forEach((c) => {
    s += box(c.x, 90, 245, 62, { title: c.t, lines: c.sub, tone: c.tone });
    c.items.forEach((it, i) => {
      const y = 166 + i * 46;
      s += `<rect x="${c.x}" y="${y}" width="245" height="38" rx="4" fill="#FFFFFF" stroke="${C.rule}"/>`;
      const lines = it.length > 30 ? [it.slice(0, it.lastIndexOf(' ', 30)), it.slice(it.lastIndexOf(' ', 30) + 1)] : [it];
      s += block(c.x + 122, y + (lines.length === 1 ? 24 : 17), lines, { size: 10.5, color: C.slate, lh: 13 });
    });
  });

  s += zone(40, 452, 1100, 96, 'the honest split', { stroke: C.ink, fill: C.wash });
  s += text(70, 492, '75–85%', { size: 26, weight: 700, color: C.ink, anchor: 'start' });
  s += text(70, 512, 'of the code and technical artifacts', { size: 10.5, color: C.muted, anchor: 'start' });
  s += text(360, 492, '40–50%', { size: 26, weight: 700, color: C.dangerLine, anchor: 'start' });
  s += text(360, 512, 'of the project as a whole', { size: 10.5, color: C.muted, anchor: 'start' });
  s += text(640, 486, 'The gap is the answer: half of this project is not artifacts at all —', { size: 11, color: C.ink, anchor: 'start' });
  s += text(640, 504, 'clinical content, decisions, operations, validation, trust, legal posture', { size: 11, color: C.ink, anchor: 'start' });
  s += text(640, 522, 'and launch. Every non-negotiable in the right-hand column is a human.', { size: 11, color: C.ink, anchor: 'start' });
  return { name: 'd7-capability-split', w: W, h: H, svg: doc(W, H, s, {
    title: 'Who can actually do what',
    subtitle: 'Nothing in the Ali or specialist columns can be delegated to an AI at any budget' }) };
}

/* ── D8 — Risk register shape ─────────────────────────────────────────────── */
function risks() {
  const W = 1180, H = 540;
  let s = '';
  const tiers = [
    { y: 88,  t: 'Tier 1 — most likely to kill the project', tone: 'danger',
      items: ['R1 Patient engagement collapses', 'R2 Clinical content never finishes', 'R3 Scope creep', 'R4 Ali is a single point of failure', 'R5 Clinic staff do not adopt it'],
      note: 'Product, people and discipline. NOT technical.' },
    { y: 230, t: 'Tier 2 — safety and security', tone: 'warn',
      items: ['R6 Broken access control', 'R7 Unstaffed duty of care', 'R8 Medical data breach', 'R9 Protocol versioning', 'R10 Notification ≠ informed', 'R11 AI invents clinical content'],
      note: 'Lower probability, highest consequence.' },
    { y: 372, t: 'Tier 3 — engineering and delivery', tone: 'plain',
      items: ['R12 Green CI that tests nothing', 'R13 Untested backups', 'R14 AI code drift', 'R15/16 Tenancy over- and under-build', 'R17 SMS cost', 'R18 Store rejection', 'R19–21 Lock-in, devices, RTL'],
      note: 'Well understood and controllable.' },
  ];
  tiers.forEach((t) => {
    const tone = t.tone === 'danger' ? { f: C.dangerFill, st: C.dangerLine } : t.tone === 'warn' ? { f: C.warnFill, st: C.warnLine } : { f: C.wash, st: C.mid };
    s += `<rect x="40" y="${t.y}" width="1100" height="124" rx="8" fill="${tone.f}" stroke="${tone.st}" stroke-width="1.5"/>`;
    s += text(62, t.y + 26, t.t, { size: 12.5, weight: 700, color: tone.st, anchor: 'start' });
    s += text(1118, t.y + 26, t.note, { size: 10.5, color: tone.st, anchor: 'end' });
    t.items.forEach((it, i) => {
      const per = Math.floor(1060 / t.items.length);
      const x = 62 + i * per;
      s += `<rect x="${x}" y="${t.y + 44}" width="${per - 10}" height="60" rx="4" fill="#FFFFFF" stroke="${C.rule}"/>`;
      const words = it.split(' ');
      const lines = []; let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length <= 18) cur = (cur + ' ' + w).trim(); else { lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      s += block(x + (per - 10) / 2, t.y + 44 + (60 - lines.length * 13) / 2 + 10, lines.slice(0, 4), { size: 10, color: C.slate, lh: 13 });
    });
  });
  s += text(40, 516, 'The register’s shape is the finding: effort naturally goes to Tier 3, where it matters least.',
    { size: 12, weight: 600, color: C.ink, anchor: 'start' });
  return { name: 'd8-risk-tiers', w: W, h: H, svg: doc(W, H, s, {
    title: '21 risks, ordered by expected damage',
    subtitle: 'The risks most likely to end this project are not engineering risks' }) };
}

/* ── D9 — Data classification and where each class may travel ─────────────── */
function dataClasses() {
  const W = 1180, H = 500;
  let s = '';
  const dests = ['Application logs', 'Error tracking', 'Product analytics', 'Notification payload', 'Audit events', 'External AI'];
  const rows = [
    { t: 'Identifying', eg: 'name · phone · national id · address', allow: [0, 0, 0, 0, 0, 0], tone: C.dangerLine },
    { t: 'Clinical', eg: 'weights · labs · symptoms · notes', allow: [0, 0, 0, 0, 0, 2], tone: C.dangerLine },
    { t: 'Operational', eg: 'actor id · resource id · action · time', allow: [1, 1, 2, 0, 1, 0], tone: C.mid },
    { t: 'Telemetry', eg: 'latency · error rate · counts', allow: [1, 1, 1, 0, 0, 0], tone: C.goodLine },
  ];
  const X0 = 300, CW = 138;
  dests.forEach((d, i) => {
    const lines = d.split(' ');
    s += block(X0 + i * CW + CW / 2, 104 - (lines.length - 1) * 7, lines, { size: 10, weight: 600, color: C.light, lh: 13 });
  });
  rows.forEach((r, ri) => {
    const y = 128 + ri * 76;
    s += `<rect x="40" y="${y}" width="250" height="64" rx="5" fill="${C.wash}" stroke="${r.tone}" stroke-width="1.6"/>`;
    s += text(56, y + 26, r.t, { size: 12.5, weight: 700, color: r.tone, anchor: 'start' });
    s += text(56, y + 46, r.eg, { size: 9.5, color: C.muted, anchor: 'start' });
    r.allow.forEach((a, ci) => {
      const x = X0 + ci * CW;
      const fill = a === 1 ? C.goodFill : a === 2 ? C.warnFill : C.dangerFill;
      const stroke = a === 1 ? C.goodLine : a === 2 ? C.warnLine : C.dangerLine;
      const mark = a === 1 ? 'allowed' : a === 2 ? 'only by design' : 'never';
      s += `<rect x="${x + 6}" y="${y}" width="${CW - 12}" height="64" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
      s += text(x + CW / 2, y + 30, a === 1 ? '✓' : a === 2 ? '!' : '✕', { size: 17, weight: 700, color: stroke });
      s += text(x + CW / 2, y + 48, mark, { size: 8.5, color: stroke });
    });
  });
  const n = note(40, 440, 1100, [
    'Enforced centrally through one logger redaction list, not by discipline at each call site. A hosted log platform configured to capture raw request bodies',
    'would reintroduce exactly what redaction removes — so verify what the destination captures, not only what the application emits.',
  ]);
  s += n.svg;
  return { name: 'd9-data-classification', w: W, h: H, svg: doc(W, H, s, {
    title: 'Data classification — and where each class may travel',
    subtitle: 'Applied to logging, analytics, error reporting, notification payloads and exports' }) };
}

/* ── D10 — MVP scope after the critique ───────────────────────────────────── */
function mvp() {
  const W = 1180, H = 560;
  let s = '';
  const cols = [
    { x: 40,  t: 'In MVP', tone: 'good', items: ['RBAC + policy layer', 'Audit logging', 'Patient record + history', 'Surgery record', 'Weight + BMI, attributed', 'Appointments', 'Follow-up queue', 'Tasks from pathway stages', 'Supplement reminders', 'Push notifications', 'Doctor dashboard', 'Patient timeline', 'Arabic + English, RTL', 'Tested restore'] },
    { x: 325, t: 'Narrowed', tone: 'warn', items: ['Alerts → 3–5 approved rules only, not a general engine', 'Nutrition → stage content + checklists, not meal logging', 'Reminders → push only, channel-agnostic interface', 'Documents → attach a PDF, not a full module'] },
    { x: 610, t: 'Added — missing from the brief', tone: 'danger', items: ['Patient enrolment / invitation flow', 'Clinic-side entry for all patient data', 'Account deletion', 'Consent · disclaimer · privacy', 'Staff accounts + recovery', '“How to reach the clinic” screen'] },
    { x: 895, t: 'Deferred', tone: 'ghost', items: ['Meal logging + food database', 'General alert rule engine', 'Labs module', 'Analytics / reporting', 'Messaging', 'Dynamic questionnaires', 'Device integrations', 'AI features', 'Multi-clinic operations'] },
  ];
  cols.forEach((c) => {
    s += box(c.x, 86, 245, 44, { title: c.t, tone: c.tone, titleSize: 13 });
    let y = 142;
    c.items.forEach((it) => {
      const words = it.split(' '); const lines = []; let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length <= 33) cur = (cur + ' ' + w).trim(); else { lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      const h = 8 + lines.length * 14;
      s += `<rect x="${c.x}" y="${y}" width="245" height="${h}" rx="3.5" fill="#FFFFFF" stroke="${C.rule}"/>`;
      s += block(c.x + 122, y + 17, lines, { size: 10.3, color: c.tone === 'ghost' ? C.muted : C.slate, lh: 14 });
      y += h + 5;
    });
  });
  s += text(40, H - 26, 'Verdict: the right instincts, roughly 40% too large, and missing five things whose absence would prevent launch.',
    { size: 12, weight: 600, color: C.ink, anchor: 'start' });
  return { name: 'd10-mvp-scope', w: W, h: H, svg: doc(W, H, s, {
    title: 'MVP scope after the critique',
    subtitle: 'Four columns: kept, narrowed, added because it was missing, and deferred' }) };
}

module.exports = { journey, roadmap, capability, risks, dataClasses, mvp };
