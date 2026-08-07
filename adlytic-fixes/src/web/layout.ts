// ════════════════════════════════════════════════════════════════════════
//  src/web/layout.ts
//
//  Shared layout, CSS design system, and HTML helpers for all Adlytic
//  web pages. Every page imports layout() to get the full shell.
// ════════════════════════════════════════════════════════════════════════

import { logoSvg } from './pages/authShared';

export const SHARED_CSS = `
/* ── Self-hosted fonts ───────────────────────────────────────────────
   Tajawal: body/data workhorse — clean at small sizes, dense tables.
   El Messiri: display face — warmth + character, used with restraint
   for page titles, hero numbers, and the AI's own voice. Both served
   from /fonts (see server.ts) so font-src 'self' in the CSP is enough —
   no third-party stylesheet, no render-blocking cross-origin request. ── */
@font-face { font-family: 'Tajawal'; font-weight: 400; font-style: normal; font-display: swap; src: url('/fonts/tajawal-arabic-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Tajawal'; font-weight: 500; font-style: normal; font-display: swap; src: url('/fonts/tajawal-arabic-500-normal.woff2') format('woff2'); }
@font-face { font-family: 'Tajawal'; font-weight: 700; font-style: normal; font-display: swap; src: url('/fonts/tajawal-arabic-700-normal.woff2') format('woff2'); }
@font-face { font-family: 'Tajawal'; font-weight: 800; font-style: normal; font-display: swap; src: url('/fonts/tajawal-arabic-800-normal.woff2') format('woff2'); }
@font-face { font-family: 'Tajawal'; font-weight: 900; font-style: normal; font-display: swap; src: url('/fonts/tajawal-arabic-900-normal.woff2') format('woff2'); }
@font-face { font-family: 'Tajawal'; font-weight: 400; font-style: normal; font-display: swap; src: url('/fonts/tajawal-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'Tajawal'; font-weight: 500; font-style: normal; font-display: swap; src: url('/fonts/tajawal-latin-500-normal.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'Tajawal'; font-weight: 700; font-style: normal; font-display: swap; src: url('/fonts/tajawal-latin-700-normal.woff2') format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'El Messiri'; font-weight: 500; font-style: normal; font-display: swap; src: url('/fonts/el-messiri-arabic-500-normal.woff2') format('woff2'); }
@font-face { font-family: 'El Messiri'; font-weight: 600; font-style: normal; font-display: swap; src: url('/fonts/el-messiri-arabic-600-normal.woff2') format('woff2'); }
@font-face { font-family: 'El Messiri'; font-weight: 700; font-style: normal; font-display: swap; src: url('/fonts/el-messiri-arabic-700-normal.woff2') format('woff2'); }

:root {
  /* ── Neutrals — warm dark "ledger" surface, not cold near-black ──── */
  --bg: #100E0D;
  --surface: #1A1613;
  --surface-2: #221D19;
  --surface-hover: #2A2420;
  --border: #322B25;
  --border-2: #3D352D;
  --text: #F3EFE7;
  --text-2: #B8AC9C;
  --text-3: #746A5C;

  /* ── Brand / AI accent — warm gold, reserved for the AI's voice and
     primary actions. This is the one color the eye should learn to
     associate with "the assistant is telling me something." ──────── */
  --accent: #D9A759;
  --accent-2: #E6BD7A;
  --accent-3: #F0D4A3;
  --accent-dim: rgba(217,167,89,0.14);
  --accent-glow: rgba(217,167,89,0.35);

  /* ── Status — validated for dark-surface contrast + CVD separation
     via dataviz skill's validate_palette.js against this --bg. Kept
     visually distinct from --accent so a status color never doubles
     as an AI marker. ───────────────────────────────────────────────── */
  --success: #34A871;
  --success-dim: rgba(52,168,113,0.14);
  --warning: #C77A1F;
  --warning-dim: rgba(199,122,31,0.14);
  --error: #E2604F;
  --error-dim: rgba(226,96,79,0.14);
  --critical: #C7382A;
  --critical-dim: rgba(199,56,42,0.14);

  --grad-accent: linear-gradient(135deg, #D9A759 0%, #C68A3D 100%);
  --grad-accent-hover: linear-gradient(135deg, #E6BD7A 0%, #D9A759 100%);
  --grad-success: linear-gradient(135deg, #34A871 0%, #2B8C6A 100%);
  --grad-surface: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%);

  --font-body: 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-display: 'El Messiri', 'Tajawal', -apple-system, sans-serif;

  --sidebar-w: 236px;
  --topbar-h: 56px;
  --radius: 8px;
  --radius-sm: 5px;
  --radius-lg: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.25);
  --shadow-xl: 0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3);
  --shadow-accent: 0 4px 14px rgba(217,167,89,0.32);
  --shadow-glow: 0 0 0 1px rgba(217,167,89,0.15), 0 8px 24px rgba(217,167,89,0.18);
  --shadow-inner-glow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,255,255,0.03);
  --transition: 150ms cubic-bezier(0.4,0,0.2,1);
  --transition-slow: 260ms cubic-bezier(0.34,1.56,0.64,1);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; -webkit-font-smoothing: antialiased; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  line-height: 1.5;
  min-height: 100vh;
}
h1, h2, h3, .page-title, .card-title-lg { font-family: var(--font-display); }
[dir="auto"] { letter-spacing: normal; line-height: 1.6; }
a { color: var(--accent-2); text-decoration: none; }
a:hover { color: var(--text); }
button { cursor: pointer; font-family: inherit; }
input, select, textarea { font-family: inherit; }

/* ── App shell ───────────────────────────────────────────────────── */
.app-shell { display: flex; min-height: 100vh; }

/* ── Sidebar ─────────────────────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  background:
    linear-gradient(180deg, rgba(217,167,89,0.04) 0%, transparent 38%),
    var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 100;
  overflow-y: auto;
  overflow-x: hidden;
}
.sidebar-logo {
  padding: 16px 14px 14px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 11px;
  text-decoration: none;
  color: inherit;
  transition: background var(--transition);
  position: relative;
}
.sidebar-logo::after {
  content: "";
  position: absolute; inset: auto 14px 0 14px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(217,167,89,0.35), transparent);
  opacity: 0.6;
}
.sidebar-logo:hover { background: rgba(255,255,255,0.02); }
.sidebar-logo-mark {
  width: 38px; height: 38px;
  flex-shrink: 0;
  filter: drop-shadow(0 4px 14px rgba(217,167,89,0.22));
  transition: transform var(--transition-slow);
}
.sidebar-logo:hover .sidebar-logo-mark { transform: scale(1.04); }
.sidebar-logo-copy {
  display: flex; flex-direction: column; gap: 1px; min-width: 0;
}
.sidebar-logo-text {
  font-family: var(--font-display); font-weight: 700; font-size: 17px;
  color: var(--text); letter-spacing: -0.4px; line-height: 1.1;
}
.sidebar-logo-tagline {
  font-size: 10.5px; font-weight: 600; color: var(--text-3); letter-spacing: 0.01em;
}
.sidebar-nav { flex: 1; padding: 12px 10px 8px; }
.nav-section-label {
  font-size: 10px; font-weight: 700; color: var(--text-3);
  letter-spacing: 0.06em;
  padding: 4px 10px 10px;
}
.nav-list {
  position: relative;
  display: flex; flex-direction: column; gap: 4px;
}
.nav-indicator {
  position: absolute;
  inset-inline-start: 0;
  width: 3px;
  border-radius: 999px;
  background: var(--grad-accent);
  box-shadow: 0 0 12px rgba(217,167,89,0.45);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 280ms cubic-bezier(0.34, 1.2, 0.64, 1),
    height 280ms cubic-bezier(0.34, 1.2, 0.64, 1),
    opacity 180ms ease;
  z-index: 0;
}
.nav-item {
  position: relative;
  display: flex; align-items: center; gap: 11px;
  padding: 9px 10px;
  border-radius: 11px;
  color: var(--text-2);
  font-size: 13.5px; font-weight: 600;
  transition:
    color 200ms ease,
    background 200ms ease,
    transform 200ms ease,
    box-shadow 200ms ease;
  margin-bottom: 0;
  text-decoration: none;
  border: 1px solid transparent;
  z-index: 1;
}
.nav-item::before {
  content: "";
  position: absolute; inset: 0;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(217,167,89,0.1) 0%, rgba(217,167,89,0.02) 100%);
  opacity: 0;
  transition: opacity 200ms ease;
  pointer-events: none;
}
.nav-item:hover {
  background: rgba(255,255,255,0.03);
  color: var(--text);
  transform: translateX(2px);
}
[dir="rtl"] .nav-item:hover { transform: translateX(-2px); }
.nav-item.active {
  color: var(--accent-2);
  background: rgba(217,167,89,0.1);
  border-color: rgba(217,167,89,0.22);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 18px rgba(0,0,0,0.18);
}
.nav-item.active::before { opacity: 1; }
.nav-item-icon {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
  transition: background 200ms ease, border-color 200ms ease, transform 200ms ease;
}
.nav-item svg { width: 17px; height: 17px; flex-shrink: 0; opacity: 0.78; transition: opacity 200ms ease; }
.nav-item:hover .nav-item-icon { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.08); }
.nav-item.active .nav-item-icon {
  background: rgba(217,167,89,0.16);
  border-color: rgba(217,167,89,0.35);
  transform: scale(1.03);
}
.nav-item.active svg { opacity: 1; color: var(--accent-2); }
.nav-item-label { flex: 1; min-width: 0; line-height: 1.25; }
.nav-item.nav-item--muted { color: var(--text-3); font-weight: 500; }
.nav-item.nav-item--muted:hover { color: var(--text-2); }
.sidebar-footer {
  padding: 10px 10px 14px;
  border-top: 1px solid var(--border);
  background:
    linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.14) 100%);
}
.sidebar-footer-label {
  padding-bottom: 8px;
}
.sidebar-footer-card {
  border-radius: 13px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.sidebar-user {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 11px;
  border-radius: 0;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  border: none;
  text-decoration: none;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
}
.sidebar-user:hover {
  background: rgba(255,255,255,0.04);
}
.sidebar-user:hover .sidebar-user-chevron { opacity: 0.75; color: var(--accent-2); }
.avatar {
  position: relative;
  width: 36px; height: 36px;
  background: var(--grad-accent);
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(217,167,89,0.28);
  border: 2px solid rgba(255,255,255,0.12);
}
.avatar-initials {
  font-size: 12px; font-weight: 800; color: #100E0D; line-height: 1;
}
.avatar-status {
  position: absolute;
  bottom: -1px; inset-inline-end: -1px;
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--success);
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px rgba(52,168,113,0.35);
}
.sidebar-user-info { flex: 1; min-width: 0; }
.sidebar-user-name { font-size: 13px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.sidebar-user-email { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.sidebar-user-chevron {
  flex-shrink: 0;
  opacity: 0.35;
  color: var(--text-3);
  transition: opacity var(--transition), color var(--transition), transform var(--transition);
}
.sidebar-user-chevron svg { width: 14px; height: 14px; display: block; }
[dir="rtl"] .sidebar-user-chevron svg { transform: scaleX(-1); }
.sidebar-footer-divider {
  height: 1px;
  margin: 0 11px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
}
.sidebar-logout {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 9px 11px 10px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 13px; font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  text-align: inherit;
}
.sidebar-logout:hover {
  background: rgba(226,96,79,0.08);
  color: #E8A49A;
}
.sidebar-logout:active { transform: scale(0.99); }
.sidebar-logout-icon {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
  transition: background var(--transition), border-color var(--transition);
}
.sidebar-logout:hover .sidebar-logout-icon {
  background: rgba(226,96,79,0.12);
  border-color: rgba(226,96,79,0.22);
}
.sidebar-logout svg { width: 16px; height: 16px; opacity: 0.85; }

/* Page enter — subtle fade when navigating between shell pages */
@keyframes shell-page-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* ── Main area ───────────────────────────────────────────────────── */
.main {
  flex: 1;
  margin-left: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  animation: shell-page-in 320ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* ── Topbar ──────────────────────────────────────────────────────── */
.topbar {
  height: var(--topbar-h);
  background:
    linear-gradient(180deg, rgba(217,167,89,0.03) 0%, transparent 42%),
    var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 20px;
  gap: 12px;
  position: sticky; top: 0; z-index: 90;
  backdrop-filter: blur(10px);
}
.topbar::after {
  content: "";
  position: absolute; inset: auto 20px 0 20px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(217,167,89,0.22), transparent);
  opacity: 0.55;
  pointer-events: none;
}
.topbar-title { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; min-width: 0; letter-spacing: -0.01em; }
.topbar-actions {
  display: flex; align-items: center; gap: 8px;
  flex-shrink: 0;
}
.topbar-ws {
  display: flex; align-items: center; gap: 9px;
  padding: 6px 10px 6px 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  font-size: 12.5px; color: var(--text-2);
  cursor: pointer;
  transition: all var(--transition);
  max-width: 220px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.topbar-ws:hover {
  border-color: rgba(217,167,89,0.28);
  color: var(--text);
  background: rgba(217,167,89,0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 14px rgba(0,0,0,0.12);
}
.topbar-ws-icon {
  width: 28px; height: 28px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(217,167,89,0.12);
  border: 1px solid rgba(217,167,89,0.22);
  color: var(--accent-2);
  flex-shrink: 0;
}
.topbar-ws-icon svg { width: 13px; height: 13px; }
.topbar-ws-copy {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0; flex: 1;
}
.topbar-ws-label {
  font-size: 9.5px; font-weight: 700; color: var(--text-3);
  letter-spacing: 0.04em; text-transform: uppercase; line-height: 1;
}
.topbar-ws-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--text); line-height: 1.2; }
.topbar-ws-chevron {
  flex-shrink: 0; opacity: 0.45; color: var(--text-3);
  transition: opacity var(--transition), transform var(--transition);
}
.topbar-ws:hover .topbar-ws-chevron { opacity: 0.85; color: var(--accent-2); }
.topbar-ws-chevron svg { width: 13px; height: 13px; display: block; }
.topbar-btn {
  width: 36px; height: 36px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2);
  transition: all var(--transition);
  flex-shrink: 0;
}
.topbar-btn:hover {
  background: rgba(255,255,255,0.05);
  color: var(--text);
  border-color: rgba(255,255,255,0.12);
  transform: translateY(-1px);
}
.topbar-btn:active { transform: scale(0.96); }
.topbar-btn svg { width: 16px; height: 16px; }
.topbar-btn--menu { margin-inline-end: 0; }

/* ── Page content ────────────────────────────────────────────────── */
.page-content {
  flex: 1;
  width: 100%;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
  padding: 28px 28px 48px;
  box-sizing: border-box;
}
.page-header { margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.4px; }
.page-subtitle { font-size: 13px; color: var(--text-2); margin-top: 3px; }

/* ── Cards ───────────────────────────────────────────────────────── */
.card {
  position: relative;
  background: var(--surface);
  background-image: var(--grad-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-inner-glow);
  transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
}
.card:hover { border-color: var(--border-2); box-shadow: var(--shadow-lg), var(--shadow-inner-glow); }
/* Optional gradient top-edge accent: add class .card-accent */
.card-accent::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: var(--grad-accent);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}
.card-title {
  font-size: 12px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 12px;
}

/* ── KPI grid ────────────────────────────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.kpi-card {
  position: relative;
  background: var(--surface);
  background-image: var(--grad-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  overflow: hidden;
  box-shadow: var(--shadow-inner-glow);
  transition: border-color var(--transition), box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
.kpi-card::before {
  content: ""; position: absolute; inset-inline-start: 0; top: 0; bottom: 0; width: 3px;
  background: var(--grad-accent);
  opacity: 0; transition: opacity var(--transition);
}
.kpi-card:hover { border-color: var(--border-2); transform: translateY(-3px); box-shadow: var(--shadow-xl), var(--shadow-inner-glow); }
.kpi-card:hover::before { opacity: 1; }
.kpi-label { font-size: 11.5px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.kpi-value { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.5px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.kpi-delta {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11.5px; font-weight: 600;
  margin-top: 6px;
  padding: 2px 6px;
  border-radius: 4px;
}
.kpi-delta.up-good { color: var(--success); background: var(--success-dim); }
.kpi-delta.down-good { color: var(--success); background: var(--success-dim); }
.kpi-delta.up-bad { color: var(--error); background: var(--error-dim); }
.kpi-delta.down-bad { color: var(--error); background: var(--error-dim); }
.kpi-delta.flat { color: var(--text-3); background: transparent; }

/* ── Campaigns KPI row ──────────────────────────────────────────── */
.camp-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 24px;
}
.camp-kpi-row--hero {
  grid-template-columns: repeat(3, 1fr);
}
.camp-kpi {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--surface);
  background-image: var(--grad-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  overflow: hidden;
  box-shadow: var(--shadow-inner-glow);
  transition: border-color var(--transition), box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
.camp-kpi:hover {
  border-color: var(--border-2);
  transform: translateY(-3px);
  box-shadow: var(--shadow-xl), var(--shadow-inner-glow);
}
.camp-kpi-icon {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.camp-kpi-icon svg {
  width: 22px;
  height: 22px;
}
.camp-kpi[data-accent="gold"]  .camp-kpi-icon { background: rgba(217,167,89,0.12); color: #D9A759; }
.camp-kpi[data-accent="green"] .camp-kpi-icon { background: rgba(52,168,113,0.12); color: #34A871; }
.camp-kpi[data-accent="amber"] .camp-kpi-icon { background: rgba(199,122,31,0.12); color: #C77A1F; }
.camp-kpi[data-accent="blue"]  .camp-kpi-icon { background: rgba(91,141,239,0.12); color: #5B8DEF; }
.camp-kpi-body { min-width: 0; }
.camp-kpi-label {
  font-size: 11.5px;
  color: var(--text-3);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
  white-space: nowrap;
}
.camp-kpi-value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.5px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.camp-kpi-sub {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}

/* ── Campaigns chart grid (2×2 outcomes-first) ──────────────────── */
.camp-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

/* ── Charts ──────────────────────────────────────────────────────── */
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  min-width: 0;
  box-shadow: var(--shadow-inner-glow);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.chart-card:hover { border-color: var(--border-2); box-shadow: var(--shadow-lg), var(--shadow-inner-glow); }
.chart-card-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.chart-card-title { font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.chart-card-sub {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 500;
  line-height: 1.35;
}
.chart-canvas-wrap {
  position: relative;
  height: 220px;
  max-height: 220px;
  min-height: 220px;
  width: 100%;
  overflow: hidden;
  contain: layout size style;
}
.chart-canvas-wrap > canvas {
  display: block;
  max-width: 100%;
}
.chart-grid, .camp-chart-grid { min-width: 0; }

/* ── Tables ──────────────────────────────────────────────────────── */
.table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.table-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.table-title { font-size: 14px; font-weight: 600; color: var(--text); }
table { width: 100%; border-collapse: collapse; }
th {
  text-align: left;
  padding: 11px 16px;
  font-size: 11px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.07em;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  white-space: nowrap;
}
td {
  padding: 12px 16px;
  font-size: 13px; color: var(--text);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--surface-hover); transition: background 0.12s ease; }

/* ── Badges ──────────────────────────────────────────────────────── */
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.badge-green  { background: var(--success-dim); color: var(--success); }
.badge-yellow { background: var(--warning-dim); color: var(--warning); }
.badge-red    { background: var(--error-dim);   color: var(--error); }
.badge-critical { background: var(--critical-dim); color: var(--critical); }
.badge-gray   { background: rgba(255,255,255,0.06); color: var(--text-3); }
.badge-blue   { background: var(--accent-dim); color: var(--accent-2); }

/* ── Buttons ─────────────────────────────────────────────────────── */
.btn {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  border: none; cursor: pointer;
  transition: transform var(--transition), box-shadow var(--transition), background var(--transition), border-color var(--transition), color var(--transition), filter var(--transition);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  isolation: isolate;
}
.btn:active { transform: translateY(1px) scale(0.985); }
/* Ripple */
.btn::after {
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(circle at var(--rx, 50%) var(--ry, 50%), rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 45%);
  opacity: 0;
  transition: opacity 500ms ease;
  pointer-events: none;
  z-index: -1;
}
.btn.is-rippling::after { opacity: 1; transition: opacity 0ms; }
.btn-primary { background: var(--grad-accent); color: #fff; box-shadow: var(--shadow-accent); }
.btn-primary:hover { background: var(--grad-accent-hover); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(217,167,89,0.45); }
.btn-primary:active { transform: translateY(0) scale(0.985); }
.btn-secondary {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
}
.btn-secondary:hover { background: var(--surface-hover); border-color: var(--accent); color: #fff; transform: translateY(-1px); }
.btn-danger { background: var(--error-dim); color: var(--error); border: 1px solid transparent; }
.btn-danger:hover { background: var(--error); color: #fff; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(226,96,79,0.35); }
.btn-ghost { background: transparent; color: var(--text-2); }
.btn-ghost:hover { background: var(--surface-hover); color: var(--text); }
.btn-success { background: var(--grad-success); color: #fff; box-shadow: 0 4px 14px rgba(52,168,113,0.3); }
.btn-success:hover { transform: translateY(-1px); filter: brightness(1.08); box-shadow: 0 6px 20px rgba(52,168,113,0.4); }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-lg { padding: 10px 20px; font-size: 14px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; transform: none; box-shadow: none; }
/* Loading state: hide label, show spinner */
.btn.is-loading { color: transparent !important; pointer-events: none; }
.btn.is-loading::before {
  content: "";
  position: absolute; top: 50%; left: 50%;
  width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: btn-spin 0.6s linear infinite;
  z-index: 1;
}
@keyframes btn-spin { to { transform: rotate(360deg); } }

/* ── Forms ───────────────────────────────────────────────────────── */
.form-group { margin-bottom: 16px; }
.form-label { display: block; font-size: 12.5px; font-weight: 500; color: var(--text-2); margin-bottom: 6px; }
.form-input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13.5px; color: var(--text);
  outline: none;
  transition: border-color var(--transition);
}
.form-input:focus { border-color: var(--accent); }
.form-input::placeholder { color: var(--text-3); }
select.form-input { cursor: pointer; }

/* ── Alerts ──────────────────────────────────────────────────────── */
.alert {
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  margin-bottom: 16px;
  display: flex; align-items: flex-start; gap: 9px;
}
.alert-error { background: var(--error-dim); color: var(--error); border: 1px solid rgba(226,96,79,0.2); }
.alert-success { background: var(--success-dim); color: var(--success); border: 1px solid rgba(52,168,113,0.2); }
.alert-warning { background: var(--warning-dim); color: var(--warning); border: 1px solid rgba(199,122,31,0.2); }
.alert-info { background: var(--accent-dim); color: var(--accent-2); border: 1px solid rgba(217,167,89,0.2); }

/* ── Global token-decrypt failure banner ─────────────────────────── */
.token-decrypt-banner {
  display: none;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  background: linear-gradient(90deg, rgba(199,56,42,0.22), rgba(226,96,79,0.12));
  border-bottom: 2px solid var(--critical);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  position: sticky;
  top: var(--topbar-h);
  z-index: 85;
}
.token-decrypt-banner.visible { display: flex; }
.token-decrypt-banner-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  color: var(--critical);
}
.token-decrypt-banner-body { flex: 1; min-width: 0; }
.token-decrypt-banner-title {
  font-size: 14px;
  font-weight: 800;
  color: #F2B8AE;
  letter-spacing: -0.2px;
  margin-bottom: 2px;
}
.token-decrypt-banner-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.token-decrypt-banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.token-decrypt-banner .btn-reconnect {
  background: var(--critical);
  color: #fff;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
  transition: background var(--transition);
}
.token-decrypt-banner .btn-reconnect:hover { background: #A92F23; color: #fff; }
.token-decrypt-banner-dismiss {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-2);
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.token-decrypt-banner-dismiss:hover { background: rgba(255,255,255,0.06); color: var(--text); }
@media (max-width: 768px) {
  .token-decrypt-banner { flex-wrap: wrap; padding: 12px 16px; }
  .token-decrypt-banner-actions { width: 100%; justify-content: flex-end; }
}

/* ── Empty state ─────────────────────────────────────────────────── */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.empty-icon { font-size: 36px; margin-bottom: 12px; opacity: 0.4; }
.empty-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.empty-text { font-size: 13px; color: var(--text-2); max-width: 300px; }

/* ── Spinner ─────────────────────────────────────────────────────── */
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--border-2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-overlay {
  display: flex; align-items: center; justify-content: center;
  min-height: 300px;
  flex-direction: column; gap: 12px;
}
.loading-text { font-size: 13px; color: var(--text-2); }

/* ── Health score ring ───────────────────────────────────────────── */
.health-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.health-number { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
.health-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; }

/* ── Section divider ─────────────────────────────────────────────── */
.section-gap { margin-bottom: 24px; }

/* ── Flex helpers ────────────────────────────────────────────────── */
.flex { display: flex; }
.flex-1 { flex: 1; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }

/* ── Text helpers ────────────────────────────────────────────────── */
.text-2 { color: var(--text-2); }
.text-3 { color: var(--text-3); }
.text-sm { font-size: 12px; }
.text-xs { font-size: 11px; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Tabs ────────────────────────────────────────────────────────── */
.tabs { display: flex; gap: 2px; padding: 3px; background: var(--surface-2); border-radius: var(--radius-sm); border: 1px solid var(--border); width: fit-content; }
.tab {
  padding: 5px 12px; font-size: 12.5px; font-weight: 500; color: var(--text-2);
  border-radius: 4px; cursor: pointer; transition: all var(--transition); border: none; background: none;
}
.tab.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
.tab:hover:not(.active) { color: var(--text); }

/* ── Search ──────────────────────────────────────────────────────── */
.search-wrap { position: relative; }
.search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text-3); pointer-events: none; }
.search-input { padding-left: 32px !important; }

/* ── Toast ───────────────────────────────────────────────────────── */
#toast-container {
  position: fixed; bottom: 20px; right: 20px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px;
}
.toast {
  padding: 12px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px; color: var(--text);
  box-shadow: var(--shadow-lg);
  animation: slide-in 0.2s ease;
  max-width: 320px;
}
.toast.success { border-left: 3px solid var(--success); }
.toast.error   { border-left: 3px solid var(--error); }
.toast.info    { border-left: 3px solid var(--accent); }
.toast.warning { border-left: 3px solid var(--warning); }
@keyframes slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ── Background sync status bar (B-0) ─────────────────────────────── */
.sync-status-bar {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 16px;
  background: var(--accent-dim);
  border: 1px solid rgba(217,167,89,0.35);
  border-radius: var(--radius-lg);
  font-size: 13px;
  color: var(--text);
}
.sync-status-inner { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; flex-wrap: wrap; }
.sync-status-spinner {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 2px solid rgba(217,167,89,0.25);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.sync-status-text { font-weight: 600; color: var(--text); }
.sync-status-progress {
  flex: 1; min-width: 80px; max-width: 200px; height: 5px;
  background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;
}
.sync-status-progress-bar {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  border-radius: 999px;
  transition: width 0.5s ease;
}
.sync-status-meta { font-size: 11.5px; color: var(--text-3); margin-left: auto; }

/* ── Meta CDN image fallbacks (C-2) ─────────────────────────────── */
.meta-img-wrap, .inspector-creative-thumb {
  position: relative;
  overflow: hidden;
  background: var(--surface-2);
}
.meta-img-wrap img, .inspector-creative-img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.meta-img-wrap img.meta-img-loading {
  opacity: 0;
}
.meta-img-fallback, .inspector-creative-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
  background: linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%);
  color: var(--text-3);
}
.meta-img-fallback.visible, .inspector-creative-fallback.visible { display: flex; }
.meta-img-placeholder {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-hover) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: meta-img-shimmer 1.2s ease-in-out infinite;
}
@keyframes meta-img-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.section-fallback {
  padding: 16px; border: 1px dashed var(--border);
  border-radius: var(--radius); color: var(--text-3); font-size: 13px; text-align: center;
}

/* ── Modal ───────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(4px);
  animation: fade-in 0.15s ease;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.modal {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 100%; max-width: 440px;
  box-shadow: var(--shadow-lg);
  animation: scale-in 0.15s ease;
}
@keyframes scale-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
.modal-title { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.modal-subtitle { font-size: 13px; color: var(--text-2); margin-bottom: 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

/* ── Metric "Explain" info trigger + popover body ───────────────────── */
.info-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%;
  background: transparent; border: 1px solid var(--text-3); color: var(--text-3);
  font-size: 10px; font-weight: 700; line-height: 1; cursor: pointer;
  flex-shrink: 0; transition: all var(--transition);
}
.info-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.metric-info-block { margin-bottom: 14px; }
.metric-info-block:last-child { margin-bottom: 0; }
.metric-info-block-title { font-size: 10.5px; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
#metric-info-body p { font-size: 13px; color: var(--text-2); line-height: 1.55; }
.metric-info-formula { font-family: 'Tajawal', monospace; font-size: 13.5px; color: var(--accent-2); background: var(--accent-dim); border-radius: var(--radius-sm); padding: 8px 10px; display: inline-block; }
.metric-info-causes { margin: 0; padding-inline-start: 18px; font-size: 13px; color: var(--text-2); line-height: 1.6; }
.metric-info-causes li { margin-bottom: 3px; }

/* ── Smart Context Actions — chip row under a KPI's delta, only when an
   issue is actively affecting that metric. Quiet by default (no chips on
   healthy metrics), matches the redesign's "recessive unless there's a
   story" principle. ──────────────────────────────────────────────────── */
.context-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.context-action-chip {
  display: inline-flex; align-items: center;
  font-size: 10.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px;
  background: var(--accent-dim); color: var(--accent-2);
  border: 1px solid transparent;
  transition: all var(--transition);
}
.context-action-chip:hover { background: var(--accent); color: #fff; }

/* ── Sidebar overlay (mobile) ─────────────────────────────────────── */
.sidebar-overlay {
  display: none; position: fixed; inset: 0; z-index: 99;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
  opacity: 0; transition: opacity 0.2s;
}
@media (max-width: 768px) {
  .sidebar-overlay.visible { display: block; opacity: 1; }
}

/* ── Responsive ──────────────────────────────────���───────────────── */
@media (max-width: 768px) {
  /* The off-canvas sidebar is position:fixed and slid off-screen with a
     transform. A translated fixed element STILL contributes to the document's
     horizontal scroll width, so it added ~a sidebar-width of phantom overflow
     on phones (content looked shifted/cut off). Clip it at the root. We use
     the html element (not body) so the sticky topbar's scroll container is
     unaffected. */
  html { overflow-x: hidden; }
  .sidebar { transform: translateX(-100%); transition: transform var(--transition); z-index: 100; }
  .sidebar.open { transform: translateX(0); }
  .main { margin-left: 0; padding-bottom: 72px; min-width: 0; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
  .camp-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .camp-kpi-row--hero { grid-template-columns: 1fr; }
  .camp-chart-grid { grid-template-columns: 1fr; }
  .page-content { padding: 14px 12px 24px; }
  .mobile-menu-btn { display: flex !important; }
  .topbar { padding: 0 12px; }
  .topbar-title { font-size: 14px; }
  .modal { max-width: calc(100vw - 24px) !important; margin: 12px auto !important; }
}
.mobile-menu-btn { display: none; }

/* ── Beginner mode: hide pro chrome (sidebar + mobile nav) ───────────
   Beginner is a focused, simplified surface. Pro navigation lives in the
   sidebar / bottom nav — hide both so only the beginner dashboard +
   topbar (mode toggle) remain. Switching back to احترافي restores them. */
.app-shell--beginner .sidebar,
.app-shell--beginner + .mobile-bottom-nav,
body:has(.app-shell--beginner) .mobile-bottom-nav,
body:has(.app-shell--beginner) .sidebar-overlay {
  display: none !important;
}
.app-shell--beginner .main {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
.app-shell--beginner .mobile-menu-btn { display: none !important; }
[dir="rtl"] .app-shell--beginner .main {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
@media (max-width: 768px) {
  .app-shell--beginner .main { padding-bottom: 24px; }
}

/* ── Mobile Bottom Navigation ─────────────────────────────────────── */
.mobile-bottom-nav {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  z-index: 1000;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 6px 0 env(safe-area-inset-bottom, 8px);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
@media (max-width: 768px) {
  .mobile-bottom-nav { display: flex; }
}
.mobile-nav-item {
  flex: 1;
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 4px 6px;
  text-decoration: none;
  color: var(--text-3);
  font-size: 10px; font-weight: 700;
  transition: color 0.22s ease, transform 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}
.mobile-nav-item::before {
  content: "";
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 0; height: 3px; border-radius: 999px;
  background: var(--grad-accent);
  transition: width 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.mobile-nav-item svg { width: 21px; height: 21px; transition: transform 0.2s ease; }
.mobile-nav-item.active {
  color: var(--accent-2);
}
.mobile-nav-item.active::before { width: 28px; }
.mobile-nav-item.active svg { transform: translateY(-1px); }
.mobile-nav-item:active { transform: scale(0.94); }

/* ── Mobile touch targets + spacing ───────────────────────────────── */
@media (max-width: 768px) {
  .btn, .topbar-btn, .nav-item, .context-action-chip { min-height: 44px; min-width: 44px; }
  .info-btn { min-width: 32px; min-height: 32px; font-size: 13px; }
  .ticker-item { padding: 6px 12px; }
  .strategy-card { padding: 14px 16px; }
  .hero-card { padding: 16px; }
  .hero-value { font-size: 26px; }
  .hero-label { font-size: 10px; }
}

/* ── Dashboard mode toggle (Pro / Beginner) ──────────────────────────── */
.mode-toggle {
  position: relative;
  display: inline-flex; align-items: center;
  padding: 3px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.mode-toggle-indicator {
  position: absolute;
  top: 3px; bottom: 3px;
  left: 0;
  border-radius: 999px;
  background: var(--grad-accent);
  box-shadow: 0 4px 14px rgba(217,167,89,0.35);
  pointer-events: none;
  transition:
    transform 280ms cubic-bezier(0.34, 1.2, 0.64, 1),
    width 280ms cubic-bezier(0.34, 1.2, 0.64, 1);
  z-index: 0;
}
.mode-toggle-btn {
  position: relative; z-index: 1;
  padding: 6px 13px;
  font-size: 12px; font-weight: 700;
  color: var(--text-3);
  background: transparent;
  border: none; border-radius: 999px;
  cursor: pointer;
  transition: color 200ms ease;
  font-family: inherit;
  white-space: nowrap;
}
.mode-toggle-btn:hover { color: var(--text); }
.mode-toggle-btn.active { color: #100E0D; }

/* ── RTL Support ────────────────────────────────────────────────── */
[dir="rtl"] .sidebar { left: auto; right: 0; border-right: none; border-left: 1px solid var(--border); }
[dir="rtl"] .main { margin-left: 0; margin-right: var(--sidebar-w); }
[dir="rtl"] th { text-align: right; }
[dir="rtl"] .search-wrap svg { left: auto; right: 10px; }
[dir="rtl"] .search-input { padding-left: 12px !important; padding-right: 32px !important; }
[dir="rtl"] .toast.success { border-left: none; border-right: 3px solid var(--success); }
[dir="rtl"] .toast.error { border-left: none; border-right: 3px solid var(--error); }
[dir="rtl"] .toast.info { border-left: none; border-right: 3px solid var(--accent); }
[dir="rtl"] .toast.warning { border-left: none; border-right: 3px solid var(--warning); }
[dir="rtl"] #toast-container { right: auto; left: 20px; }
[dir="rtl"] .kpi-value, [dir="rtl"] .health-number { font-feature-settings: 'tnum'; direction: ltr; }
[dir="rtl"] .sync-status-meta { margin-left: 0; margin-right: auto; }
[dir="rtl"] .mode-toggle { margin-right: 0; margin-left: 0; }
[dir="rtl"] .topbar-btn.mobile-menu-btn { margin-right: 0; margin-left: 0; }
@media (max-width: 768px) {
  .topbar-actions { gap: 6px; }
  .topbar-ws-label { display: none; }
  .topbar-ws { max-width: 140px; padding: 5px 8px; }
  .mode-toggle-btn { padding: 6px 10px; font-size: 11px; }
}
@media (max-width: 768px) {
  [dir="rtl"] .sidebar { transform: translateX(100%); z-index: 100; }
  [dir="rtl"] .sidebar.open { transform: translateX(0); }
  [dir="rtl"] .main { margin-right: 0; }
}

/* ── Diagnosis cards ────────────────────────────────────────────── */
.diagnosis-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 8px; }
.diagnosis-card {
  background: var(--surface);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px;
  padding: 16px 16px 14px;
  border-inline-start: 3px solid var(--accent);
  direction: rtl;
  transition: border-color var(--transition);
  width: 100%;
  max-width: none;
}
.diagnosis-card:hover { border-color: rgba(217,167,89,0.28); }
.diagnosis-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.diagnosis-name { font-size: 14.5px; font-weight: 800; color: var(--text); line-height: 1.35; }
.diagnosis-confidence { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.diagnosis-confidence.high { background: var(--success-dim); color: var(--success); }
.diagnosis-confidence.medium { background: var(--warning-dim); color: var(--warning); }
.diagnosis-confidence.low { background: rgba(255,255,255,0.06); color: var(--text-3); }
.diagnosis-narrative { font-size: 13.5px; color: var(--text-2); line-height: 1.65; margin-bottom: 12px; }
.diagnosis-action {
  font-size: 13px; color: var(--text); background: rgba(217,167,89,0.07);
  border: 1px solid rgba(217,167,89,0.16);
  padding: 11px 13px; border-radius: 12px; line-height: 1.55;
}
.diagnosis-action-label { font-weight: 800; font-size: 11px; margin-bottom: 4px; color: var(--accent-2); }
.diagnosis-expect {
  margin-top: 8px; font-size: 12.5px; color: var(--text-2); line-height: 1.5;
  padding-top: 8px; border-top: 1px dashed rgba(217,167,89,0.22);
}
.diagnosis-card--hero {
  padding: 20px 20px 16px;
  border-inline-start-width: 4px;
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(217,167,89,0.12), transparent 55%),
    var(--surface);
  border-color: rgba(217,167,89,0.28);
  box-shadow: 0 14px 40px rgba(0,0,0,0.22);
}
.diagnosis-card--hero .diagnosis-name { font-size: 20px; letter-spacing: -0.02em; }
.diagnosis-card--hero .diagnosis-narrative { font-size: 14px; margin-bottom: 14px; }
.diagnosis-card--hero .diagnosis-action { font-size: 13.5px; padding: 13px 14px; }
.diagnosis-cta-row { margin-top: 14px; }
.diagnosis-card--hero.has-critical { border-inline-start-color: var(--error); }
.diagnosis-card--hero.has-warning { border-inline-start-color: var(--warning); }
/* Standalone headline used ONLY by the redesigned pro dashboard's hero
   (dashboardPage.ts renderMainMove) — sits below the header row rather than
   inline with the confidence badge, so it needs its own class rather than
   reusing .diagnosis-name (which beginnerDashboardPage.ts still renders
   INSIDE .diagnosis-header, inline with its badge — giving it this same
   large/display treatment would break that page's header alignment). */
.diagnosis-headline {
  font-family: var(--font-display); font-weight: 700;
  font-size: 21px; line-height: 1.45; letter-spacing: -0.01em;
  color: var(--text);
  margin-bottom: 14px;
}

/* ── The golden thread — signature narrative treatment ────────────────────
   A vertical connector linking the read (evidence + diagnosis) to the
   recommendation, so a decision reads as one continuous line of reasoning
   instead of stacked, disconnected paragraphs. Reused wherever the product
   narrates a diagnosis: dashboard hero, AI assistant replies, ad analysis,
   tasks. The final step's dot is filled solid — it's where the reasoning
   resolves into an action. */
.thread { position: relative; padding-inline-start: 22px; }
.thread::before {
  content: ""; position: absolute; inset-inline-start: 5px; top: 5px; bottom: 5px;
  width: 2px; border-radius: 2px;
  background: linear-gradient(180deg, var(--accent), rgba(217,167,89,0.1));
}
.thread-steps { display: flex; flex-direction: column; gap: 12px; }
.thread-step { position: relative; font-size: 13px; line-height: 1.6; color: var(--text); }
.thread-step::before {
  content: ""; position: absolute; inset-inline-start: -22px; top: 4px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--bg); border: 2px solid rgba(217,167,89,0.6);
}
.thread-step-label { display: block; font-size: 10px; font-weight: 800; color: var(--accent-2); margin-bottom: 3px; }
.thread-step-sub { margin-top: 6px; font-size: 12px; color: var(--text-2); }
.thread-step--action::before { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 10px rgba(217,167,89,0.5); }

/* ── Unified honest status strip — one connected read on where every
   campaign actually stands, replacing scattered counters. Segments are
   proportional to real counts; "بدون إنفاق" (Meta-ACTIVE, zero spend) is
   rendered in --warning, never counted as delivering — see
   lib/campaignCatalog.ts for the counts contract this renders. ─────────── */
.status-strip-bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; gap: 2px; background: var(--surface-2); }
.status-strip-bar > span { display: block; min-width: 2px; }
.status-strip-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 9px; font-size: 10.5px; color: var(--text-2); font-weight: 700; }
.status-strip-item { display: flex; align-items: center; gap: 5px; }
.status-strip-dot { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; }
.status-strip-note { margin-top: 7px; font-size: 10.5px; color: var(--text-3); line-height: 1.5; }

/* Advanced analytics section chrome (shared) */
.adv-block { margin-bottom: 22px; direction: rtl; }
.adv-block-head { margin-bottom: 12px; }
.adv-block-title {
  font-size: 13px; font-weight: 800; color: var(--text);
  padding-inline-start: 10px; border-inline-start: 3px solid var(--accent);
}
.adv-block-sub { font-size: 12px; color: var(--text-3); margin-top: 4px; padding-inline-start: 13px; }
.adv-empty-ok {
  font-size: 13px; color: var(--text-2); padding: 14px 16px;
  background: rgba(52,168,113,0.06); border: 1px solid rgba(52,168,113,0.18);
  border-radius: 12px;
}
.adv-issues-list { display: flex; flex-direction: column; gap: 0; }
.adv-issue-row { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.adv-issue-row:last-child { border-bottom: none; }
.adv-issue-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.adv-issue-title { font-size: 13.5px; font-weight: 700; color: var(--text); }
.adv-issue-sev {
  font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
}
.adv-issue-sev.critical { background: var(--error-dim); color: var(--error); }
.adv-issue-sev.high { background: rgba(199,122,31,0.12); color: var(--warning); }
.adv-issue-sev.medium { background: rgba(217,167,89,0.1); color: var(--accent-2); }
.adv-issue-sev.low { background: rgba(255,255,255,0.05); color: var(--text-3); }
.adv-issue-why { font-size: 12.5px; color: var(--text-2); margin-top: 4px; line-height: 1.5; }
.adv-issue-action { font-size: 12.5px; color: var(--accent-2); margin-top: 6px; line-height: 1.5; }
.adv-campaigns-table { width: 100%; border-collapse: collapse; direction: rtl; }
.adv-campaigns-table th {
  text-align: start; font-size: 11px; font-weight: 700; color: var(--text-3);
  padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap;
}
.adv-campaigns-table td {
  padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.04);
  font-size: 13px; color: var(--text); vertical-align: top;
}
.adv-camp-name { font-weight: 700; line-height: 1.35; }
.adv-camp-obj { font-size: 11.5px; color: var(--text-3); margin-top: 3px; }
.adv-camp-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.adv-camp-note {
  display: inline-flex; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
}
.adv-camp-note.note-best { background: var(--success-dim); color: var(--success); }
.adv-camp-note.note-worst { background: var(--error-dim); color: var(--error); }
.adv-camp-note.note-danger { background: rgba(211,47,47,0.14); color: var(--error); }
.adv-camp-note.note-hot { background: rgba(217,167,89,0.14); color: var(--accent-2); }
.adv-camp-note.note-watch { background: rgba(199,122,31,0.12); color: var(--warning); }
.adv-camp-note.note-muted { background: rgba(255,255,255,0.04); color: var(--text-3); }

/* ── Attribution bar ────────────────────────────────────────────── */
.attribution-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  margin-bottom: 24px;
}
.attribution-title { font-size: 13px; font-weight: 800; color: var(--text); margin-bottom: 14px; }
.attribution-bars { display: flex; gap: 16px; flex-wrap: wrap; }
.attribution-factor { flex: 1; min-width: 120px; }
.attribution-factor-label { font-size: 12px; color: var(--text-2); margin-bottom: 6px; font-weight: 500; }
.attribution-factor-value { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; direction: ltr; }
.attribution-factor-value.positive { color: var(--success); }
.attribution-factor-value.negative { color: var(--error); }
.attribution-factor-value.neutral { color: var(--text-3); }
.attribution-factor-bar {
  height: 4px; border-radius: 2px; margin-top: 6px;
  background: var(--surface-2);
}
.attribution-factor-fill {
  height: 100%; border-radius: 2px;
  transition: width 0.5s ease;
}
.attribution-primary-tag {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  padding: 1px 6px; border-radius: 3px; margin-top: 4px;
  background: var(--accent-dim); color: var(--accent-2); letter-spacing: 0.05em;
}
.attribution-narrative { font-size: 13px; color: var(--text-2); margin-top: 14px; line-height: 1.6; padding-top: 14px; border-top: 1px solid var(--border); }
.attribution-creative-card { margin-top: 12px; margin-bottom: 0; }
.attribution-creative-list { display: flex; flex-direction: column; gap: 8px; }
.attribution-creative-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.attribution-creative-rank { color: var(--text-3); font-weight: 700; width: 22px; flex-shrink: 0; }
.attribution-creative-name { color: var(--text-1); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attribution-creative-spend { color: var(--text-2); direction: ltr; font-variant-numeric: tabular-nums; }

/* ── Table horizontal scroll on mobile ──────────────────────────── */
@media (max-width: 768px) {
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .table-wrap table { min-width: 700px; }
  .adv-campaigns-table { min-width: 720px; }
  .account-cards { grid-template-columns: 1fr !important; }
  .rec-grid { grid-template-columns: 1fr !important; }
  .settings-grid { grid-template-columns: 1fr !important; }
  .gate-grid { grid-template-columns: 1fr !important; }
  .diagnosis-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .modal { max-width: calc(100vw - 32px); margin: 16px; }
}

/* ── New components ─────────────────────────────────────────────── */
/* Gradient text (headings / brand emphasis) */
.gradient-text {
  background: var(--grad-accent);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}

/* Skeleton loaders */
.skeleton {
  position: relative; overflow: hidden;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}
.skeleton::after {
  content: ""; position: absolute; inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
  animation: skeleton-shimmer 1.3s infinite;
}
[dir="rtl"] .skeleton::after { animation-name: skeleton-shimmer-rtl; }
@keyframes skeleton-shimmer { 100% { transform: translateX(100%); } }
@keyframes skeleton-shimmer-rtl { 100% { transform: translateX(-100%); } }
[dir="rtl"] .skeleton::after { transform: translateX(100%); }
.skeleton-line { height: 12px; margin-bottom: 8px; }
.skeleton-line.sk-lg { height: 20px; }
.skeleton-line.w-40 { width: 40%; } .skeleton-line.w-60 { width: 60%; } .skeleton-line.w-80 { width: 80%; }
.skeleton-kpi { height: 78px; border-radius: var(--radius-lg); }

/* Empty states */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 48px 24px; gap: 6px;
}
.empty-state-icon {
  width: 56px; height: 56px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; margin-bottom: 10px;
  background: var(--accent-dim); color: var(--accent-2);
}
.empty-state-title { font-size: 15px; font-weight: 700; color: var(--text); }
.empty-state-text { font-size: 13px; color: var(--text-2); max-width: 340px; line-height: 1.6; }
.empty-state .btn { margin-top: 12px; }

/* Tooltips (data-tooltip attribute) */
[data-tooltip] { position: relative; }
[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(4px);
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border-2);
  padding: 5px 9px; border-radius: var(--radius-sm);
  font-size: 11.5px; font-weight: 500; white-space: nowrap;
  box-shadow: var(--shadow-lg);
  opacity: 0; pointer-events: none;
  transition: opacity var(--transition), transform var(--transition);
  z-index: 200;
}
[data-tooltip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Section header with gradient accent bar */
.section-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
}
.section-header::before {
  content: ""; width: 4px; height: 18px; border-radius: 2px;
  background: var(--grad-accent); flex-shrink: 0;
}
.section-header-title { font-size: 15px; font-weight: 700; color: var(--text); }

/* Chip / pill */
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  background: var(--surface-2); color: var(--text-2);
  border: 1px solid var(--border);
}
.chip-accent { background: var(--accent-dim); color: var(--accent-2); border-color: transparent; }

/* ── Accessibility ──────────────────────────────────────────────── */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* ── Section reveal (Magic UI blur-fade port) ─────────────────────
   JS adds .reveal + .reveal-in together (staggerReveal), so nothing is
   ever left invisible if scripts fail; reduced-motion users skip it in JS. */
@media (prefers-reduced-motion: no-preference) {
  .reveal { opacity: 0; }
  .reveal.reveal-in {
    animation: blur-fade-in .45s cubic-bezier(.22,.61,.36,1) forwards;
  }
  .reveal.reveal-d1 { animation-delay: 60ms; }
  .reveal.reveal-d2 { animation-delay: 120ms; }
  .reveal.reveal-d3 { animation-delay: 180ms; }
  .reveal.reveal-d4 { animation-delay: 240ms; }
  .reveal.reveal-d5 { animation-delay: 300ms; }
  @keyframes blur-fade-in {
    from { opacity: 0; transform: translateY(8px); filter: blur(6px); }
    to   { opacity: 1; transform: none;            filter: none; }
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

// ── Sidebar icons (SVG) ─────────────────────────────────────────────────
const ICONS: Record<string, string> = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  campaigns: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  recommendations: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7z"/><path d="M22 19H2"/></svg>`,
  workspace: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2"/><path d="M12 6v6l4 2"/></svg>`,
  'ad-analysis': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`,
  support: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
};

// ── Shared JS (auth guard, toast, sidebar toggle) ───────────────────────
export const SHARED_JS = `
const API = '';

