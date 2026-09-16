'use strict';
const { C, text, box, zone, arrow, elbow, note, legend, doc } = require('./svg.js');

/* ── D1 — Layering, and the fact that there is no privileged path ─────────── */
function layering() {
  const W = 1020, H = 640;
  let s = '';
  const cx = 300, cw = 400;
  const layers = [
    { y: 95,  tag: 'HTTP boundary', title: 'Route', lines: 'Zod validation · authenticate · request context', tone: 'plain' },
    { y: 190, tag: 'Use case',      title: 'Service', lines: 'Transaction boundary · appends domain events', tone: 'plain' },
    { y: 285, tag: 'Pure, no I/O',  title: 'Domain  —  packages/core', lines: 'policy · pathway resolution · rule evaluation · formulas', tone: 'strong' },
    { y: 380, tag: 'Only SQL here', title: 'Repository', lines: 'Parameterised SQL · scope is a required argument', tone: 'plain' },
  ];
  layers.forEach((l) => { s += box(cx, l.y, cw, 76, l); });
  s += box(cx + 70, 480, cw - 140, 56, { title: 'PostgreSQL', tone: 'strong', lines: 'clinic_id on every tenant-scoped row' });

  for (let i = 0; i < 3; i++) s += arrow(cx + cw / 2, layers[i].y + 72, cx + cw / 2, layers[i + 1].y - 4);
  s += arrow(cx + cw / 2, 452, cx + cw / 2, 476);

  // Callers. Only the first enters at the route; the rest enter at the service —
  // and all four cross the same policy layer. That is the whole point.
  const callers = [
    { y: 95,  t: 'HTTP request', sub: 'app · dashboard' },
    { y: 165, t: 'Worker job', sub: 'scheduler · outbox' },
    { y: 235, t: 'Export', sub: 'CSV · reports' },
    { y: 305, t: 'AI (Phase 3)', sub: 'context builder' },
  ];
  s += zone(30, 78, 210, 300, 'callers', { dash: '4 4' });
  callers.forEach((c, i) => {
    s += box(48, c.y, 174, 52, { title: c.t, lines: c.sub, tone: i === 3 ? 'ghost' : 'plain', titleSize: 12 });
    // Distinct entry points on the Service edge; converging them on one pixel
    // read as a single arrow and hid that these are four separate callers.
    const target = i === 0 ? 131 : 196 + (i - 1) * 22;
    s += arrow(222, c.y + 26, cx - 5, target, { dash: i === 3 ? '5 4' : null });
  });

  const rules = [
    { y: 95,  t: 'No business logic. No role conditionals. A route calls a policy function; it never decides.' },
    { y: 190, t: 'Cross-module calls go service → service. A service never reaches into another module’s repository.' },
    { y: 285, t: 'One authorization implementation. Pure functions mean the whole role × resource × operation matrix runs as millisecond unit tests on every commit.' },
    { y: 380, t: 'List queries push scope into the WHERE clause. Fetch-then-filter leaks row counts through pagination and returns short pages.' },
  ];
  rules.forEach((r) => {
    const n = note(740, r.y - 6, 250, r.t);
    s += n.svg;
    s += arrow(736, r.y + 30, 704, r.y + 30, { w: 1.2, color: C.rule });
  });

  s += text(30, H - 26, 'Every caller crosses the same policy layer. The day a second, "trusted" path exists, the security model is gone.',
    { size: 11, color: C.ink, anchor: 'start', weight: 600 });
  return { name: 'd1-layering', w: W, h: H, svg: doc(W, H, s, {
    title: 'Request layering — and why there is no privileged path',
    subtitle: 'ADR-0001 modular monolith · ADR-0003 exactly one authorization implementation' }) };
}

/* ── D2 — Transactional outbox ────────────────────────────────────────────── */
function outbox() {
  const W = 1020, H = 470;
  let s = '';
  s += zone(40, 80, 400, 250, 'one database transaction', { stroke: C.ink, fill: '#F7FAFC', dash: '7 5' });
  s += box(70, 120, 340, 58, { title: 'Write the state change', lines: 'e.g. INSERT measurement', tone: 'plain' });
  s += text(240, 200, 'BEGIN … COMMIT', { size: 11, mono: true, color: C.ink, weight: 600 });
  s += box(70, 222, 340, 58, { title: 'Append the domain event', lines: 'INSERT INTO domain_events', tone: 'strong' });
  s += arrow(240, 178, 240, 218, { w: 1.4 });

  s += arrow(440, 205, 530, 205, { label: 'after commit' });
  s += box(530, 165, 190, 80, { tag: 'worker', title: 'Outbox relay', lines: 'drains, at-least-once, idempotent', tone: 'plain' });

  const consumers = [
    { y: 70,  t: 'Notifications' }, { y: 150, t: 'Alert evaluation' },
    { y: 230, t: 'Patient timeline' }, { y: 310, t: 'Analytics' },
  ];
  consumers.forEach((c) => {
    s += box(810, c.y, 175, 56, { title: c.t, tone: 'plain', titleSize: 12 });
    s += elbow(720, 205, 806, c.y + 28, { vfirst: false });
  });

  const n = note(40, 355, 700, [
    'The ordering is the entire decision: the event is written inside the same transaction as the change.',
    'An event can never describe a write that rolled back, and a committed write can never lose its event.',
    'Publishing after commit gives up the second. Publishing inline to a broker gives up the first.',
  ]);
  s += n.svg;
  return { name: 'd2-outbox', w: W, h: H, svg: doc(W, H, s, {
    title: 'Domain events through a transactional outbox',
    subtitle: 'One event vocabulary, one delivery mechanism, four consumers' }) };
}

