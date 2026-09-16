'use strict';
const { C, text, block, box, zone, arrow, elbow, note, doc } = require('./svg.js');

/* ── D15 — Identity separated, and episodes instead of one assumed operation ─ */
function patientModel() {
  const W = 1180, H = 720;
  let s = '';

  /* Identity row. */
  s += zone(40, 76, 1100, 132, 'identity — an account is optional; a record is not', { stroke: C.mid, fill: '#F9FCFD' });
  s += box(70, 104, 250, 82, { tag: 'may not exist', title: 'user_account', lines: 'phone · credential · session', tone: 'plain', titleSize: 13 });
  s += box(455, 104, 270, 82, { tag: 'links them', title: 'record_access', lines: 'relation: self | caregiver · consent · revocable', tone: 'plain', titleSize: 13 });
  s += box(860, 104, 250, 82, { tag: 'always exists', title: 'patient_record', lines: 'created by the clinic', tone: 'strong', titleSize: 13 });
  s += arrow(320, 145, 451, 145, { both: true });
  s += arrow(725, 145, 856, 145, { both: true });
  s += text(590, 200, 'many-to-many: a caregiver reads one record; a shared handset holds two accounts', { size: 9.8, color: C.muted });

  /* Clinical row. */
  s += zone(40, 232, 1100, 150, 'clinical — the unit is an episode, not the patient', { stroke: C.ink, fill: C.wash });
  const chain = [
    { x: 70,  w: 230, t: 'patient_record', sub: 'one per person', tone: 'strong' },
    { x: 340, w: 230, t: 'care_episode', sub: 'type · opened · closed?', tone: 'good' },
    { x: 610, w: 230, t: 'procedure_instance', sub: 'performed_at · revision_of?', tone: 'good' },
    { x: 880, w: 230, t: 'pathway_assignment', sub: 'pinned protocol_version', tone: 'plain' },
  ];
  chain.forEach((c, i) => {
    s += box(c.x, 266, c.w, 82, { title: c.t, lines: c.sub, tone: c.tone, titleSize: 12.5 });
    if (i < 3) s += arrow(c.x + c.w, 307, chain[i + 1].x - 4, 307, { label: i === 0 ? '1 : many' : i === 1 ? '1 : many' : '', labelBg: false, ly: -10 });
  });

  /* The worked case the old model could not express. */
  // Subtitle as the zone's right-aligned note: beneath the zone label it sat 12px
  // under it and read as crowded.
  s += zone(40, 410, 1100, 218, 'the case the old model could not represent',
            { stroke: C.dangerLine, fill: C.dangerFill, color: C.dangerLine,
              note: 'one patient  ·  one episode  ·  two procedures' });

  s += `<line x1="150" y1="500" x2="1080" y2="500" stroke="${C.rule}" stroke-width="2.5"/>`;
  const evts = [
    { x: 210, t: 'Sleeve gastrectomy', d: 'Jan 2026', tone: 'good' },
    { x: 620, t: 'Converted to bypass', d: 'Nov 2026', tone: 'warn' },
  ];
  evts.forEach((e) => {
    s += `<circle cx="${e.x}" cy="500" r="7" fill="#FFFFFF" stroke="${e.tone === 'good' ? C.goodLine : C.warnLine}" stroke-width="2.5"/>`;
    s += box(e.x - 110, 446, 220, 44, { title: e.t, tone: e.tone, titleSize: 11.5 });
    s += text(e.x, 528, e.d, { size: 10, color: C.muted });
  });
  s += text(415, 562, 'pathway position #1 — days since procedure 1', { size: 10, color: C.goodLine });
  s += `<line x1="217" y1="546" x2="613" y2="546" stroke="${C.goodLine}" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += text(850, 562, 'pathway position #2 — days since procedure 2', { size: 10, color: C.warnLine });
  s += `<line x1="627" y1="546" x2="1078" y2="546" stroke="${C.warnLine}" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += text(66, 598, 'Weight is one continuous series for the person. The %TWL BASELINE resets at each procedure —', { size: 10.5, weight: 600, color: C.dangerLine, anchor: 'start' });
  s += text(66, 616, 'computing it across a revision without resetting produces a clinically wrong number that looks right.  [MEDICAL REVIEW REQUIRED]', { size: 10.5, color: C.dangerLine, anchor: 'start' });

  s += text(40, 664, 'Old key: patient + procedure + surgery_date + protocol_version  —  cannot express a second operation.', { size: 11, color: C.muted, anchor: 'start' });
  s += text(40, 686, 'New key: episode + procedure_instance + protocol_version. General surgery becomes an episode type, so it is additive rather than a redesign.',
    { size: 11, weight: 600, color: C.ink, anchor: 'start' });
  return { name: 'd15-patient-episode-model', w: W, h: H, svg: doc(W, H, s, {
    title: 'The corrected patient model',
    subtitle: 'Account separated from record · care episodes instead of one assumed operation' }) };
}

module.exports = { patientModel };