(function () {
  var _errQueue = [];
  function _reportErr(msg, src, line) {
    if (_errQueue.length > 5) return;
    _errQueue.push({ msg: String(msg).slice(0, 200), src: src, line: line, ts: Date.now() });
    if (_errQueue.length === 1) setTimeout(function () {
      var batch = _errQueue.splice(0);
      var t = localStorage.getItem('adlytic_token');
      if (!t) return;
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ errors: batch, url: location.pathname }),
      }).catch(function () {});
    }, 2000);
  }
  window.onerror = function (msg, src, line) { _reportErr(msg, src, line); };
  window.onunhandledrejection = function (e) { _reportErr(e.reason && e.reason.message || String(e.reason), '', 0); };
})();

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getToken() { return localStorage.getItem('adlytic_token') || ''; }
function getWsId()  { return localStorage.getItem('adlytic_workspace_id') || ''; }
function setWsId(id) { localStorage.setItem('adlytic_workspace_id', id); }

// Reconcile the stored active workspace against the authenticated user's real
// memberships (from /api/auth/me). If the stored id is missing or does not
// belong to this account, reset it to the first membership (or clear it).
// This is the client-side single-source-of-truth guard against workspace mixing.
function reconcileWorkspace(me) {
  try {
    var memberships = (me && Array.isArray(me.memberships)) ? me.memberships : [];
    var ids = memberships.map(function (m) { return m.workspaceId || (m.workspace && m.workspace.id); }).filter(Boolean);
    var stored = getWsId();
    if (stored && ids.indexOf(stored) !== -1) return stored; // valid — keep it
    var next = ids.length ? ids[0] : '';
    if (next) setWsId(next);
    else localStorage.removeItem('adlytic_workspace_id');
    return next;
  } catch (e) { return getWsId(); }
}

