'use strict';
const { C, text, block, box, zone, arrow, elbow, note, doc } = require('./svg.js');

/* ── D13 — The worker has no identity; jobs do ────────────────────────────── */
function workerActors() {
  const W = 1180, H = 660;
  let s = '';

  s += box(40, 82, 230, 74, { tag: 'internal only', title: 'Worker process', lines: 'connects as app_worker, NOT the API role', tone: 'plain', titleSize: 13 });
  s += text(155, 176, 'has no identity of its own', { size: 10.5, italics: true, color: C.muted });

  const COLS = [
    { x: 300, w: 190, t: 'Job' },
    { x: 496, w: 92,  t: 'Clinic' },
    { x: 594, w: 250, t: 'Reads' },
    { x: 850, w: 140, t: 'Writes' },
    { x: 996, w: 144, t: 'Cannot read' },
  ];
  COLS.forEach((c) => s += text(c.x + c.w / 2, 96, c.t, { size: 10, weight: 700, color: C.light, upper: true, spacing: '0.08em' }));

  const JOBS = [
    ['outbox-relay',            'domain_events', 'domain_events', 'any clinical table', 'good'],
    ['notification-dispatch',   'notifications · prefs · push_tokens', 'deliveries', 'any clinical table', 'good'],
    ['followup-sweep',          'appointments · patient status · pathway', 'alerts · events', 'notes · docs · labs', 'plain'],
    ['protocol-task-generation','pathway · protocol_versions · surgery', 'tasks', 'notes · docs · labs', 'plain'],
    ['alert-rule-evaluation',   'only what its approved rules declare', 'alerts · events', 'anything undeclared', 'plain'],
    ['backup-export',           'whole dataset — by definition', 'off-provider bucket', '—  ADR-0004 exception', 'warn'],
  ];
  JOBS.forEach((j, i) => {
    const y = 110 + i * 62;
    const tone = j[4] === 'good' ? { f: C.goodFill, st: C.goodLine } : j[4] === 'warn' ? { f: C.warnFill, st: C.warnLine } : { f: C.wash, st: C.mid };
    s += `<rect x="300" y="${y}" width="840" height="52" rx="5" fill="${tone.f}" stroke="${tone.st}" stroke-width="1.3"/>`;
    s += text(310, y + 31, j[0], { size: 11, mono: true, weight: 600, color: tone.st, anchor: 'start' });
    s += text(542, y + 31, 'one', { size: 10.5, weight: 700, color: C.ink });
    s += block(719, y + 26, j[1].length > 34 ? [j[1].slice(0, j[1].lastIndexOf(' ', 34)), j[1].slice(j[1].lastIndexOf(' ', 34) + 1)] : [j[1]], { size: 9.8, color: C.slate, lh: 12 });
    s += text(920, y + 31, j[2], { size: 9.8, color: C.slate });
    // Always danger-coloured: under a column headed CANNOT READ, green text reads as permission.
    s += text(1068, y + 31, j[3], { size: 9.5, color: C.dangerLine });
    s += arrow(272, 119 + Math.min(i, 2) * 8, 296, y + 26, { w: 1.1, color: C.rule });
  });

  s += zone(40, 496, 1100, 108, 'four rules that make this enforceable rather than aspirational', { stroke: C.ink, fill: C.wash });
  const rules = [
    ['No wildcard clinic', 'a job covering every clinic is scheduled once PER clinic'],
    ['Per-job permissions', 'not one worker identity'],
    ['Separate DB role', 'app_worker, granted only what its jobs need'],
    ['Boot assertion', 'worker exits if any job lacks a JobActor'],
  ];
  rules.forEach((r, i) => {
    const x = 62 + i * 270;
    s += `<rect x="${x}" y="526" width="252" height="58" rx="5" fill="#FFFFFF" stroke="${C.mid}" stroke-width="1.2"/>`;
    s += text(x + 126, 549, r[0], { size: 11.5, weight: 600, color: C.ink });
    s += block(x + 126, 566, r[1].length > 40 ? [r[1].slice(0, r[1].lastIndexOf(' ', 40)), r[1].slice(r[1].lastIndexOf(' ', 40) + 1)] : [r[1]], { size: 9.3, color: C.muted, lh: 11 });
  });

  s += text(40, 632, 'The constraint is the TABLE SET and the CLINIC — not the patient set. A follow-up sweep that cannot see every patient cannot find the overdue ones.',
    { size: 11, weight: 600, color: C.ink, anchor: 'start' });
  return { name: 'd13-worker-job-actors', w: W, h: H, svg: doc(W, H, s, {
    title: 'The worker has no identity. Jobs do.',
    subtitle: 'Per-job actors with a concrete clinic and a declared table scope — never a shared system identity' }) };
}