/* ── D3 — Pathway engine and protocol version pinning ─────────────────────── */
function pathway() {
  const W = 1020, H = 620;
  let s = '';
  const inputs = [
    'patient', 'procedure', 'surgery_date', 'pinned protocol_version',
  ];
  inputs.forEach((t, i) => { s += box(40 + i * 240, 80, 210, 46, { title: t, tone: 'plain', titleSize: 11.5 }); });
  inputs.forEach((_, i) => s += arrow(145 + i * 240, 126, 145 + i * 240, 158));
  s += box(40, 162, 930, 50, { title: 'days_since_surgery', lines: 'computed from stored timestamps — never the client clock', tone: 'strong' });
  s += arrow(505, 212, 505, 244);
  s += box(305, 248, 400, 52, { title: 'Current stage', lines: 'resolved from the pinned protocol version', tone: 'strong' });

  const out = [
    { t: 'Nutrition tasks', x: 40 }, { t: 'Educational content', x: 278 },
    { t: 'Required check-ins', x: 516 }, { t: 'Rules in scope', x: 754 },
  ];
  out.forEach((o) => {
    s += box(o.x, 350, 216, 50, { title: o.t, tone: 'plain', titleSize: 12 });
    s += elbow(505, 300, o.x + 108, 346, { vfirst: true });
  });

  // Version pinning, the part that is invisible until it has already destroyed the dataset.
  s += zone(40, 430, 930, 120, 'why versions are pinned', { stroke: C.dangerLine, fill: C.dangerFill, dash: '6 5' });
  s += box(70, 462, 250, 62, { tag: 'enrolled January', title: 'Protocol v1', lines: 'stage 2 = days 8–21', tone: 'danger', titleSize: 12 });
  s += box(360, 462, 250, 62, { tag: 'enrolled March', title: 'Protocol v2', lines: 'stage 2 = days 8–28', tone: 'danger', titleSize: 12 });
  s += text(660, 487, 'Same stage name. Different meaning.', { size: 11.5, weight: 600, color: C.dangerLine, anchor: 'start' });
  s += text(660, 505, 'Without pinning, nothing breaks — the dataset', { size: 10.5, color: C.dangerLine, anchor: 'start' });
  s += text(660, 519, 'just quietly stops being interpretable.', { size: 10.5, color: C.dangerLine, anchor: 'start' });

  s += text(40, H - 24, 'The engine ships EMPTY. Every stage name, duration, task and instruction is [MEDICAL REVIEW REQUIRED].',
    { size: 11, weight: 600, color: C.ink, anchor: 'start' });
  return { name: 'd3-pathway-engine', w: W, h: H, svg: doc(W, H, s, {
    title: 'Pathway engine — resolution and protocol version pinning',
    subtitle: 'The system provides the engine; the Medical Reviewer provides the medicine' }) };
}

/* ── D4 — Alert engine and its audit record ───────────────────────────────── */
function alerts() {
  const W = 1020, H = 490;
  let s = '';
  s += box(40, 90, 200, 54, { title: 'Domain event', lines: 'symptom submitted, weight recorded', tone: 'plain', titleSize: 12 });
  s += box(40, 164, 200, 54, { title: 'Scheduled sweep', lines: 'overdue follow-up, missing data', tone: 'plain', titleSize: 12 });
  s += arrow(240, 117, 296, 146);
  s += arrow(240, 191, 296, 166);

  s += box(300, 126, 230, 58, { title: 'Rule evaluation', lines: 'pure · versioned · approved', tone: 'strong' });
  s += arrow(530, 155, 580, 155);
  s += box(584, 118, 210, 74, { title: 'Alert created', lines: 'severity · queue · provenance', tone: 'warn' });
  s += arrow(794, 155, 844, 155);
  s += box(848, 126, 140, 58, { title: 'Human queue', lines: 'nurse / surgeon', tone: 'good', titleSize: 12 });

  s += arrow(918, 184, 918, 228, { color: C.goodLine });
  s += text(930, 212, 'a human decides', { size: 10, color: C.goodLine, anchor: 'start' });
  s += box(848, 232, 140, 50, { title: 'Acknowledge', tone: 'good', titleSize: 12 });
  s += arrow(918, 282, 918, 310, { color: C.goodLine });
  s += box(848, 314, 140, 50, { title: 'Action + close', tone: 'good', titleSize: 12 });

  s += zone(40, 250, 760, 130, 'every alert records', { stroke: C.mid });
  const fields = ['rule_id', 'rule_version', 'triggering data snapshot', 'triggered_at', 'severity', 'queue',
                  'acknowledged_by', 'acknowledged_at', 'action_taken', 'closed_at'];
  fields.forEach((f, i) => {
    const x = 62 + (i % 5) * 148, y = 286 + Math.floor(i / 5) * 42;
    s += `<rect x="${x}" y="${y}" width="138" height="30" rx="4" fill="#FFFFFF" stroke="${C.rule}"/>`;
    s += text(x + 69, y + 19, f, { size: 10, mono: true, color: C.ink });
  });

  const n = note(40, 400, 950, [
    'The rule decides ROUTING, never meaning. No alert text states or implies a diagnosis, and there is no "all clear" state anywhere in the product —',
    'absence of an alert is never surfaced as reassurance. Every rule ships with its test-case table; a rule without tests does not ship.',
  ], { fill: C.dangerFill, stroke: C.dangerLine, color: C.dangerLine });
  s += n.svg;
  return { name: 'd4-alert-engine', w: W, h: H, svg: doc(W, H, s, {
    title: 'Alert rule engine — routing, never diagnosis',
    subtitle: 'The highest-risk component in the product: it causes harm by working correctly' }) };
}

module.exports = { layering, outbox, pathway, alerts };