function clearClientIdentity() {
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var lk = localStorage.key(i);
      if (lk && lk.indexOf('adlytic_') === 0) localStorage.removeItem(lk);
    }
    for (var j = sessionStorage.length - 1; j >= 0; j--) {
      var sk = sessionStorage.key(j);
      if (sk && sk.indexOf('adlytic_') === 0) sessionStorage.removeItem(sk);
    }
    document.cookie = 'adlytic_session=; Path=/; Max-Age=0; SameSite=Lax';
    if (window.caches && caches.keys) {
      caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).catch(function () {});
    }
  } catch (e) { /* non-fatal */ }
}

function logout() {
  clearClientIdentity();
  window.location.href = '/login';
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { logout(); return null; }
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    if (err.code === 'ACCOUNT_INACTIVE') {
      window.location.href = err.redirect || '/pending-activation';
      return null;
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || res.statusText);
    if (err.code) e.code = err.code;
    if (err.reconnectUrl) e.reconnectUrl = err.reconnectUrl;
    if (err.reconnectLabel) e.reconnectLabel = err.reconnectLabel;
    throw e;
  }
  // Guard against the server returning a non-JSON body (HTML error page,
  // truncated response, or serialization failure). Throw a readable error
  // rather than letting "SyntaxError: Unexpected token '<'" bubble up
  // opaquely through every caller.
  return res.json().catch(async () => {
    const preview = (await res.clone().text().catch(() => '')).slice(0, 120);
    throw new Error('Server returned a non-JSON response: ' + (preview || '(empty body)'));
  });
}

