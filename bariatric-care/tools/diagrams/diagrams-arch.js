'use strict';
const { C, text, block, box, zone, arrow, elbow, note, legend, doc } = require('./svg.js');

/* ── D11 — The production topology, with exposure marked ──────────────────── */
function topology() {
  const W = 1180, H = 760;
  let s = '';

  // Clients
  s += box(300, 78, 250, 54, { title: 'Patient app', lines: 'Expo · iOS + Android', tone: 'plain', titleSize: 12 });
  s += box(600, 78, 250, 54, { title: 'Dashboard', lines: 'Vite + React static bundle', tone: 'plain', titleSize: 12 });
  s += arrow(425, 132, 425, 168);
  s += arrow(725, 132, 725, 168);

  // PUBLIC
  s += zone(40, 160, 1100, 190, 'public — reachable from the internet', { stroke: C.mid, fill: '#F9FCFD' });
  s += box(70, 180, 1040, 56, { tag: 'Cloudflare', title: 'DNS · TLS · CDN · WAF · DDoS · rate limiting · Turnstile · bot protection', tone: 'strong', titleSize: 12 });
  s += arrow(590, 236, 590, 264, { label: 'secret header', labelColor: C.dangerLine });

  s += box(300, 268, 580, 64, { title: 'Fastify API  —  one origin', lines: 'serves /api/* and the dashboard bundle · Railway container, EU', tone: 'good' });

  // PRIVATE + INTERNAL
  s += zone(40, 372, 700, 150, 'private — no public endpoint', { stroke: C.goodLine, fill: '#F7FBF9' });
  s += box(70, 402, 300, 62, { title: 'PostgreSQL', lines: 'managed · pgBackRest PITR ~4 weeks', tone: 'plain', titleSize: 12 });
  s += box(400, 402, 310, 62, { title: 'Object storage', lines: 'private bucket · no presigned URLs', tone: 'plain', titleSize: 12 });

  s += zone(770, 372, 370, 150, 'internal only — no inbound listener', { stroke: C.light, fill: '#F9FAFC' });
  s += box(800, 402, 310, 62, { title: 'Worker', lines: 'scheduler + outbox · same image, ROLE=worker', tone: 'plain', titleSize: 12 });

  s += elbow(430, 332, 220, 398, { vfirst: true });
  s += elbow(700, 332, 555, 398, { vfirst: true });
  // Label on the horizontal run, above the zone border — on the vertical run it
  // sat across the zone's own caption.
  s += elbow(880, 300, 1080, 398, { vfirst: false, label: 'shares the policy layer', lyAbs: 292, lxAbs: 985 });
  s += arrow(800, 445, 715, 445, { dash: '4 3' });

  // EGRESS
  s += zone(40, 546, 1100, 128, 'egress only — we call them, they never call us', { stroke: C.muted, dash: '4 4' });
  const out = [
    { x: 70,  t: 'Push', sub: 'APNs · FCM' },
    { x: 280, t: 'SMS / WhatsApp', sub: 'channel TBD' },
    { x: 490, t: 'Email', sub: '' },
    { x: 700, t: 'Off-provider backup', sub: 'encrypted · Object Lock' },
    { x: 930, t: 'Sentry', sub: 'PII disabled' },
  ];
  out.forEach((o) => { s += box(o.x, 580, 190, 62, { title: o.t, lines: o.sub, tone: 'ghost', titleSize: 11.5 }); });
  s += arrow(955, 464, 955, 576, { dash: '4 3' });
  s += text(968, 530, 'provider keys live here, not in the API', { size: 9.5, color: C.muted, anchor: 'start' });

  const n = note(40, 692, 1100, [
    'No inbound provider webhooks. The origin is reachable only through Cloudflare: a secret header is compared in the first hook, before routing, auth or logging, and a mismatch returns a bare 404.',
    'That is bypass prevention, not authentication — an edge assertion may never produce an Actor, a permission or a clinic_id.',
  ], { fill: C.dangerFill, stroke: C.dangerLine, color: C.dangerLine });
  s += n.svg;

  return { name: 'd11-topology', w: W, h: H, svg: doc(W, H, s, {
    title: 'Recommended production topology',
    subtitle: 'Cloudflare edge · Railway EU · one public origin · everything else private' }) };
}