/* ── D14 — Access tiers, the sealed set, and the drill ────────────────────── */
function accessTiers() {
  const W = 1180, H = 660;
  let s = '';

  const tiers = [
    { y: 88,  n: 'Tier 0', t: 'Application', who: 'Clinic staff · patients', auth: 'Password + TOTP MFA (all staff)', db: 'No database access', tone: 'good' },
    { y: 198, n: 'Tier 1', t: 'Operator — routine', who: 'Ali', auth: 'Hardware security key', db: 'None routinely · app_readonly via in-project command, audited', tone: 'warn' },
    { y: 308, n: 'Tier 2', t: 'Break-glass — emergency', who: 'Ali + one NAMED second operator', auth: 'Hardware key + sealed recovery material', db: 'Yes, under the 7-step procedure', tone: 'danger' },
  ];
  tiers.forEach((t) => {
    const tone = t.tone === 'good' ? { f: C.goodFill, st: C.goodLine } : t.tone === 'warn' ? { f: C.warnFill, st: C.warnLine } : { f: C.dangerFill, st: C.dangerLine };
    s += `<rect x="40" y="${t.y}" width="700" height="94" rx="7" fill="${tone.f}" stroke="${tone.st}" stroke-width="1.7"/>`;
    s += text(62, t.y + 26, t.n, { size: 10, weight: 700, color: tone.st, anchor: 'start', upper: true, spacing: '0.09em' });
    s += text(62, t.y + 48, t.t, { size: 14, weight: 700, color: tone.st, anchor: 'start' });
    s += text(62, t.y + 70, t.who, { size: 10.5, color: C.slate, anchor: 'start' });
    s += text(722, t.y + 40, t.auth, { size: 10.5, weight: 600, color: tone.st, anchor: 'end' });
    s += text(722, t.y + 62, t.db, { size: 9.8, color: C.muted, anchor: 'end' });
  });
  s += text(40, 424, 'SMS-based MFA is forbidden at every tier — in this product the phone number is also the patient identifier.',
    { size: 10.5, weight: 600, color: C.dangerLine, anchor: 'start' });

  // The sealed set.
  s += zone(770, 82, 370, 320, 'the sealed set — two copies, two people, two locations', { stroke: C.dangerLine, fill: C.dangerFill });
  const sealed = ['Provider account + MFA recovery', 'Cloudflare + domain registrar', 'DB superuser / migrator', 'Backup decryption key (age)', 'Secret manager master', 'GitHub org owner recovery', 'Apple / Google account recovery'];
  sealed.forEach((x, i) => {
    const y = 110 + i * 38;
    const key = i === 3;
    s += `<rect x="790" y="${y}" width="330" height="30" rx="4" fill="#FFFFFF" stroke="${key ? C.dangerLine : C.rule}" stroke-width="${key ? 1.8 : 1}"/>`;
    s += text(806, y + 20, x, { size: 10, weight: key ? 700 : 400, color: key ? C.dangerLine : C.slate, anchor: 'start' });
  });
  s += text(790, 392, 'The backup key is NEVER stored with the provider credentials.', { size: 9.8, weight: 700, color: C.dangerLine, anchor: 'start' });

  // The drill.
  s += zone(40, 452, 1100, 150, 'the quarterly drill — performed by the SECOND operator, unaided', { stroke: C.ink, fill: C.wash });
  const steps = ['Retrieve sealed material', 'Restore DB to scratch', 'Verify data intact', 'Reseal', 'Rotate what was used'];
  steps.forEach((st, i) => {
    const x = 66 + i * 214;
    s += `<rect x="${x}" y="486" width="190" height="52" rx="5" fill="#FFFFFF" stroke="${C.mid}" stroke-width="1.2"/>`;
    s += block(x + 95, 510, st.length > 22 ? [st.slice(0, st.lastIndexOf(' ', 22)), st.slice(st.lastIndexOf(' ', 22) + 1)] : [st], { size: 10.3, color: C.ink, lh: 13 });
    if (i < 4) s += arrow(x + 190, 512, x + 212, 512, { w: 1.3 });
  });
  s += text(66, 566, 'It FAILS if they need to ask Ali anything. That condition is the whole point: the scenario this control exists for is the one where Ali cannot be asked.',
    { size: 11, weight: 600, color: C.ink, anchor: 'start' });
  s += text(66, 586, 'A sealed envelope that has never been opened is a file, not a control — the same failure as an untested backup.',
    { size: 10, color: C.muted, anchor: 'start' });

  s += text(40, 634, 'super_admin is removed from v1. Routine administration is clinic_admin; everything else is break-glass, not a standing account.',
    { size: 11, weight: 600, color: C.dangerLine, anchor: 'start' });
  return { name: 'd14-access-tiers', w: W, h: H, svg: doc(W, H, s, {
    title: 'Operator access tiers and break-glass',
    subtitle: 'Turning risk R4 — Ali as a single point of failure — from a named risk into a design' }) };
}

module.exports = { workerActors, accessTiers };