async function apiFetchWithTimeout(path, opts, timeoutMs) {
  timeoutMs = timeoutMs || 12000;
  if (typeof AbortController === 'undefined') return apiFetch(path, opts);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await apiFetch(path, Object.assign({}, opts || {}, { signal: controller.signal }));
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Request timed out: ' + path);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// Poll a SyncJob (GET /api/sync-jobs/:id) until it COMPLETES or FAILS. Every
// "Sync now" entrypoint MUST funnel through this so the UI reflects the REAL
// background outcome instead of the bare 202 enqueue response (which only means
// the job was queued, not that any data was written). opts:
//   { intervalMs = 1500, maxAttempts = 180, onProgress(job, tick) }
// Resolves with the COMPLETED job; throws on FAILED (Error.message = job.error)
// or on timeout. A TOKEN_ENCRYPTION_KEY mismatch surfaces synchronously at the
// POST /sync call (500 + code TOKEN_DECRYPT_FAILED), never here.
async function pollSyncJob(jobId, opts) {
  opts = opts || {};
  var intervalMs = opts.intervalMs || 1500;
  var maxAttempts = opts.maxAttempts || 180;
  for (var i = 0; i < maxAttempts; i++) {
    var job = await apiFetch('/api/sync-jobs/' + encodeURIComponent(jobId));
    if (opts.onProgress) { try { opts.onProgress(job, i); } catch (e) {} }
    if (job && job.status === 'COMPLETED') return job;
    if (job && job.status === 'FAILED') {
      // Never surface raw Meta/Prisma text to paying customers.
      var raw = String(job.error || '');
      var friendly = 'فشلت المزامنة — حاول مرة أخرى من مساحة العمل.';
      if (/Waiting — another sync|already in progress/i.test(raw)) {
        friendly = 'المزامنة قيد التشغيل — ستتحدّث بياناتك تلقائياً عند الانتهاء.';
      } else if (/code.*190|190.*code|OAuthException|token has expired|session has been invalidated/i.test(raw)) {
        friendly = 'انتهت صلاحية رمز Meta. أعد الربط من إعدادات مساحة العمل.';
      } else if (/Timed out|stuck for over/i.test(raw)) {
        friendly = 'انتهت مهلة المزامنة — أعد المحاولة. إذا استمر الأمر تواصل مع الدعم.';
      } else if (/Insights pending|engine pipeline failed/i.test(raw)) {
        friendly = 'اكتملت المزامنة لكن التحليلات لم تُحدَّث بعد — أعد تحميل اللوحة بعد لحظات.';
      }
      throw new Error(friendly);
    }
    await sleep(intervalMs);
  }
  throw new Error('المزامنة تأخذ وقتاً أطول من المتوقع — ستنتهي في الخلفية.');
}

function friendlyApiError(err) {
  if (!err) return 'حدث خطأ. يرجى المحاولة مرة أخرى.';
  if (err.code === 'TOKEN_DECRYPT_FAILED') {
    return 'تعذّر قراءة رمز Meta المحفوظ. أعد ربط حسابك من إعدادات مساحة العمل.';
  }
  if (err.code === 'AI_CREDITS_EXHAUSTED') {
    return 'المساعد الذكي غير متاح مؤقتاً بسبب نفاد رصيد مزوّد الذكاء الاصطناعي. تابع التشخيص من لوحة التحكم، أو أعد المحاولة لاحقاً.';
  }
  if (err.code === 'AI_RATE_LIMITED') {
    return 'وصلنا حد الطلبات مؤقتاً. انتظر دقيقة ثم أعد المحاولة.';
  }
  if (err.code === 'AI_AUTH_FAILED' || err.code === 'AI_UNAVAILABLE' || err.code === 'AI_TIMEOUT' || err.code === 'AI_UNKNOWN') {
    return err.message && /[\u0600-\u06FF]/.test(String(err.message))
      ? String(err.message)
      : 'المساعد الذكي غير متاح مؤقتاً. جرّب بعد لحظات أو راجع التشخيص في لوحة التحكم.';
  }
  var msg = err.message || String(err);
  if (/credit balance is too low|purchase credits|Plans & Billing|insufficient.?credit/i.test(msg)) {
    return 'المساعد الذكي غير متاح مؤقتاً بسبب نفاد رصيد مزوّد الذكاء الاصطناعي. تابع التشخيص من لوحة التحكم، أو أعد المحاولة لاحقاً.';
  }
  if (/Another sync is already in progress|Waiting — another sync/i.test(msg)) {
    return 'المزامنة قيد التشغيل — ستتحدّث بياناتك تلقائياً عند الانتهاء.';
  }
  if (/Meta \d{3}:|OAuthException|"type"\s*:\s*"OAuthException"/i.test(msg)) {
    return 'تعذّر التواصل مع Meta الآن — حاول مجدداً بعد لحظات.';
  }
  if (/DASHBOARD_TIMEOUT|dashboard timed out|انتهت مهلة تحميل اللوحة/i.test(msg) || err.code === 'DASHBOARD_TIMEOUT') {
    return 'انتهت مهلة تحميل اللوحة — حاول مجدداً بعد لحظات.';
  }
  if (/timed out/i.test(msg)) return 'انتهت مهلة الطلب — تحقق من اتصالك وحاول مجدداً.';
  if (/non-JSON response/i.test(msg)) return 'استجابة غير متوقعة من الخادم — أعد تحميل الصفحة.';
  if (/token has expired|please reconnect/i.test(msg)) {
    return 'انتهت صلاحية رمز Meta. أعد الربط من إعدادات مساحة العمل.';
  }
  if (/finish in the background|still running in the background/i.test(msg)) {
    return 'المزامنة تعمل في الخلفية — ستتحدّث لوحة التحكم قريباً.';
  }
  if (/Insufficient permissions/i.test(msg)) return 'تحتاج صلاحية مدير أو مالك لمزامنة البيانات.';
  if (/No ad account/i.test(msg)) return 'اربط حساب Meta الإعلاني من إعدادات مساحة العمل أولاً.';
  // Never show raw Anthropic / provider JSON blobs in the UI.
  if (/invalid_request_error|"type"\s*:\s*"error"|request_id|anthropic/i.test(msg)) {
    return 'المساعد الذكي غير متاح مؤقتاً. جرّب بعد لحظات أو راجع التشخيص في لوحة التحكم.';
  }
  return msg;
}

function creativeImgFailed(img) {
  if (!img) return;
  img.classList.add('meta-img-failed');
  img.style.display = 'none';
  var ph = img.parentNode && img.parentNode.querySelector('.meta-img-placeholder');
  if (ph) ph.remove();
  var box = img.parentNode && img.parentNode.querySelector('.meta-img-fallback, .inspector-creative-fallback');
  if (box) { box.style.display = 'flex'; box.classList.add('visible'); }
}
function creativeImgLoaded(img) {
  if (!img) return;
  img.classList.remove('meta-img-loading');
  var ph = img.parentNode && img.parentNode.querySelector('.meta-img-placeholder');
  if (ph) ph.remove();
}

function buildIssueMarkerDataset(labels, isoDates, issueDates) {
  if (!Array.isArray(issueDates) || !issueDates.length) return null;
  var severityColor = { CRITICAL: '#C7382A', HIGH: '#E2604F', MEDIUM: '#C77A1F', LOW: '#746A5C' };
  var isoToIndex = {};
  isoDates.forEach(function (d, i) { isoToIndex[d] = i; });
  var points = [], pointDates = [], colors = [];
  issueDates.forEach(function (iss) {
    var idx = isoToIndex[iss.date];
    if (idx == null) return;
    points.push({ x: labels[idx], y: 0 });
    pointDates.push(iss.date);
    colors.push(severityColor[iss.severity] || '#746A5C');
  });
  if (!points.length) return null;
  return {
    type: 'scatter', label: 'مشاكل مكتشفة', data: points,
    pointDates: pointDates, isIssueMarkers: true,
    backgroundColor: colors, pointRadius: 6, pointHoverRadius: 8,
    showLine: false, order: 0,
  };
}

var syncUiState = { polling: false, activeJobId: null };
function syncStorageKey(wsId) { return 'adlytic_active_sync_' + (wsId || ''); }
function rememberActiveSyncJob(wsId, jobId) {
  try { sessionStorage.setItem(syncStorageKey(wsId), jobId); } catch (e) {}
}
function clearActiveSyncJob(wsId) {
  try { sessionStorage.removeItem(syncStorageKey(wsId)); } catch (e) {}
}
function getRememberedSyncJob(wsId) {
  try { return sessionStorage.getItem(syncStorageKey(wsId)); } catch (e) { return null; }
}

function ensureSyncStatusBar(containerId) {
  var host = document.getElementById(containerId);
  if (!host) return null;
  var bar = document.getElementById('sync-status-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sync-status-bar';
    bar.className = 'sync-status-bar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = '<div class="sync-status-inner">'
      + '<span class="sync-status-spinner" aria-hidden="true"></span>'
      + '<span class="sync-status-text" id="sync-status-text">Syncing data…</span>'
      + '<div class="sync-status-progress" aria-hidden="true"><div class="sync-status-progress-bar" id="sync-status-progress-bar"></div></div>'
      + '<span class="sync-status-meta" id="sync-status-meta"></span>'
      + '</div>';
    host.insertBefore(bar, host.firstChild);
  }
  return bar;
}
function updateSyncStatusBar(job, reused) {
  var bar = document.getElementById('sync-status-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  var text = document.getElementById('sync-status-text');
  var progBar = document.getElementById('sync-status-progress-bar');
  var meta = document.getElementById('sync-status-meta');
  var pct = (job && job.progress != null) ? Number(job.progress) : 0;
  if (job && job.chunksTotal > 0) {
    pct = Math.max(pct, Math.round((job.chunksDone / job.chunksTotal) * 100));
  }
  if (text) {
    text.textContent = (reused && pct < 5)
      ? 'مزامنة تلقائية في الخلفية…'
      : ('جارٍ مزامنة البيانات…' + (pct > 0 ? ' (' + pct + '%)' : ''));
  }
  if (progBar) progBar.style.width = Math.max(4, Math.min(100, pct)) + '%';
  if (meta) meta.textContent = (job && job.rowsUpserted > 0) ? (job.rowsUpserted + ' صف تم تحميله') : '';
}
function hideSyncStatusBar() {
  var bar = document.getElementById('sync-status-bar');
  if (bar) bar.style.display = 'none';
}
function setSyncButtonsDisabled(disabled, selector) {
  var sel = selector || '.js-sync-trigger, #force-sync-btn, .sync-now-btn';
  document.querySelectorAll(sel).forEach(function (btn) {
    btn.disabled = !!disabled;
    if (disabled && btn.id === 'force-sync-btn') {
      btn.dataset.prevLabel = btn.dataset.prevLabel || btn.textContent;
      btn.innerHTML = '<span class="sync-status-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>Syncing…';
    } else if (!disabled && btn.id === 'force-sync-btn' && btn.dataset.prevLabel) {
      btn.textContent = btn.dataset.prevLabel;
    }
  });
}

async function runWorkspaceSync(workspaceId, opts) {
  opts = opts || {};
  if (syncUiState.polling && !opts.force) return null;
  var statusContainerId = opts.statusContainerId || 'main-content';
  ensureSyncStatusBar(statusContainerId);
  setSyncButtonsDisabled(true, opts.buttonSelector);
  syncUiState.polling = true;
  try {
    var res = await apiFetch('/api/workspaces/' + workspaceId + '/sync', {
      method: 'POST',
      body: JSON.stringify(opts.body || {}),
    });
    if (!res || !res.jobId) {
      toast('بدأت المزامنة', 'info');
      return res;
    }
    if (res.reused) toast('مزامنة تلقائية في الخلفية…', 'info');
    rememberActiveSyncJob(workspaceId, res.jobId);
    syncUiState.activeJobId = res.jobId;
    updateSyncStatusBar({ progress: 0, chunksDone: 0, chunksTotal: 0 }, !!res.reused);
    var job = await pollSyncJob(res.jobId, {
      onProgress: function (j) {
        updateSyncStatusBar(j, !!res.reused);
        if (opts.onProgress) try { opts.onProgress(j); } catch (e) {}
      },
    });
    clearActiveSyncJob(workspaceId);
    if (opts.onComplete) try { opts.onComplete(job); } catch (e) {}
    return job;
  } finally {
    syncUiState.polling = false;
    syncUiState.activeJobId = null;
    hideSyncStatusBar();
    setSyncButtonsDisabled(false, opts.buttonSelector);
  }
}

async function resumeActiveSyncIfAny(workspaceId, opts) {
  opts = opts || {};
  var jobId = getRememberedSyncJob(workspaceId);
  if (!jobId || syncUiState.polling) return null;
  try {
    var job = await apiFetchWithTimeout('/api/sync-jobs/' + encodeURIComponent(jobId), {}, 5000);
    var active = job && (job.status === 'PENDING' || job.status === 'PROCESSING' || job.status === 'RUNNING' || job.status === 'IN_PROGRESS');
    if (!active) { clearActiveSyncJob(workspaceId); return null; }
    // Skip stale jobs — if created more than 10 min ago and still "active",
    // it's likely stuck. Don't block page load polling a zombie job.
    if (job.createdAt) {
      var ageMs = Date.now() - new Date(job.createdAt).getTime();
      if (ageMs > 10 * 60 * 1000) { clearActiveSyncJob(workspaceId); return null; }
    }
    ensureSyncStatusBar(opts.statusContainerId || 'main-content');
    setSyncButtonsDisabled(true, opts.buttonSelector);
    syncUiState.polling = true;
    updateSyncStatusBar(job, true);
    var completed = await pollSyncJob(jobId, {
      onProgress: function (j) { updateSyncStatusBar(j, true); if (opts.onProgress) try { opts.onProgress(j); } catch (e) {} },
    });
    clearActiveSyncJob(workspaceId);
    if (opts.onComplete) try { opts.onComplete(completed); } catch (e) {}
    return completed;
  } catch (err) {
    clearActiveSyncJob(workspaceId);
    return null;
  } finally {
    syncUiState.polling = false;
    hideSyncStatusBar();
    setSyncButtonsDisabled(false, opts.buttonSelector);
  }
}

var shellState = { me: null, ready: false, initPromise: null };
var SHELL_LOADING = 'جارٍ التحميل…';

function shellInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
}

function populateAppShell(me) {
  var nameEl = document.getElementById('user-name');
  var emailEl = document.getElementById('user-email');
  var avEl = document.getElementById('user-avatar-initials');
  var wsEl = document.getElementById('ws-name');
  var adminNav = document.querySelector('.nav-item-admin');
  if (!me) {
    if (nameEl && nameEl.textContent === SHELL_LOADING) nameEl.textContent = 'مستخدم';
    if (emailEl && !emailEl.textContent) emailEl.textContent = '';
    if (avEl && avEl.textContent === '?') avEl.textContent = '?';
    if (wsEl && wsEl.textContent === SHELL_LOADING) wsEl.textContent = 'مساحة العمل';
    if (adminNav) adminNav.style.display = 'none';
    return;
  }
  var userName = me.name || me.email || 'مستخدم';
  if (avEl) avEl.textContent = shellInitials(userName);
  if (nameEl) nameEl.textContent = userName;
  if (emailEl) emailEl.textContent = me.email || '';
  if (adminNav) adminNav.style.display = me.isPlatformAdmin ? '' : 'none';
  if (wsEl) {
    var wsId = getWsId();
    var membership = Array.isArray(me.memberships)
      ? me.memberships.find(function (m) {
          return m.workspaceId === wsId || (m.workspace && m.workspace.id === wsId);
        }) || me.memberships[0]
      : null;
    var wsName = membership && membership.workspace && membership.workspace.name;
    if (!wsName && wsId) wsName = wsId;
    wsEl.textContent = wsName || 'مساحة العمل';
  }
}

function initAppShell() {
  if (!getToken()) return Promise.resolve(null);
  if (shellState.initPromise) return shellState.initPromise;
  shellState.initPromise = (async function () {
    try {
      var me = await apiFetchWithTimeout('/api/auth/me', {}, 8000);
      if (me && me.isActive === false) {
        window.location.href = '/pending-activation';
        return null;
      }
      // ── Single source of truth for the active workspace ────────────────
      // /api/auth/me is authoritative for which workspaces this token owns.
      // If the stored adlytic_workspace_id is NOT one of them (a stale value
      // left over from a previous account, or never set), reset it to the
      // user's first membership. This prevents workspace-mixing where API
      // calls carry a workspaceId that belongs to a different account.
      reconcileWorkspace(me);
      shellState.me = me;
      populateAppShell(me);
      return me;
    } catch (err) {
      console.warn('[shell] user init failed:', err);
      populateAppShell(null);
      return null;
    } finally {
      shellState.ready = true;
    }
  })();
  return shellState.initPromise;
}

/** Redirect inactive users to the pending-activation page. Returns false when blocked. */
async function ensureAccountActive() {
  if (!getToken()) { window.location.href = '/login'; return false; }
  try {
    var me = await apiFetch('/api/auth/me');
    if (!me) return false;
    if (me.isActive === false) {
      window.location.href = '/pending-activation';
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[shell] ensureAccountActive failed:', err);
    return false;
  }
}

function startShellLoadingFallback(ms) {
  setTimeout(function () {
    var nameEl = document.getElementById('user-name');
    if (nameEl && nameEl.textContent === SHELL_LOADING) populateAppShell(shellState.me);
  }, ms || 5000);
}

/** Force-hide a page loading overlay after timeout (id pairs: loading + content). */
function forceRevealAfterTimeout(loadingId, contentId, ms) {
  setTimeout(function () {
    var loadingEl = loadingId ? document.getElementById(loadingId) : null;
    if (!loadingEl || loadingEl.style.display === 'none') return;
    console.warn('[shell] loading safety timeout — revealing', loadingId || 'page');
    loadingEl.style.display = 'none';
    if (contentId) {
      var contentEl = document.getElementById(contentId);
      if (contentEl) contentEl.style.display = 'block';
    }
  }, ms || 5000);
}

function toast(msg, type = 'info') {
  var container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

var TOKEN_DECRYPT_PAGES = ['/dashboard', '/campaigns', '/workspace'];

function shouldShowTokenDecryptBanner() {
  var path = window.location.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!path) path = '/';
  return TOKEN_DECRYPT_PAGES.indexOf(path) >= 0;
}

function showTokenDecryptBanner(payload) {
  var banner = document.getElementById('token-decrypt-banner');
  if (!banner) return;
  var msgEl = document.getElementById('token-decrypt-banner-msg');
  var linkEl = document.getElementById('token-decrypt-banner-cta');
  if (msgEl) msgEl.textContent = payload.error || payload.message || 'Stored Meta token could not be decrypted.';
  if (linkEl) {
    linkEl.href = payload.reconnectUrl || '/workspace?connect=manual';
    linkEl.textContent = payload.reconnectLabel || 'Reconnect Meta';
  }
  banner.classList.add('visible');
  banner.setAttribute('aria-hidden', 'false');
}

function hideTokenDecryptBanner() {
  var banner = document.getElementById('token-decrypt-banner');
  if (!banner) return;
  banner.classList.remove('visible');
  banner.setAttribute('aria-hidden', 'true');
}

async function checkTokenDecryptBanner() {
  if (!getToken() || !shouldShowTokenDecryptBanner()) return;
  var wsId = getWsId();
  if (!wsId) return;
  try {
    var res = await fetch('/api/workspaces/' + wsId + '/token-health', {
      headers: { Authorization: 'Bearer ' + getToken() },
    });
    if (res.status === 503) {
      var body = await res.json().catch(function () { return {}; });
      if (body && body.code === 'TOKEN_DECRYPT_FAILED') {
        showTokenDecryptBanner(body);
        return;
      }
    }
    if (res.ok) {
      hideTokenDecryptBanner();
      try { sessionStorage.removeItem('adlytic_token_decrypt_banner_dismissed'); } catch (e) {}
    }
  } catch (err) {
    console.warn('[shell] token-health check failed:', err);
  }
}

function initTokenDecryptBanner() {
  var dismiss = document.getElementById('token-decrypt-banner-dismiss');
  if (dismiss) {
    dismiss.addEventListener('click', function () {
      hideTokenDecryptBanner();
      try { sessionStorage.setItem('adlytic_token_decrypt_banner_dismissed', getWsId() || '1'); } catch (e) {}
    });
  }
  var wsId = getWsId();
  var dismissed = false;
  try { dismissed = sessionStorage.getItem('adlytic_token_decrypt_banner_dismissed') === wsId; } catch (e) {}
  if (!dismissed) checkTokenDecryptBanner();
}

function fmt(n, decimals = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString(undefined, { useGrouping: false, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(n) { if (n == null) return '—'; return Number(n).toFixed(1) + '%'; }
// factor: minor-unit factor for the currency (100 for USD/EUR/…, 1 for IQD).
// Defaults to currency === 'IQD' ? 1 : 100 so legacy callers that don't pass
// a factor still produce the same output as before this change.
function fmtMoney(n, currency, factor) {
  if (n == null) return '—';
  if (factor == null) factor = currency === 'IQD' ? 1 : 100;
  var major = Number(n) / factor;
  if (factor === 1) return Math.round(major).toLocaleString(undefined, { useGrouping: false }) + ' ' + (currency || '');
  return major.toLocaleString(undefined, { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (currency || '');
}

function deltaClass(dir, goodWhenUp) {
  if (dir === 'flat') return 'flat';
  if (dir === 'up' && goodWhenUp)  return 'up-good';
  if (dir === 'up' && !goodWhenUp) return 'up-bad';
  if (dir === 'down' && goodWhenUp)  return 'down-bad';
  return 'down-good';
}
function deltaArrow(dir) {
  if (dir === 'up') return '↑';
  if (dir === 'down') return '↓';
  return '→';
}
function deltaLabel(kpi) {
  if (kpi.deltaPct == null) return '';
  return deltaArrow(kpi.direction) + ' ' + Math.abs(kpi.deltaPct * 100).toFixed(1) + '%';
}

function severityBadge(s) {
  const map = { LOW:'badge-gray', MEDIUM:'badge-yellow', HIGH:'badge-yellow', CRITICAL:'badge-red' };
  return '<span class="badge ' + (map[s]||'badge-gray') + '">' + s + '</span>';
}
function statusBadge(s) {
  const map = { ACTIVE:'badge-green', PAUSED:'badge-yellow', ARCHIVED:'badge-gray', DELETED:'badge-red' };
  const labels = { ACTIVE:'نشطة', PAUSED:'متوقفة', ARCHIVED:'مؤرشفة', DELETED:'محذوفة' };
  return '<span class="badge ' + (map[s]||'badge-gray') + '">' + (labels[s] || s || '—') + '</span>';
}

/**
 * Switch dashboard mode (pro / beginner) by POSTing the chosen mode to the
 * backend, which writes a Set-Cookie response. We then hard-reload so the
 * next /dashboard render picks the right page renderer. We do NOT optimistically
 * swap CSS — the two views are entirely different markup served by different
 * Hono routes; only a server-side render can produce the right page.
 */
async function setDashboardMode(mode) {
  try {
    await fetch('/api/dashboard-mode', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode }),
    });
  } catch (err) {
    console.warn('[mode-toggle] failed to persist mode:', err);
  }
  window.location.reload();
}

// Expose shared helpers on window for page-specific inline scripts (strict IIFEs).
window.getToken = getToken;
window.getWsId = getWsId;
window.setWsId = setWsId;
window.logout = logout;
window.apiFetch = apiFetch;
window.apiFetchWithTimeout = apiFetchWithTimeout;
window.initAppShell = initAppShell;
window.toast = toast;
window.friendlyApiError = friendlyApiError;
window.creativeImgFailed = creativeImgFailed;
window.creativeImgLoaded = creativeImgLoaded;
// ── Number ticker (Magic UI number-ticker port) ──────────────────────────
// Animates the numeric token inside finalText (e.g. "1,234.56 USD") from the
// element's current number to the target over ~700ms ease-out-cubic, keeping
// any prefix/suffix. Falls back to instant set under reduced motion.
function tickText(el, finalText) {
  if (!el) return;
  var target = String(finalText);
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var m = target.match(/-?[\d,]+(?:\.\d+)?/);
  if (reduced || !m) { el.textContent = target; return; }
  var endNum = parseFloat(m[0].replace(/,/g, ''));
  if (!isFinite(endNum)) { el.textContent = target; return; }
  var decimals = (m[0].split('.')[1] || '').length;
  var prefix = target.slice(0, m.index);
  var suffix = target.slice(m.index + m[0].length);
  var cur = (el.textContent || '').match(/-?[\d,]+(?:\.\d+)?/);
  var startNum = cur ? parseFloat(cur[0].replace(/,/g, '')) : 0;
  if (!isFinite(startNum) || startNum === endNum) { el.textContent = target; return; }
  var t0 = performance.now(), DUR = 700;
  function frame(now) {
    var t = Math.min(1, (now - t0) / DUR);
    var eased = 1 - Math.pow(1 - t, 3);
    var v = startNum + (endNum - startNum) * eased;
    el.textContent = prefix + v.toLocaleString('en-US', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }) + suffix;
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = target;
  }
  requestAnimationFrame(frame);
}

// ── Stagger reveal (Magic UI blur-fade port) ──────────────────────────────
// Call AFTER the page container becomes visible. Each selector gets the
// blur-fade entrance with a 70ms stagger. No-op under reduced motion.
function staggerReveal(selectors) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var i = 0;
  selectors.forEach(function (sel) {
    var el = document.querySelector(sel);
    if (!el || el.classList.contains('reveal')) return;
    el.style.animationDelay = (i * 70) + 'ms';
    el.classList.add('reveal');
    requestAnimationFrame(function () { el.classList.add('reveal-in'); });
    i++;
  });
}
window.tickText = tickText;
window.staggerReveal = staggerReveal;
window.runWorkspaceSync = runWorkspaceSync;
window.resumeActiveSyncIfAny = resumeActiveSyncIfAny;
window.checkTokenDecryptBanner = checkTokenDecryptBanner;
window.pollSyncJob = pollSyncJob;
window.severityBadge = severityBadge;
window.statusBadge = statusBadge;

// Global ripple: coordinates the click origin for the .btn::after glow.
document.addEventListener('pointerdown', function (e) {
  var btn = e.target && e.target.closest ? e.target.closest('.btn') : null;
  if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;
  var rect = btn.getBoundingClientRect();
  btn.style.setProperty('--rx', ((e.clientX - rect.left) / rect.width * 100) + '%');
  btn.style.setProperty('--ry', ((e.clientY - rect.top) / rect.height * 100) + '%');
  btn.classList.remove('is-rippling');
  void btn.offsetWidth;
  btn.classList.add('is-rippling');
  setTimeout(function () { btn.classList.remove('is-rippling'); }, 520);
}, true);

// ── Metric glossary / "Explain" popover ─────────────────────────────────
// Static, zero-network-cost content — every metric tile across the app can
// attach data-metric-info="<key>" to a .info-btn and get a definition +
// formula + healthy range + common causes without a new endpoint or an LLM
// call. Kept in Arabic to match the rest of the static chrome (sidebar,
// topbar, page titles are all Arabic regardless of the user's AI-chat
// locale — only AI-generated conversational replies are locale-detected).
var METRIC_GLOSSARY = {
  spend: {
    label: 'المبلغ المنفق (Amount Spent)',
    def: 'إجمالي المبلغ الذي أنفقته حملاتك الإعلانية خلال الفترة المحددة، كما تُبلغ عنه Meta.',
    formula: 'مجموع الإنفاق اليومي لكل الحملات النشطة خلال الفترة.',
    range: 'لا يوجد مدى صحي عام — يُقارن دائماً بالنتائج التي يحققها (تكلفة النتيجة، العائد).',
    causes: ['ميزانية حملة رُفعت يدوياً', 'حملة جديدة دخلت مرحلة التعلم', 'Meta وسّع الاستهداف تلقائياً'],
  },
  ctr: {
    label: 'معدل النقر إلى الظهور (CTR)',
    def: 'نسبة الأشخاص الذين نقروا على إعلانك من إجمالي من شاهدوه.',
    formula: 'النقرات ÷ مرات الظهور × 100',
    range: '1.5%+ يُعتبر جيداً لمعظم الأهداف؛ أقل من 1% يشير غالباً إلى إعلان أو استهداف ضعيف.',
    causes: ['الإعلان أصبح متعباً (نفس الإبداع لفترة طويلة)', 'الرسالة الإعلانية غير مناسبة للجمهور المستهدف', 'استهداف واسع جداً يقلل من الصلة'],
  },
  cpm: {
    label: 'التكلفة لكل 1000 ظهور (CPM)',
    def: 'المبلغ الذي تدفعه مقابل كل 1000 مرة ظهور لإعلانك.',
    formula: '(الإنفاق ÷ مرات الظهور) × 1000',
    range: 'يختلف حسب البلد والقطاع؛ ارتفاع مفاجئ بنسبة 20% أو أكثر يستحق المراجعة.',
    causes: ['منافسة أعلى في مزاد Meta', 'جمهور مُشبع (تكرار مرتفع)', 'جودة إعلان منخفضة تجعل Meta يتقاضى أكثر'],
  },
  cpc: {
    label: 'التكلفة لكل نقرة (CPC)',
    def: 'متوسط ما تدفعه مقابل كل نقرة يحصل عليها إعلانك.',
    formula: 'الإنفاق ÷ النقرات',
    range: 'يختلف حسب القطاع والهدف؛ يُقرأ دائماً مع CTR — CPC مرتفع مع CTR منخفض يعني مزاداً مكلفاً بلا تفاعل.',
    causes: ['CTR منخفض يرفع تكلفة كل نقرة', 'منافسة مرتفعة على نفس الجمهور', 'موضع إعلان أغلى (مثل Stories)'],
  },
  cost_per_result: {
    label: 'التكلفة لكل نتيجة (Cost per Result)',
    def: 'متوسط التكلفة للوصول إلى هدف التحسين المحدد للحملة (شراء، رسالة، عميل محتمل...).',
    formula: 'الإنفاق ÷ عدد النتائج',
    range: 'يُقارن دائماً بقيمة النتيجة نفسها (هامش الربح، قيمة العميل) — لا يوجد رقم صحي مطلق.',
    causes: ['معدل التحويل بعد النقر انخفض (صفحة الهبوط/المتجر)', 'الجمهور أقل صلة بالعرض', 'إعداد التتبّع (Pixel) لا يبلّغ كل النتائج'],
  },
  roas: {
    label: 'العائد على الإنفاق الإعلاني (ROAS)',
    def: 'قيمة الإيراد الذي تحققه مقابل كل وحدة عملة تنفقها.',
    formula: 'الإيراد ÷ الإنفاق',
    range: 'أعلى من 2x يُعتبر مربحاً لمعظم المتاجر؛ أقل من 1x يعني خسارة مباشرة على مستوى الإعلان.',
    causes: ['نافذة الإسناد لا تلتقط كل عمليات الشراء', 'انخفاض في معدل التحويل أو قيمة الطلب', 'ارتفاع تكلفة الوصول (CPM) دون تحسّن مقابل في النتائج'],
  },
  frequency: {
    label: 'معدل التكرار (Frequency)',
    def: 'متوسط عدد مرات مشاهدة الشخص الواحد لإعلانك خلال الفترة.',
    formula: 'مرات الظهور ÷ الوصول',
    range: 'أقل من 3 صحي عادةً؛ أعلى من 5 غالباً يعني إعلاناً متعباً يستحق تحديث الإبداع أو توسيع الجمهور.',
    causes: ['جمهور مستهدف ضيق جداً', 'ميزانية مرتفعة بالنسبة لحجم الجمهور', 'الحملة تعمل منذ فترة طويلة بدون تحديث'],
  },
  reach: {
    label: 'الوصول (Reach)',
    def: 'عدد الأشخاص الفريدين الذين شاهدوا إعلانك مرة واحدة على الأقل خلال الفترة.',
    formula: 'عدّ فريد لهويات المستخدمين المعروضة عليهم الإعلان (وليس مجموع مرات الظهور).',
    range: 'يُقرأ دائماً مع التكرار — وصول منخفض مع تكرار مرتفع يعني أن الجمهور المستهدف صغير جداً.',
    causes: ['استهداف ضيق جداً', 'ميزانية منخفضة نسبة لحجم الجمهور', 'موضع إعلان واحد فقط مفعّل'],
  },
  impressions: {
    label: 'مرات الظهور (Impressions)',
    def: 'إجمالي عدد المرات التي ظهر فيها إعلانك على الشاشة، بما يشمل ظهوره أكثر من مرة لنفس الشخص.',
    formula: 'مجموع كل عرض للإعلان، بلا استثناء التكرار.',
    range: 'لا يوجد مدى صحي مستقل — يُقرأ دائماً مقابل الإنفاق (CPM) أو الوصول (التكرار).',
    causes: [],
  },
  health_score: {
    label: 'درجة صحة الحملة',
    def: 'مقياس خاص بـ Adlytic (وليس من Meta مباشرة) يجمع بين اتجاه الإنفاق، معدل النقر، والتكرار في رقم واحد من 100 لإعطائك نظرة سريعة على حالة الحملة.',
    formula: 'متوسط مرجّح لعدة إشارات أداء داخلية، يُعاد حسابه مع كل مزامنة بيانات جديدة.',
    range: '80+ ممتاز، 60-79 مقبول ويستحق مراقبة، أقل من 60 يستحق مراجعة فورية.',
    causes: [],
  },
  cost_per_messaging_conversation: {
    label: 'تكلفة محادثة المراسلة',
    def: 'متوسط التكلفة لكل محادثة تم بدؤها عبر رسائل الإعلان (Messenger أو WhatsApp).',
    formula: 'الإنفاق ÷ عدد محادثات المراسلة التي بدأها المستخدمون',
    range: 'يختلف حسب القطاع — يُقارن بأداء المحادثة نفسها (هل تتحول إلى مبيعات فعلية؟).',
    causes: ['رسالة الترحيب الآلية بطيئة أو غير واضحة', 'الجمهور المستهدف غير جاهز للتفاعل المباشر', 'إعلان يدفع نحو المراسلة لكن بعرض غير مقنع'],
  },
  clicks: {
    label: 'النقرات (Clicks)',
    def: 'إجمالي عدد النقرات التي حصل عليها إعلانك (روابط، صور، أزرار الدعوة لاتخاذ إجراء).',
    formula: 'مجموع كل نقرة مسجّلة على عناصر الإعلان القابلة للنقر.',
    range: 'يُقرأ دائماً مع مرات الظهور (CTR) — لا يوجد رقم صحي مستقل.',
    causes: [],
  },
  messages: {
    label: 'محادثات الرسائل (Messaging Conversations)',
    def: 'عدد محادثات المراسلة التي بدأها المستخدمون استجابة لإعلانك.',
    formula: 'مجموع محادثات المراسلة الجديدة المنسوبة للإعلان خلال الفترة.',
    range: 'يُقارن بتكلفة محادثة المراسلة ومعدل تحوّلها إلى مبيعات.',
    causes: [],
  },
  purchases: {
    label: 'المشتريات (Purchases)',
    def: 'عدد عمليات الشراء المنسوبة لإعلانك خلال نافذة الإسناد.',
    formula: 'مجموع أحداث الشراء المنسوبة للحملة.',
    range: 'يُقرأ مع تكلفة الشراء وROAS — لا يوجد رقم صحي مستقل.',
    causes: [],
  },
  leads: {
    label: 'العملاء المحتملون (Leads)',
    def: 'عدد العملاء المحتملين (نماذج أو أحداث Lead) المنسوبين لإعلانك.',
    formula: 'مجموع أحداث العملاء المحتملين المنسوبة للحملة.',
    range: 'يُقارن بتكلفة العميل المحتمل وجودة المتابعة بعد النموذج.',
    causes: [],
  },
};

// ── Smart Context Actions ────────────────────────────────────────────────
// A lookup table, not a rules engine: which IssueCode (from the schema's
// IssueCode enum — see prisma/schema.prisma) drives which metric, and which
// 1-3 actions make sense once that issue is active. Deliberately NOT an LLM
// decision — the issue code already fully determines the right actions, so
// spending a model call to reproduce that would just add latency for the
// same answer. See PHASE3_IFA_DESIGN.md §2.
var METRIC_TO_ISSUE_CODES = {
  ctr: ['LOW_CTR', 'AUDIENCE_FATIGUE'],
  cpm: ['HIGH_CPM'],
  frequency: ['HIGH_FREQUENCY', 'AUDIENCE_FATIGUE'],
  spend: ['BUDGET_BURNING_FAST'],
  reach: ['LOW_REACH'],
  cost_per_result: ['RISING_COST_PER_RESULT'],
  cost_per_messaging_conversation: ['RISING_COST_PER_RESULT'],
  messages: ['DECLINING_RESULTS', 'STALLED_DELIVERY'],
  roas: ['DECLINING_RESULTS'],
};

var ACTIONS_BY_ISSUE = {
  LOW_CTR: [
    { label: 'تحليل التصميم', question: 'الإعلان لا يجذب نقرات كافية — اشرح لي ببساطة السبب، ماذا أفعل الآن خطوة بخطوة، ومتى أراجع النتيجة؟' },
    { label: 'جودة الجمهور', question: 'هل استهداف الجمهور هو سبب ضعف النقرات؟ اشرح لي ببساطة وماذا أغيّر أولاً.' },
  ],
  HIGH_CPM: [
    { label: 'تحليل تكلفة الوصول', question: 'تكلفة الوصول مرتفعة في حملتي — اشرح السبب ببساطة، ماذا أفعل الآن، ومتى أراجع؟' },
    { label: 'تشبع الجمهور', question: 'هل جمهوري مُشبع وهذا يرفع تكلفة الوصول؟ حلّل مرات الظهور لنفس الشخص وحجم الجمهور، ثم أعطني مهمة واضحة.' },
  ],
  HIGH_FREQUENCY: [
    { label: 'تحديث التصميم', question: 'نفس الأشخاص يرون الإعلان كثيراً — هل حان وقت تصميم جديد؟ أعطني خطوات عملية ومتى أراجع.' },
    { label: 'توسيع الجمهور', question: 'مرات الظهور لنفس الشخص مرتفعة — هل أوسّع الجمهور؟ اشرح القرار وخطوات التنفيذ.' },
  ],
  AUDIENCE_FATIGUE: [
    { label: 'تحليل التعب', question: 'أرى علامات تعب الجمهور من الإعلان — اشرح السبب الحقيقي، ماذا أفعل الآن، ومتى أراجع النتيجة؟' },
  ],
  DECLINING_RESULTS: [
    { label: 'لماذا التراجع', question: 'نتائج حملتي تتراجع — ما السبب الرئيسي؟ حوّل النصيحة إلى مهمة: فهم → قرار → خطوات → تحقق.' },
  ],
  BUDGET_BURNING_FAST: [
    { label: 'تحليل الإنفاق', question: 'ميزانيتي تُصرف أسرع من المتوقع — اشرح السبب وأعطني خطوة واحدة واضحة للتحكم، ومتى أراجع.' },
  ],
  LOW_REACH: [
    { label: 'توسيع الاستهداف', question: 'الوصول للجمهور محدود — هل الاستهداف ضيق؟ اقترح مهمة بسيطة للتنفيذ والمراجعة.' },
  ],
  RISING_COST_PER_RESULT: [
    { label: 'تحليل ما بعد النقرة', question: 'تكلفة كل نتيجة ترتفع رغم أن النقرات جيدة — هل المشكلة بعد النقرة؟ اشرح ببساطة وماذا أفعل الآن.' },
    { label: 'تتبع التحويل', question: 'تكلفة النتيجة مرتفعة — تحقق من التتبع وعملية الشراء، ثم أعطني مهمة واضحة للمراجعة.' },
  ],
  STALLED_DELIVERY: [
    { label: 'سبب توقف الظهور', question: 'حملتي توقفت عن الظهور أو ظهورها بطيء — ما السبب المحتمل؟ وما الخطوة الأولى الآن؟' },
  ],
};

// Returns an HTML chip row for the given metric key, or '' when no active
// issue maps to it. 'issues' is the dashboard DTO's already-fetched
// issues[] array ({ code, severity, ... }) — no new query, no new endpoint.
function renderContextActions(metricKey, issues, campaignName) {
  var codes = METRIC_TO_ISSUE_CODES[metricKey];
  if (!codes || !Array.isArray(issues) || !issues.length) return '';
  var severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  var match = null;
  issues.forEach(function (iss) {
    if (codes.indexOf(iss.code) === -1) return;
    if (!match || (severityRank[iss.severity] ?? 9) < (severityRank[match.severity] ?? 9)) match = iss;
  });
  if (!match) return '';
  var actions = ACTIONS_BY_ISSUE[match.code];
  if (!actions || !actions.length) return '';
  var suffix = campaignName ? (' (حملة: ' + campaignName + ')') : '';
  return '<div class="context-actions">' + actions.map(function (a) {
    var q = a.question + suffix;
    return '<a class="context-action-chip" href="/ai?q=' + encodeURIComponent(q) + '">' + a.label + '</a>';
  }).join('') + '</div>';
}

// ── Shared attribution-card renderer ────────────────────────────────────
// Extracted so both the dashboard's fixed 30-day attribution section and
// Timeline Explorer's per-spike click popover (a narrower, on-demand window)
// render identically instead of maintaining two copies of the same markup.
function renderAttributionCardHtml(attr, titleText) {
  var factors = [
    { key: 'impressions', label: 'الظهور (Impressions)', delta: attr.drivers.impressions.change },
    { key: 'ctr', label: 'نسبة النقر (CTR)', delta: attr.drivers.ctr.change },
    { key: 'cvr', label: 'نسبة التحويل (CVR)', delta: attr.drivers.cvr.change },
  ];
  return '<div class="attribution-card">'
    + '<div class="attribution-title">' + titleText + '</div>'
    + '<div class="attribution-bars">'
    + factors.map(function (f) {
        var cls = f.delta > 0.02 ? 'positive' : f.delta < -0.02 ? 'negative' : 'neutral';
        var fillColor = f.delta > 0.02 ? 'var(--success)' : f.delta < -0.02 ? 'var(--error)' : 'var(--text-3)';
        var pct = Math.min(Math.abs(f.delta * 100), 100);
        var isPrimary = f.key === attr.primaryDriver;
        return '<div class="attribution-factor">'
          + '<div class="attribution-factor-label">' + f.label + '</div>'
          + '<div class="attribution-factor-value ' + cls + '">'
            + (f.delta >= 0 ? '+' : '') + (f.delta * 100).toFixed(1) + '%'
          + '</div>'
          + '<div class="attribution-factor-bar"><div class="attribution-factor-fill" style="width:' + pct + '%;background:' + fillColor + ';"></div></div>'
          + (isPrimary ? '<div class="attribution-primary-tag">السبب الرئيسي</div>' : '')
        + '</div>';
      }).join('')
    + '</div>'
    + '<div class="attribution-narrative">' + escHtml(attr.narrative || '') + '</div>'
  + '</div>';
}

// ── Timeline Explorer — click-to-attribute popover ──────────────────────
// Fetches attributeChange()'s output for a single clicked day (vs the same
// weekday one week earlier) and renders it with the exact same markup as
// the dashboard's fixed-window attribution card. See PHASE3_IFA_DESIGN.md §3.
// When campaignId is available (e.g. an open campaign inspector), also asks
// "which creative drove this day" via get_creative_performance's single-day
// mode — a second, narrower lookup appended below the metric-level card.
async function openTimelineAttribution(dateIso, campaignId) {
  var overlay = document.getElementById('timeline-attribution-modal');
  var body = document.getElementById('timeline-attribution-body');
  if (!overlay || !body) return;
  body.innerHTML = '<div class="v2-action-empty">جارٍ التحليل…</div>';
  overlay.style.display = 'flex';
  var wsId = getWsId();
  try {
    var res = await apiFetch('/api/workspaces/' + wsId + '/attribution?date=' + dateIso);
    var html = renderAttributionCardHtml(res.attribution, 'سبب تغيّر النتائج — ' + dateIso);
    if (campaignId) {
      html += await renderCreativeAttributionHtml(wsId, campaignId, dateIso);
    }
    body.innerHTML = html;
  } catch (e) {
    var msg = String((e && e.message) || 'تعذّر تحليل هذا اليوم — بيانات غير كافية للمقارنة.')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    body.innerHTML = '<div class="v2-action-empty">' + msg + '</div>';
  }
}
// Best-effort — a thin ad set on a given day is expected to come back empty
// (totalAdsWithData: 0), which is rendered as "no data" rather than an error.
async function renderCreativeAttributionHtml(wsId, campaignId, dateIso) {
  try {
    var res = await apiFetch('/api/workspaces/' + wsId + '/campaigns/' + campaignId + '/creative-attribution?date=' + dateIso);
    if (!res.ranked || !res.ranked.length) return '';
    var rows = res.ranked.map(function (r) {
      var name = String(r.adName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="attribution-creative-row">'
        + '<span class="attribution-creative-rank">#' + r.rank + '</span>'
        + '<span class="attribution-creative-name">' + name + '</span>'
        + '<span class="attribution-creative-spend">' + r.metricDisplay + '</span>'
      + '</div>';
    }).join('');
    return '<div class="attribution-card attribution-creative-card">'
      + '<div class="attribution-title">أي إعلان يشتغل هذا اليوم</div>'
      + '<div class="attribution-creative-list">' + rows + '</div>'
    + '</div>';
  } catch (e) {
    return '';
  }
}
function closeTimelineAttribution() {
  var overlay = document.getElementById('timeline-attribution-modal');
  if (overlay) overlay.style.display = 'none';
}
window.openTimelineAttribution = openTimelineAttribution;
window.closeTimelineAttribution = closeTimelineAttribution;

// Data Lineage — relative-time formatter for the popover's source block.
// Deliberately coarse (minutes/hours/days) rather than exact timestamps:
// the point is "is this fresh enough to trust", not a precise clock.
function metricInfoRelativeTime(iso) {
  if (!iso) return null;
  var then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  var diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return 'قبل ' + diffMin + ' دقيقة';
  var diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return 'قبل ' + diffHr + ' ساعة';
  var diffDay = Math.round(diffHr / 24);
  return 'قبل ' + diffDay + ' يوم';
}

function renderMetricInfo(key, freshnessIso) {
  var m = METRIC_GLOSSARY[key];
  var body = document.getElementById('metric-info-body');
  var titleEl = document.getElementById('metric-info-title');
  if (!body || !titleEl) return;
  if (!m) { titleEl.textContent = 'المؤشر'; body.innerHTML = '<p style="color:var(--text-3);">لا يتوفر شرح لهذا المؤشر بعد.</p>'; return; }
  titleEl.textContent = m.label;
  var causesHtml = m.causes && m.causes.length
    ? '<div class="metric-info-block"><div class="metric-info-block-title">أسباب شائعة للتغيّر</div><ul class="metric-info-causes">' + m.causes.map(function (c) { return '<li>' + c + '</li>'; }).join('') + '</ul></div>'
    : '';
  var relTime = metricInfoRelativeTime(freshnessIso);
  var lineageHtml = relTime
    ? '<div class="metric-info-block"><div class="metric-info-block-title">مصدر البيانات</div><p>Meta Graph API · ads_insights<br>آخر تحديث: ' + relTime + '</p></div>'
    : '';
  body.innerHTML =
    '<div class="metric-info-block"><div class="metric-info-block-title">ما هو؟</div><p>' + m.def + '</p></div>' +
    '<div class="metric-info-block"><div class="metric-info-block-title">طريقة الحساب</div><div class="metric-info-formula">' + m.formula + '</div></div>' +
    '<div class="metric-info-block"><div class="metric-info-block-title">المدى الصحي</div><p>' + m.range + '</p></div>' +
    causesHtml + lineageHtml;
}

function openMetricInfo(key, freshnessIso) {
  renderMetricInfo(key, freshnessIso);
  var overlay = document.getElementById('metric-info-modal');
  if (overlay) overlay.style.display = 'flex';
}
function closeMetricInfo() {
  var overlay = document.getElementById('metric-info-modal');
  if (overlay) overlay.style.display = 'none';
}
window.openMetricInfo = openMetricInfo;

// Event delegation on document (not DOMContentLoaded) so info buttons that
// pages render client-side *after* their own data fetch — e.g. KPI tiles
// built once dashboard data arrives — work without each page wiring its own
// listener.
document.addEventListener('click', function (e) {
  var btn = e.target && e.target.closest ? e.target.closest('.info-btn[data-metric-info]') : null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openMetricInfo(btn.getAttribute('data-metric-info'), btn.getAttribute('data-freshness'));
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeMetricInfo();
});

function initSidebarNav() {
  var list = document.getElementById('nav-list');
  var indicator = document.getElementById('nav-indicator');
  if (!list || !indicator) return;

  var items = list.querySelectorAll('.nav-item');
  if (!items.length) return;

  function moveTo(el) {
    if (!el) return;
    var listRect = list.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var top = elRect.top - listRect.top + list.scrollTop;
    indicator.style.transform = 'translateY(' + top + 'px)';
    indicator.style.height = elRect.height + 'px';
    indicator.style.opacity = '1';
  }

  var active = list.querySelector('.nav-item.active');
  if (active) moveTo(active);

  items.forEach(function (item) {
    item.addEventListener('mouseenter', function () { moveTo(item); });
    item.addEventListener('focus', function () { moveTo(item); });
  });

  list.addEventListener('mouseleave', function () {
    var act = list.querySelector('.nav-item.active');
    if (act) moveTo(act);
    else indicator.style.opacity = '0';
  });

  window.addEventListener('resize', function () {
    var hovered = list.querySelector('.nav-item:hover');
    var act = list.querySelector('.nav-item.active');
    moveTo(hovered || act);
  });
}

function initModeToggle() {
  var toggle = document.querySelector('.mode-toggle');
  var indicator = document.getElementById('mode-toggle-indicator');
  if (!toggle || !indicator) return;

  function moveTo(btn) {
    if (!btn) return;
    var toggleRect = toggle.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    var offset = btnRect.left - toggleRect.left;
    indicator.style.width = btnRect.width + 'px';
    indicator.style.transform = 'translateX(' + offset + 'px)';
    indicator.style.opacity = '1';
  }

  var active = toggle.querySelector('.mode-toggle-btn.active');
  if (active) moveTo(active);

  window.addEventListener('resize', function () {
    var act = toggle.querySelector('.mode-toggle-btn.active');
    if (act) moveTo(act);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('open');
      document.getElementById('sidebar-overlay')?.classList.toggle('visible');
    }
  });
  // Overlay tap closes sidebar
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
  });
  // Mode toggle — both buttons are wired; clicking the already-active one is
  // a no-op (the server will reload the same page).
  document.querySelectorAll('.mode-toggle-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var m = btn.getAttribute('data-mode');
      if (m === 'pro' || m === 'beginner') setDashboardMode(m);
    });
  });
  if (getToken()) {
    initAppShell();
    initTokenDecryptBanner();
    startShellLoadingFallback(5000);
    initSidebarNav();
    initModeToggle();
  }
  // PWA Service Worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