/* ── D12 — The gateway: what passes through it, and what may not go round ─── */
function gateway() {
  const W = 1180, H = 818;
  let s = '';

  // The gate itself.
  s += zone(370, 92, 400, 396, 'the gateway', { stroke: C.ink, fill: '#F4F8FB' });
  const stack = [
    { y: 124, t: 'Actor resolution', sub: 'who is this, in which clinic' },
    { y: 214, t: 'Policy', sub: 'packages/core — pure functions' },
    { y: 304, t: 'Services', sub: 'use case · transaction' },
    { y: 394, t: 'Repositories', sub: 'scope is a required argument' },
  ];
  stack.forEach((l, i) => {
    s += box(396, l.y, 348, 66, { title: l.t, lines: l.sub, tone: i === 1 ? 'strong' : 'plain', titleSize: 12.5 });
    if (i < 3) s += arrow(570, l.y + 66, 570, stack[i + 1].y - 3);
  });

  // Allowed callers.
  s += text(40, 84, 'Allowed', { size: 10, weight: 700, color: C.goodLine, anchor: 'start', upper: true, spacing: '0.09em' });
  const allowed = [
    'Patient app', 'Dashboard', 'Worker (system Actor)', 'Exports', 'Documents', 'Future AI context builder',
  ];
  allowed.forEach((a, i) => {
    const y = 100 + i * 62;
    s += box(40, y, 300, 48, { title: a, tone: 'good', titleSize: 11.5 });
    s += arrow(340, y + 24, 392, 157 + Math.min(i, 3) * 6, { color: C.goodLine, w: 1.4 });
  });

  // Data sits BELOW the gateway. On the right it overlapped the forbidden
  // column, and the gateway's own arrows then pointed into the list of paths it
  // exists to prevent — the exact opposite of the diagram's meaning.
  s += box(396, 506, 168, 56, { title: 'PostgreSQL', tone: 'plain', titleSize: 12 });
  s += box(576, 506, 168, 56, { title: 'Object storage', tone: 'plain', titleSize: 12 });
  s += elbow(500, 460, 480, 502, { vfirst: true, w: 1.5 });
  s += elbow(640, 460, 660, 502, { vfirst: true, w: 1.5 });

  // Forbidden — routed round the outside, each stopped.
  s += text(800, 84, 'Forbidden — every one of these is a violation', { size: 10, weight: 700, color: C.dangerLine, anchor: 'start', upper: true, spacing: '0.07em' });
  const bad = [
    'Mobile → Supabase / any DB SDK',
    'Dashboard → PostgreSQL',
    'AI → DB with service-role key',
    'Analytics → unrestricted prod DB',
    'Client → storage bucket directly',
    'Admin script → prod (as routine)',
    'CSV export → custom unscoped SQL',
    'Provider MCP / agent → prod account',
  ];
  bad.forEach((b, i) => {
    const y = 100 + i * 46;
    s += `<rect x="800" y="${y}" width="340" height="36" rx="4" fill="${C.dangerFill}" stroke="${C.dangerLine}" stroke-width="1.3" stroke-dasharray="5 4"/>`;
    s += text(822, y + 23, b, { size: 10.5, color: C.dangerLine, anchor: 'start' });
    s += text(1124, y + 24, '✕', { size: 14, weight: 700, color: C.dangerLine, anchor: 'end' });
  });
  // The arc each forbidden path would take straight to the data, and the wall it hits.
  s += `<path d="M 1130 486 C 1054 584, 900 592, 756 554" fill="none" stroke="${C.dangerLine}" stroke-width="2.2" stroke-dasharray="7 5"/>`;
  s += `<circle cx="936" cy="568" r="18" fill="#FFFFFF" stroke="${C.dangerLine}" stroke-width="2.4"/>`;
  s += text(936, 574, '✕', { size: 17, weight: 700, color: C.dangerLine });
  s += text(936, 602, 'no path round the policy layer', { size: 11, weight: 600, color: C.dangerLine });

  // Exceptions.
  s += zone(40, 628, 1100, 108, 'the only four exceptions — named exhaustively so no fifth can be smuggled in', { stroke: C.warnLine, fill: C.warnFill });
  const exc = [
    ['Schema migrations', 'migrator role · CI only · no PHI reads'],
    ['Backup / restore', 'encrypted · off-provider · audited'],
    ['Break-glass', 'time-boxed · typed reason · alert'],
    ['Provider support', 'contractual, not architectural'],
  ];
  exc.forEach((e, i) => {
    const x = 62 + i * 270;
    s += `<rect x="${x}" y="${658}" width="252" height="58" rx="5" fill="#FFFFFF" stroke="${C.warnLine}" stroke-width="1.2"/>`;
    s += text(x + 126, 682, e[0], { size: 11.5, weight: 600, color: C.warnLine });
    s += text(x + 126, 700, e[1], { size: 9.5, color: C.muted });
  });

  s += text(40, 768, 'The rule centralises AUTHORIZATION, not exposure: any number of front doors, all opening into one rulebook.',
    { size: 12, weight: 600, color: C.ink, anchor: 'start' });
  s += text(40, 790, '"Bypassing the API" is permitted — the worker does it. "Bypassing authorization" is not. Conflating the two is how this rule gets misread.',
    { size: 10.5, color: C.muted, anchor: 'start' });

  return { name: 'd12-gateway-boundary', w: W, h: H, svg: doc(W, H, s, {
    title: 'ADR-0004 — one public clinical-data gateway',
    subtitle: 'Every allowed path, every forbidden one, and the four exceptions' }) };
}

module.exports = { topology, gateway };