`;

// ── Sidebar HTML ────────────────────────────────────────────────────────
export function sidebar(active: string): string {
  const nav = [
    { id: 'dashboard',       label: 'لوحة التحكم',      href: '/dashboard' },
    { id: 'campaigns',       label: 'الحملات',           href: '/campaigns' },
    { id: 'ad-analysis',     label: 'تحليل الإعلان',     href: '/ad-analysis' },
    { id: 'recommendations', label: 'المهام',          href: '/recommendations' },
    { id: 'workspace',       label: 'مساحة العمل',       href: '/workspace' },
    { id: 'ai',              label: 'المساعد الذكي',     href: '/ai' },
    { id: 'support',         label: 'الدعم',              href: '/support' },
    { id: 'settings',        label: 'الإعدادات',         href: '/settings' },
    { id: 'admin',           label: 'إدارة الإيرادات',   href: '/admin' },
  ];
  const links = nav.map(n => `
    <a href="${n.href}" class="nav-item${active === n.id ? ' active' : ''}${n.id === 'admin' ? ' nav-item-admin' : ''}" data-nav-id="${n.id}"${n.id === 'admin' ? ' style="display:none;"' : ''}>
      <span class="nav-item-icon" aria-hidden="true">${ICONS[n.id] ?? ''}</span>
      <span class="nav-item-label">${n.label}</span>
    </a>`).join('');

  return `
<aside class="sidebar" id="sidebar">
  <a href="/dashboard" class="sidebar-logo" aria-label="Adlytic — لوحة التحكم">
    <div class="sidebar-logo-mark">${logoSvg(38, 'sb')}</div>
    <div class="sidebar-logo-copy">
      <span class="sidebar-logo-text">Adlytic</span>
      <span class="sidebar-logo-tagline">ذكاء الإعلانات</span>
    </div>
  </a>
  <nav class="sidebar-nav" aria-label="التنقل الرئيسي">
    <div class="nav-section-label">القائمة الرئيسية</div>
    <div class="nav-list" id="nav-list">
      <div class="nav-indicator" id="nav-indicator" aria-hidden="true"></div>
      ${links}
    </div>
  </nav>
  <div class="sidebar-footer">
    <div class="nav-section-label sidebar-footer-label">الحساب</div>
    <div class="sidebar-footer-card">
      <a href="/settings" class="sidebar-user" id="sidebar-user" aria-label="إعدادات الحساب">
        <div class="avatar" id="user-avatar">
          <span class="avatar-initials" id="user-avatar-initials">?</span>
          <span class="avatar-status" title="متصل"></span>
        </div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name" id="user-name">Loading…</div>
          <div class="sidebar-user-email" id="user-email"></div>
        </div>
        <span class="sidebar-user-chevron" aria-hidden="true">${ICONS['chevron']}</span>
      </a>
      <div class="sidebar-footer-divider" aria-hidden="true"></div>
      <button type="button" class="sidebar-logout" id="logout-btn">
        <span class="sidebar-logout-icon" aria-hidden="true">${ICONS['logout']}</span>
        <span>تسجيل الخروج</span>
      </button>
    </div>
  </div>
</aside>`;
}

// ── Mobile Bottom Navigation ────────────────────────────────────────────
// Order matches the redesigned information architecture: the decision surface
// (dashboard), where the money goes (campaigns), the conversational shortcut
// (assistant), the creative diagnosis (ad analysis), and the execution list
// (tasks). Settings/support move to the topbar gear (see topbar()) so they
// stay one tap away without spending one of five scarce tab slots on them.
function mobileBottomNav(active: string): string {
  const items = [
    { id: 'dashboard', label: 'اللوحة', href: '/dashboard', icon: ICONS['dashboard'] },
    { id: 'campaigns', label: 'الحملات', href: '/campaigns', icon: ICONS['campaigns'] },
    { id: 'ai', label: 'المساعد', href: '/ai', icon: ICONS['ai'] },
    { id: 'ad-analysis', label: 'التحليل', href: '/ad-analysis', icon: ICONS['ad-analysis'] },
    { id: 'recommendations', label: 'المهام', href: '/recommendations', icon: ICONS['recommendations'] },
  ];
  return `<nav class="mobile-bottom-nav" aria-label="Mobile navigation">${items.map(it =>
    `<a href="${it.href}" class="mobile-nav-item${active === it.id ? ' active' : ''}">${it.icon}<span>${it.label}</span></a>`
  ).join('')}</nav>`;
}

// ── Topbar HTML ─────────────────────────────────────────────────────────
// `currentMode` selects which segment of the dashboard mode toggle is
// highlighted. When undefined, the toggle is not rendered (used for pages
// where the toggle is irrelevant — settings, login, register, etc.).
export function topbar(pageTitle: string, currentMode?: 'pro' | 'beginner'): string {
  const isBeginner = currentMode === 'beginner';
  const toggle = currentMode
    ? `<div class="mode-toggle" role="group" aria-label="وضع لوحة التحكم">
        <div class="mode-toggle-indicator" id="mode-toggle-indicator" aria-hidden="true"></div>
        <button class="mode-toggle-btn ${currentMode === 'pro' ? 'active' : ''}" data-mode="pro" id="mode-btn-pro" type="button">احترافي</button>
        <button class="mode-toggle-btn ${currentMode === 'beginner' ? 'active' : ''}" data-mode="beginner" id="mode-btn-beginner" type="button">مبتدئ</button>
      </div>`
    : '';
  // Beginner mode hides the pro sidebar — keep logout reachable from the topbar.
  const beginnerLogout = isBeginner
    ? `<button class="topbar-btn" type="button" id="logout-btn" title="تسجيل الخروج" aria-label="تسجيل الخروج">${ICONS['logout']}</button>`
    : `<button class="topbar-btn topbar-btn--bell" type="button" title="الإشعارات" aria-label="الإشعارات">${ICONS['bell']}</button>`;
  // Settings moved out of the 5-slot mobile bottom nav (see mobileBottomNav) to
  // make room for ad-analysis/tasks — this gear keeps it one tap away on every
  // page, mobile and desktop alike, without removing the sidebar's own link.
  const settingsBtn = isBeginner
    ? ''
    : `<a class="topbar-btn topbar-btn--settings" href="/settings" title="الإعدادات" aria-label="الإعدادات">${ICONS['settings']}</a>`;
  const menuBtn = isBeginner
    ? ''
    : `<button class="topbar-btn topbar-btn--menu mobile-menu-btn" id="mobile-menu-btn" type="button" aria-label="فتح القائمة">
    ${ICONS['menu']}
  </button>`;
  return `
<header class="topbar">
  ${menuBtn}
  <span class="topbar-title">${pageTitle}</span>
  <div class="topbar-actions">
    ${toggle}
    <div class="topbar-ws" id="ws-selector" title="تبديل مساحة العمل" role="button" tabindex="0">
      <span class="topbar-ws-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </span>
      <span class="topbar-ws-copy">
        <span class="topbar-ws-label">مساحة العمل</span>
        <span class="topbar-ws-name" id="ws-name">جارٍ التحميل…</span>
      </span>
      <span class="topbar-ws-chevron" aria-hidden="true">${ICONS['chevron']}</span>
    </div>
    ${settingsBtn}
    ${beginnerLogout}
  </div>
</header>`;
}

// ── Full page layout ────────────────────────────────────────────────────
// `mode` is set ONLY by the dashboard page renderers; other pages omit it and
// the toggle is hidden. The server is the source of truth for current mode
// (via cookie) — the rendered page already reflects the choice.
export function layout(opts: {
  title: string;
  active: string;
  content: string;
  scripts?: string;
  extraHead?: string;
  mode?: 'pro' | 'beginner';
}): string {
  const { title, active, content, scripts = '', extraHead = '', mode } = opts;
  const isBeginner = mode === 'beginner';
  // Beginner mode: no pro sidebar / bottom nav — focused beginner surface only.
  // Mode toggle in the topbar remains so the user can return to احترافي.
  const shellClass = isBeginner ? 'app-shell app-shell--beginner' : 'app-shell';
  const chromeSidebar = isBeginner ? '' : sidebar(active);
  const chromeOverlay = isBeginner ? '' : `<div id="sidebar-overlay" class="sidebar-overlay"></div>`;
  const chromeBottomNav = isBeginner ? '' : mobileBottomNav(active);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#100E0D">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icons/icon-192.svg">
  <title>${title} — Adlytic</title>
  <style>${SHARED_CSS}</style>
  ${extraHead}
</head>
<body>
  <div id="toast-container"></div>
  ${chromeOverlay}
  <div class="${shellClass}">
    ${chromeSidebar}
    <div class="main">
      ${topbar(title, mode)}
      <div id="token-decrypt-banner" class="token-decrypt-banner" role="alert" aria-hidden="true">
        <svg class="token-decrypt-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div class="token-decrypt-banner-body">
          <div class="token-decrypt-banner-title">تعذّر قراءة رمز Meta</div>
          <div class="token-decrypt-banner-text" id="token-decrypt-banner-msg">لم يتمكن النظام من فك تشفير رمز الوصول المحفوظ — تغيّر مفتاح التشفير.</div>
        </div>
        <div class="token-decrypt-banner-actions">
          <a id="token-decrypt-banner-cta" href="/workspace?connect=manual" class="btn-reconnect">إعادة ربط Meta</a>
          <button type="button" class="token-decrypt-banner-dismiss" id="token-decrypt-banner-dismiss" title="Dismiss">×</button>
        </div>
      </div>
      <div class="page-content">
        ${content}
      </div>
    </div>
  </div>
  ${chromeBottomNav}
  <div id="metric-info-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this) closeMetricInfo()">
    <div class="modal" style="max-width:420px;">
      <div class="modal-title" id="metric-info-title" style="display:flex;align-items:center;gap:8px;"></div>
      <div id="metric-info-body"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeMetricInfo()">إغلاق</button>
      </div>
    </div>
  </div>
  <div id="timeline-attribution-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this) closeTimelineAttribution()">
    <div class="modal" style="max-width:460px;">
      <div id="timeline-attribution-body"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeTimelineAttribution()">إغلاق</button>
      </div>
    </div>
  </div>
  <script>${SHARED_JS}</script>
  ${scripts}
</body>
</html>`;
}
