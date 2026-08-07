// ════════════════════════════════════════════════════════════════════════
//  src/web/pages/dashboardPage.ts
//
//  Dashboard — the premium overview. Shell is provided by layout(); this
//  file owns ONLY the page-specific markup and client logic.
//
//  Sections (top → bottom):
//    1. Financial Health row    — 30d / 7d / Lifetime (90d window) spend
//    2. Executive Pulse Banner  — single human-readable business health statement
//    3. AI Motion Ticker        — marquee feeding off brain.cmoFeedV2 + issues
//    4. Active Ads Showcase     — green-blink grid of currently-spending campaigns
//    5. Split panel             — AI Brain Box (left) + Spend chart (right)
//    6. Main Move card          — unified #1 priority + narrative + lower-priority expand
//    7. Spotlight               — best campaign + opportunity
//    8. V6 Brain detail         — CMO Feed, Interventions Ledger
//    9. Advanced Analytics      — collapsed KPI grid, Live Pulse metrics, charts, issues
//
//  Data-binding contract (verified against schema + server.ts):
//    /api/dashboard/:wsId                       → brain, health, issues, kpis, ...
//    /api/workspaces/:wsId/insights?days=90     → DailyStat[] (DESC, spend BigInt MINOR)
//    /api/workspaces/:wsId/campaigns            → Campaign[] (budgets BigInt MINOR)
//    /api/workspaces/:wsId                      → adAccounts[currency, currencyMinorFactor]
//    Full auto-refresh (30s, tab visible)         → dashboard + insights + campaigns
//    Live Pulse comes from dashboard DTO brain.livePulse (no separate pulse poll)
// ════════════════════════════════════════════════════════════════════════

import { layout } from '../layout';
import { dashboardStyles } from './dashboard/dashboardStyles';
import { i18nHelpersJs } from './dashboard/lib/i18n';
import { formatHelpersJs } from './dashboard/lib/format';
import { currencyHelpersJs } from './dashboard/lib/currency';
import { renderKpisJs } from './dashboard/sections/kpis';
import { renderIssuesJs } from './dashboard/sections/issues';
import { renderDiagnosesJs } from './dashboard/sections/diagnoses';

export function dashboardPage(): string {
  
  const extraHead = dashboardStyles;

  const content = `
    <div class="loading-overlay" id="loading-state">
      <div class="dash-skeleton" id="dash-skeleton" aria-hidden="true">
        <div class="skeleton-block skeleton-cmd-bar" style="height:48px;margin-bottom:12px;border-radius:14px;"></div>
        <div class="skeleton-block skeleton-gauge"></div>
        <div class="skeleton-qa-row" style="display:flex;gap:8px;margin-bottom:14px;">
          <div class="skeleton-block" style="width:100px;height:36px;border-radius:12px;flex-shrink:0;"></div>
          <div class="skeleton-block" style="width:110px;height:36px;border-radius:12px;flex-shrink:0;"></div>
          <div class="skeleton-block" style="width:95px;height:36px;border-radius:12px;flex-shrink:0;"></div>
          <div class="skeleton-block" style="width:85px;height:36px;border-radius:12px;flex-shrink:0;"></div>
        </div>
        <div class="skeleton-hero-grid">
          <div class="skeleton-block skeleton-hero"></div>
          <div class="skeleton-block skeleton-hero"></div>
          <div class="skeleton-block skeleton-hero"></div>
        </div>
        <div class="skeleton-block skeleton-chart"></div>
        <div class="skeleton-cards-grid">
          <div class="skeleton-block skeleton-card-sm"></div>
          <div class="skeleton-block skeleton-card-sm"></div>
        </div>
      </div>
    </div>

    <div class="onboarding-overlay" id="onboarding-overlay" style="display:none;">
      <div class="onboarding-card">
        <div class="onboarding-icon">⚡</div>
        <div class="onboarding-title" id="onboarding-title">جارٍ تجهيز لوحة التحكم</div>
        <div class="onboarding-msg" id="onboarding-msg">نحلل آخر 30 يوماً من حملاتك…</div>
        <div class="onboarding-progress"><div class="onboarding-progress-bar" id="onboarding-bar"></div></div>
        <div class="onboarding-meta" id="onboarding-meta">يستغرق هذا عادةً دقيقة واحدة</div>
      </div>
    </div>

    <div id="error-state" style="display:none;">
      <div class="alert alert-error" id="error-msg">An error occurred.</div>
    </div>

    <div id="dashboard-content" style="display:none;">

      <!-- ═══ COMMAND BAR ═══ -->
      <div class="cmd-bar" id="cmd-bar">
        <div class="cmd-bar-right">
          <div class="page-title" style="font-size:22px;margin:0;" id="dash-greeting">مركز القيادة</div>
          <div class="page-subtitle" id="dash-subtitle" style="margin:0;font-size:12px;">
            <span id="dash-last-updated" class="text-3">—</span>
          </div>
        </div>
        <div class="cmd-bar-left">
          <div class="cmd-health-pill" id="cmd-health-pill">
            <span class="cmd-health-dot" id="cmd-health-dot"></span>
            <span id="cmd-health-label">—</span>
          </div>
          <div class="cmd-stat" id="cmd-active-count" title="حملات نشطة">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <span>—</span>
          </div>
          <div class="cmd-stat" id="cmd-today-spend" title="إنفاق اليوم">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M4 4h5.5a2.5 2.5 0 010 5H4M4 9h6.5a2.5 2.5 0 010 5H4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <span>—</span>
          </div>
          <div class="cmd-stat cmd-stat-sync" id="cmd-sync-time" title="آخر مزامنة">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8a7 7 0 0113.2-3.2M15 8a7 7 0 01-13.2 3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M14 1v4h-4M2 15v-4h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>—</span>
          </div>
          <div class="mode-toggle" id="mode-toggle">
            <button class="mode-btn" data-mode="quick" id="mode-quick-btn">سريع</button>
            <button class="mode-btn active" data-mode="advanced" id="mode-adv-btn">متقدم</button>
          </div>
          <button class="cmd-refresh-btn" id="cmd-refresh-btn" title="تحديث البيانات">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1 8a7 7 0 0113.2-3.2M15 8a7 7 0 01-13.2 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 1v4h-4M2 15v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>

      <!-- Stale-data banner -->
      <div class="alert alert-warning" id="stale-banner">
        <div style="flex:1;">
          <div style="font-weight:600;">تُعرض بيانات مخزّنة — انتهت صلاحية الرمز</div>
          <div style="font-size:12px;margin-top:2px;color:var(--text-2);">انتهت صلاحية رمز حساب الإعلانات. هذه الأرقام من آخر مزامنة ناجحة.</div>
        </div>
        <a href="/workspace" class="btn btn-primary btn-sm">إعادة الربط</a>
      </div>

      <!-- 0a ▸ Bleed alert — spending with zero results TODAY -->
      <section class="bleed-alert" id="bleed-alert" style="display:none;" dir="auto"></section>

      <!-- 0 ▸ Morning story — what happened while you were away -->
      <section class="morning-story" id="morning-story" style="display:none;" dir="auto">
        <div class="morning-story-icon">☀️</div>
        <div class="morning-story-body">
          <div class="morning-story-text" id="morning-story-text">—</div>
          <div class="morning-story-date" id="morning-story-date"></div>
        </div>
      </section>

      <!-- 0b ▸ Insight strip — forecast + best audience segment -->
      <section class="insight-strip" id="insight-strip" style="display:none;" dir="auto"></section>

      <!-- 1 ▸ Financial hero cards -->
      <section class="hero-grid" id="hero-grid">
        <div class="hero-card" id="hero-30">
          <div class="hero-label">30-Day Spend</div>
          <div class="hero-value" id="hero-30-val">—</div>
          <div class="hero-sub">Past 30 days</div>
          <span class="hero-delta flat" id="hero-30-delta">→ —</span>
        </div>
        <div class="hero-card success" id="hero-7">
          <div class="hero-label">7-Day Spend</div>
          <div class="hero-value" id="hero-7-val">—</div>
          <div class="hero-sub">Past 7 days</div>
          <span class="hero-delta flat" id="hero-7-delta">→ —</span>
        </div>
        <div class="hero-card warning" id="hero-life">
          <div class="hero-label">Lifetime Spend</div>
          <div class="hero-value" id="hero-life-val">—</div>
          <div class="hero-sub" id="hero-life-sub">Account history (90-day window)</div>
          <span class="hero-delta flat">Account total</span>
        </div>
      </section>

      <!-- 2 ▸ Executive Pulse Banner (Tier 1) -->
      <!-- ═══ EXECUTIVE PULSE ═══ -->
      <section id="exec-pulse-section" class="exec-pulse-banner healthy" style="display:none;" dir="auto">
        <div class="exec-pulse-main">
          <div class="exec-pulse-text" id="exec-pulse-text">—</div>
          <div class="exec-pulse-detail" id="exec-pulse-detail"></div>
        </div>
        <div class="exec-pulse-score-chip" id="exec-pulse-score" style="display:none;">
          <span class="exec-pulse-score-num" id="exec-pulse-score-num">—</span>
          <span class="exec-pulse-score-lbl" id="exec-pulse-score-lbl"></span>
        </div>
        <a class="exec-pulse-cta" id="exec-pulse-cta" href="#" style="display:none;"></a>
      </section>

      <!-- ═══ HEALTH SCORE GAUGE ═══ -->
      <section class="health-gauge-section" id="health-gauge-section" style="display:none;">
        <div class="health-gauge-card">
          <div class="health-gauge-left">
            <svg class="health-gauge-svg" viewBox="0 0 200 170" id="health-gauge-svg">
              <defs>
                <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" id="gauge-grad-start" stop-color="rgba(255,255,255,0.1)"/>
                  <stop offset="100%" id="gauge-grad-end" stop-color="rgba(255,255,255,0.1)"/>
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14" stroke-dasharray="358.14 477.52" transform="rotate(135 100 100)" stroke-linecap="round"/>
              <circle cx="100" cy="100" r="76" fill="none" stroke="url(#gauge-grad)" stroke-width="14" stroke-dasharray="0 477.52" transform="rotate(135 100 100)" stroke-linecap="round" id="health-gauge-arc" style="transition: stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1);"/>
              <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" class="hg-score-num" id="hg-score-num">—</text>
              <text x="100" y="128" text-anchor="middle" class="hg-score-max">/ 100</text>
            </svg>
          </div>
          <div class="health-gauge-right">
            <div class="hg-header">
              <div class="hg-title">صحة الحساب</div>
              <span class="hg-band-chip" id="hg-band-label">—</span>
              <div class="hg-subtitle" id="hg-subtitle">—</div>
            </div>
            <div class="hg-status" id="hg-status" dir="auto">—</div>
            <div class="hg-metrics" id="hg-metrics"></div>
            <a class="hg-action-link" id="hg-action-link" href="/ai" style="display:none;">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 12l4-4-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span id="hg-action-text">اعرض ما يحتاج مراجعة</span>
            </a>
          </div>
        </div>
      </section>

      <!-- ═══ DIAGNOSIS + RECOMMENDATIONS (main move) ═══ -->
      <section class="v2-section main-move-above-fold" id="main-move-section">
        <div class="v2-section-head">
          <div>
            <div class="v2-section-kicker" id="main-move-kicker">أهم شيء الآن</div>
            <div class="v2-section-title" id="main-move-label">تشخيص + حل</div>
            <div class="v2-section-sub" id="main-move-sub">ماذا حصل · لماذا · وماذا تفعل</div>
          </div>
          <div class="v2-section-meta" id="main-move-meta">—</div>
        </div>
        <div class="main-move-card" id="main-move-card">
          <div class="main-move-empty" id="main-move-empty">جارٍ التحميل…</div>
        </div>
      </section>

      <!-- ═══ PREDICTIONS ═══ -->
      <section class="v2-section" id="predictions-section" style="display:none;">
        <div class="adv-panel">
          <div class="adv-panel-head">
            <div>
              <div class="adv-panel-kicker">مراقبة مبكرة</div>
              <div class="adv-panel-title">تنبيهات ذكية</div>
              <div class="adv-panel-sub">نراقب ميزانيتك وأداء الإعلانات قبل أن تتأثر</div>
            </div>
            <div class="adv-panel-meta" id="pred-count-badge">—</div>
          </div>
          <div class="section-filters" id="pred-filters"></div>
          <div id="predictions-grid" class="predictions-grid"></div>
        </div>
      </section>

      <!-- ═══ AI RECOMMENDATIONS ═══ -->
      <section class="v2-section" id="ai-recs-section" style="display:none;">
        <div class="adv-panel">
          <div class="adv-panel-head">
            <div>
              <div class="adv-panel-kicker">خطواتك القادمة</div>
              <div class="adv-panel-title">نفّذ الآن</div>
              <div class="adv-panel-sub">إجراءات مبنية على تحليل الذكاء الاصطناعي لحملاتك</div>
            </div>
            <div class="adv-panel-meta" id="ai-recs-source-badge">—</div>
          </div>
          <div class="section-filters" id="ai-recs-filters"></div>
          <div id="ai-recs-grid" class="ai-recs-grid"></div>
        </div>
      </section>

      <!-- ═══ CREATIVE HEALTH (Meta relevance grades) ═══ -->
      <a class="creative-health-strip" id="creative-health-strip" href="/campaigns" style="display:none;" dir="rtl">
        <span class="ch-icon" id="ch-icon">🎨</span>
        <div class="ch-body">
          <div class="ch-title" id="ch-title">—</div>
          <div class="ch-sub" id="ch-sub">—</div>
        </div>
        <span class="ch-cta">راجع الإبداعات →</span>
      </a>

      <!-- ═══ QUICK ACTIONS BAR ═══ -->
      <div class="quick-actions-bar" id="quick-actions-bar" dir="rtl">
        <a class="qa-chip" href="/ai?q=${encodeURIComponent('ما أفضل حملة لزيادة ميزانيتها؟')}">
          <span class="qa-icon">📈</span><span class="qa-label">وسّع الأفضل</span>
        </a>
        <a class="qa-chip" href="/ai?q=${encodeURIComponent('ما الحملات التي يجب إيقافها؟')}">
          <span class="qa-icon">⏸️</span><span class="qa-label">أوقف الخاسرة</span>
        </a>
        <a class="qa-chip" href="/ai?q=${encodeURIComponent('حلل أداء الإعلانات الإبداعية')}">
          <span class="qa-icon">🎨</span><span class="qa-label">حلل الإبداعات</span>
        </a>
        <a class="qa-chip" href="/ai?q=${encodeURIComponent('ما تقرير أداء حملاتي اليوم؟')}">
          <span class="qa-icon">📊</span><span class="qa-label">تقرير سريع</span>
        </a>
      </div>

      <!-- ═══ LIVE INSIGHTS — "What's happening now?" ═══ -->
      <section class="live-insights-section" id="live-insights-section" style="display:none;">
        <div class="live-insights-header">
          <div class="live-insights-title-row">
            <span class="live-dot"></span>
            <span class="live-insights-title">ماذا يحدث الآن؟</span>
          </div>
          <div class="ticker-freshness" id="ticker-freshness"></div>
        </div>
        <div class="live-insights-grid" id="live-insights-grid" dir="auto"></div>
      </section>

      <!-- ═══ KPI CARDS — promoted to main view ═══ -->
      <section class="kpi-command-grid" id="hero-grid">
        <div class="kpi-cmd-card" id="hero-30" data-kpi="spend">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M4 4h5.5a2.5 2.5 0 010 5H4M4 9h6.5a2.5 2.5 0 010 5H4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>
            <div class="hero-label">المبلغ المنفق · 30 يوماً <button type="button" class="info-btn" data-metric-info="spend" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
          </div>
          <div class="hero-value" id="hero-30-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="hero-30-delta">→ —</span>
            <canvas class="kpi-spark" width="140" height="34" data-spark="spend" data-good="neutral"></canvas>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-spend" dir="auto"></div>
        </div>
        <div class="kpi-cmd-card" id="hero-7" data-kpi="spend7">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon success"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-5 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="hero-label">المبلغ المنفق · 7 أيام <button type="button" class="info-btn" data-metric-info="spend" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
          </div>
          <div class="hero-value" id="hero-7-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="hero-7-delta">→ —</span>
            <canvas class="kpi-spark" width="140" height="34" data-spark="spend7" data-good="neutral"></canvas>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-spend7" dir="auto"></div>
        </div>
        <div class="kpi-cmd-card" id="hero-life" data-kpi="lifetime">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon warning"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 10V7M8 10V5M11 10V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
            <div class="hero-label">إجمالي المبلغ المنفق <button type="button" class="info-btn" data-metric-info="spend" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
          </div>
          <div class="hero-value" id="hero-life-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="hero-life-sub">إجمالي الحساب</span>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-lifetime" dir="auto"></div>
        </div>
        <div class="kpi-cmd-card" id="kpi-ctr-card" data-kpi="ctr">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon accent"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 100 12A6 6 0 008 2z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg></div>
            <div class="hero-label">معدل النقر (CTR) <button type="button" class="info-btn" data-metric-info="ctr" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
            <span class="kpi-bench" id="kpi-bench-ctr"></span>
          </div>
          <div class="hero-value" id="kpi-ctr-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="kpi-ctr-delta">→ —</span>
            <canvas class="kpi-spark" width="140" height="34" data-spark="ctr" data-good="up"></canvas>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-ctr" dir="auto"></div>
        </div>
        <div class="kpi-cmd-card" id="kpi-messages-card" data-kpi="messages">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon ctr"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 2v-2a2 2 0 01-1-1.7V4z" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg></div>
            <div class="hero-label">محادثات الرسائل <button type="button" class="info-btn" data-metric-info="messages" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
          </div>
          <div class="hero-value" id="kpi-messages-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="kpi-messages-delta">→ —</span>
            <canvas class="kpi-spark" width="140" height="34" data-spark="messages" data-good="up"></canvas>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-messages" dir="auto"></div>
        </div>
        <div class="kpi-cmd-card" id="kpi-cpm-card" data-kpi="cpm">
          <div class="kpi-cmd-top">
            <div class="kpi-cmd-icon cpm"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1112 0A6 6 0 012 8z" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v6M6 7h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>
            <div class="hero-label">التكلفة لكل 1000 ظهور (CPM) <button type="button" class="info-btn" data-metric-info="cpm" title="ما هذا؟" aria-label="شرح المؤشر">i</button></div>
          </div>
          <div class="hero-value" id="kpi-cpm-val">—</div>
          <div class="kpi-cmd-bottom">
            <span class="hero-delta flat" id="kpi-cpm-delta">→ —</span>
            <canvas class="kpi-spark" width="140" height="34" data-spark="cpm" data-good="down"></canvas>
          </div>
          <div class="kpi-cmd-insight" id="kpi-insight-cpm" dir="auto"></div>
        </div>
      </section>

      <!-- ═══ UNIFIED CAMPAIGN STATUS STRIP ═══
           One connected read on where every campaign stands — replaces the
           old scattered Active-Ads grid + separate counters. Segments are
           proportional to real campaignCounts; "بدون إنفاق" reads as Meta-
           active-but-dormant, never as "working". -->
      <section class="active-section" id="active-section" style="display:none;">
        <div class="active-header">
          <div class="active-title" id="status-strip-title">حملاتك — أين تقف فعلًا؟</div>
          <a class="active-meta" id="active-meta" href="/campaigns">التفاصيل</a>
        </div>
        <div class="status-strip-bar" id="status-strip-bar"></div>
        <div class="status-strip-legend" id="status-strip-legend"></div>
        <div class="status-strip-note" id="status-strip-note"></div>
      </section>

      <section class="split-grid">
        <div class="brain-box">
          <div class="brain-box-head">
            <div class="brain-box-icon">AI</div>
            <div class="brain-box-title" id="brain-box-title">مهام أخرى</div>
            <div class="brain-box-sub" id="brain-box-sub">—</div>
          </div>
          <div id="strategy-list" dir="auto">
            <div class="v2-action-empty">Analyzing…</div>
          </div>
        </div>
        <div class="chart-panel">
          <div class="chart-panel-head">
            <div class="chart-panel-title">الإنفاق اليومي</div>
            <div class="chart-panel-meta" id="chart-panel-meta">—</div>
          </div>
          <div class="chart-panel-canvas"><canvas id="chart-spend-main"></canvas><div class="chart-empty" id="chart-spend-main-empty" style="display:none;">لا توجد بيانات إنفاق في هذه الفترة</div></div>
        </div>
      </section>

      <!-- ═══ SMART TIMELINE ═══ -->
      <section class="timeline-section" id="timeline-section" style="display:none;">
        <div class="timeline-header">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.5v4l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span class="timeline-title">آخر الأحداث</span>
        </div>
        <div class="timeline-track" id="timeline-track"></div>
      </section>

      <!-- ═══ WEEKLY REPORT ═══ -->
      <section class="v2-section" id="weekly-report-section" style="display:none;">
        <div class="adv-panel">
          <div class="adv-panel-head">
            <div>
              <div class="adv-panel-kicker">تقريرك الأسبوعي</div>
              <div class="adv-panel-title">ماذا حدث هذا الأسبوع؟</div>
              <div class="adv-panel-sub">ملخص + مقارنة + خطوات مقترحة</div>
            </div>
          </div>
          <div id="weekly-report-content"></div>
        </div>
      </section>

      <!-- Main Move action modal (remediation workflow) -->
      <div id="main-move-action-modal" class="modal-overlay" style="display:none;">
        <div class="modal" role="dialog" aria-labelledby="action-modal-title" style="max-width:520px;width:92%;">
          <div class="modal-title" id="action-modal-title">—</div>
          <div class="modal-subtitle" id="action-modal-subtitle">—</div>
          <div class="action-modal-steps" id="action-modal-steps"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary btn-sm" id="action-modal-cancel">إلغاء</button>
            <button type="button" class="btn btn-primary btn-sm" id="action-modal-confirm">I've applied this</button>
          </div>
        </div>
      </div>

      <!-- ═══ AI FLOATING ACTION BUTTON ═══ -->
      <a class="ai-fab" href="/ai" id="ai-fab" title="اسأل المساعد الذكي">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a7 7 0 017 7c0 3-2 5-4 6v2H9v-2c-2-1-4-3-4-6a7 7 0 017-7z"/>
          <path d="M9 21h6M10 17h4"/>
        </svg>
        <span class="ai-fab-label">اسأل AI</span>
      </a>

      <!-- ═══ ADVANCED ANALYTICS ═══ -->
      <details class="v2-advanced">
        <summary>
          التحليلات المتقدمة
          <span>نبض مباشر · مؤشرات · اتجاهات · تشخيص</span>
        </summary>
        <div class="v2-advanced-body">
          <div class="adv-shell">

            <!-- 1. Live pulse -->
            <section class="adv-panel" id="brain-pulse-section" style="display:none;">
              <div class="adv-panel-head">
                <div>
                  <div class="adv-panel-kicker">الآن</div>
                  <div class="adv-panel-title">النبض المباشر</div>
                </div>
                <div class="adv-panel-meta">يتحدّث كل 30 ثانية · <span id="brain-pulse-tick">—</span></div>
              </div>
              <div class="adv-pulse-grid">
                <div class="adv-pulse-card">
                  <div id="brain-pulse-burn-label" class="adv-pulse-label">سرعة الإنفاق</div>
                  <div id="brain-pulse-burn" class="adv-pulse-value">—</div>
                  <div class="adv-pulse-sub"><span id="brain-pulse-burn-n">0</span> <span id="brain-pulse-burn-meta">حملة</span></div>
                </div>
                <div class="adv-pulse-card">
                  <div id="brain-pulse-spend-label" class="adv-pulse-label">حصة إنفاق اليوم</div>
                  <div id="brain-pulse-spendpct" class="adv-pulse-value">—</div>
                  <div id="brain-pulse-spend-meta" class="adv-pulse-sub">من الميزانية اليومية</div>
                </div>
                <div class="adv-pulse-card">
                  <div id="brain-pulse-dna-label" class="adv-pulse-label">التشابه مع الأفضل</div>
                  <div id="brain-pulse-dna" class="adv-pulse-value">—</div>
                  <div id="brain-pulse-dna-meta" class="adv-pulse-sub">مقارنةً بأفضل حملاتك</div>
                </div>
              </div>
            </section>

            <!-- 2. Window KPIs — only metrics NOT shown in the hero grid -->
            <section class="adv-panel">
              <div class="adv-panel-head">
                <div>
                  <div class="adv-panel-kicker">آخر 30 يوماً</div>
                  <div class="adv-panel-title">الوصول والتكرار</div>
                  <div class="adv-panel-sub">كم شخصاً رأى إعلانك وكم مرة — مؤشرات لا تظهر في الأعلى</div>
                </div>
              </div>
              <div class="kpi-grid adv-kpi-grid" id="kpi-grid"></div>
            </section>

            <!-- 3. Trends -->
            <section class="adv-panel">
              <div class="adv-panel-head">
                <div>
                  <div class="adv-panel-kicker">آخر 30 يوماً</div>
                  <div class="adv-panel-title">الاتجاهات</div>
                  <div class="adv-panel-sub">اقرأ الميل لا الرقم — صعود تكلفة النتيجة يعني تراجع الكفاءة حتى لو زادت النتائج</div>
                </div>
              </div>
              <div class="chart-grid adv-chart-grid">
                <div class="chart-card" id="adv-results-card">
                  <div class="chart-card-header">
                    <div class="chart-card-title" id="chart-results-title">اتجاه النتائج</div>
                    <div class="chart-card-sub">رسائل + مشتريات + عملاء محتملون</div>
                  </div>
                  <div class="chart-canvas-wrap">
                    <canvas id="chart-results"></canvas>
                    <div class="chart-empty" id="chart-results-empty" style="display:none;">لا توجد نتائج في هذه الفترة</div>
                  </div>
                </div>
                <div class="chart-card" id="adv-cpr-card">
                  <div class="chart-card-header">
                    <div class="chart-card-title">التكلفة لكل نتيجة</div>
                    <div class="chart-card-sub">كم تدفع مقابل كل نتيجة — صعود الخط يعني تراجع الكفاءة</div>
                  </div>
                  <div class="chart-canvas-wrap">
                    <canvas id="chart-cpr"></canvas>
                    <div class="chart-empty" id="chart-cpr-empty" style="display:none;">لا توجد تكلفة نتيجة في هذه الفترة</div>
                  </div>
                </div>
                <div class="chart-card" id="adv-cpm-card">
                  <div class="chart-card-header">
                    <div class="chart-card-title">التكلفة لكل 1000 ظهور (CPM)</div>
                    <div class="chart-card-sub">كم تدفع ليظهر إعلانك 1000 مرة — الأقل أفضل</div>
                  </div>
                  <div class="chart-canvas-wrap">
                    <canvas id="chart-cpm"></canvas>
                    <div class="chart-empty" id="chart-cpm-empty" style="display:none;">لا توجد بيانات CPM في هذه الفترة</div>
                  </div>
                </div>
                <div class="chart-card" id="adv-ctr-card">
                  <div class="chart-card-header">
                    <div class="chart-card-title" id="chart-ctr-title">معدل النقر إلى الظهور (CTR)</div>
                    <div class="chart-card-sub">من كل من رأى إعلانك — كم نسبة من نقر عليه</div>
                  </div>
                  <div class="chart-canvas-wrap">
                    <canvas id="chart-ctr"></canvas>
                    <div class="chart-empty" id="chart-ctr-empty" style="display:none;">لا توجد بيانات تفاعل في هذه الفترة</div>
                  </div>
                </div>
                <div class="chart-card" id="adv-freq-card">
                  <div class="chart-card-header">
                    <div class="chart-card-title" id="chart-freq-title">معدل التكرار</div>
                    <div class="chart-card-sub">كم مرة يرى الشخص الواحد إعلانك — فوق 3 يبدأ الملل</div>
                  </div>
                  <div class="chart-canvas-wrap">
                    <canvas id="chart-frequency"></canvas>
                    <div class="chart-empty" id="chart-frequency-empty" style="display:none;">لا توجد بيانات تكرار في هذه الفترة</div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 4. Attribution -->
            <div id="attribution-section" class="adv-panel" style="display:none;"></div>

            <!-- 5. Diagnoses -->
            <section id="diagnoses-section" class="adv-panel" style="display:none;">
              <div class="adv-panel-head">
                <div>
                  <div class="adv-panel-kicker">أهم شيء الآن</div>
                  <div class="adv-panel-title">تشخيص + حل</div>
                  <div class="adv-panel-sub">ماذا حصل · لماذا · وماذا تفعل</div>
                </div>
              </div>
              <div class="diagnosis-grid" id="diagnoses-grid"></div>
            </section>

            <!-- 6. Alerts -->
            <section class="adv-panel">
              <div class="adv-panel-head">
                <div>
                  <div class="adv-panel-kicker">مراقبة</div>
                  <div class="adv-panel-title">التنبيهات والمشاكل</div>
                  <div class="adv-panel-sub">ملاحظات مرتبة حسب الأولوية</div>
                </div>
              </div>
              <div id="issues-list"><div class="adv-empty-ok">لا توجد مشاكل — حسابك يعمل بشكل جيد.</div></div>
            </section>

            <!-- 7. Campaigns -->

          </div>
        </div>
      </details>
    </div>
  
`;

  const scripts = `
<script src="/vendor/chart.umd.min.js"></script>
<script>
(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────
  var PULSE_MS = 30000;
  var FULL_REFRESH_MS = 180000; // full DTO every 3 min; pulse fills the gaps
  var refreshTimer = null;
  var fullRefreshTimer = null;
  var refreshGeneration = 0;
  var refreshInFlight = false;
  var chartInstances = {};
  var chartResizeBound = false;
  var pendingAdvancedCharts = null;
  var CHART_MAIN_H = 280;
  var CHART_CARD_H = 220;

  function lockChartBox(canvasId, heightPx) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.parentElement) return;
    var box = canvas.parentElement;
    box.style.height = heightPx + 'px';
    box.style.maxHeight = heightPx + 'px';
    box.style.minHeight = heightPx + 'px';
    box.style.overflow = 'hidden';
  }

  function isElementVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
      try { chartInstances[canvasId].destroy(); } catch (e) {}
      delete chartInstances[canvasId];
    }
  }

  function resizeAllCharts() {
    Object.keys(chartInstances).forEach(function (id) {
      var canvas = document.getElementById(id);
      if (!canvas || !isElementVisible(canvas)) return;
      try { chartInstances[id].resize(); } catch (e) {}
    });
  }

  function bindChartResize() {
    if (chartResizeBound) return;
    chartResizeBound = true;
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeAllCharts, 150);
    });
    var details = document.querySelector('.v2-advanced');
    if (details) {
      details.addEventListener('toggle', function () {
        if (details.open) {
          renderAdvancedCharts(true);
          setTimeout(resizeAllCharts, 50);
        }
      });
    }
  }

  function buildDataset(label, data, color, bg, fillArea, fmt) {
    var numericPts = (data || []).filter(function (v) {
      return v != null && Number.isFinite(Number(v));
    }).length;
    return {
      label: label,
      data: data,
      borderColor: color,
      backgroundColor: bg,
      fill: fillArea !== false,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: numericPts > 0 && numericPts < 8 ? 3 : 0,
      pointHoverRadius: 4,
      spanGaps: false,
      _fmt: fmt || 'num',
    };
  }

  function formatChartTip(item) {
    var v = item.parsed.y;
    if (v == null || Number.isNaN(v)) return 'لا بيانات لهذا اليوم';
    var f = item.dataset && item.dataset._fmt;
    var txt;
    if (f === 'currency') {
      var decimals = state.minorFactor === 1 ? 0 : 2;
      txt = Number(v).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + ' ' + (state.currency || '');
    } else if (f === 'pct') {
      txt = Number(v).toFixed(2) + '%';
    } else if (f === 'freq') {
      txt = Number(v).toFixed(2);
    } else {
      txt = Number(v).toLocaleString('en-US');
    }
    var rawLabel = item.dataset && item.dataset.label ? String(item.dataset.label) : '';
    var name = rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return name ? (name + ': ' + txt) : txt;
  }

  function makeLineChart(canvasId, labels, datasets, opts) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    var heightPx = (canvasId === 'chart-spend-main') ? CHART_MAIN_H : CHART_CARD_H;
    lockChartBox(canvasId, heightPx);

    if (!isElementVisible(canvas) && canvasId !== 'chart-spend-main') {
      return null;
    }

    if (chartInstances[canvasId]) {
      chartInstances[canvasId].data.labels = labels;
      chartInstances[canvasId].data.datasets = datasets;
      chartInstances[canvasId].update('none');
      return chartInstances[canvasId];
    }

    destroyChart(canvasId);
    var ctx = canvas.getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(16,14,13,0.97)',
            borderColor: 'rgba(217,167,89,0.35)',
            borderWidth: 1,
            titleColor: '#F3EFE7',
            bodyColor: '#D9A759',
            padding: { top: 10, bottom: 10, left: 14, right: 14 },
            cornerRadius: 10,
            titleFont: { size: 13, weight: '700', family: "'El Messiri', 'Tajawal', sans-serif" },
            bodyFont: { size: 12, weight: '600' },
            displayColors: false,
            filter: function (item) { return !(item.dataset && item.dataset.isIssueMarkers); },
            callbacks: {
              label: function (item) {
                var tip = formatChartTip(item);
                return (item.dataset.label ? item.dataset.label + ': ' : '') + tip;
              },
            },
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: 'rgba(148,163,184,0.5)',
              maxTicksLimit: (opts && opts.maxTicks) || 7,
              font: { size: 10, weight: '500' },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.035)', lineWidth: 0.8 },
            border: { display: false },
            ticks: {
              color: 'rgba(148,163,184,0.5)',
              font: { size: 10, weight: '500' },
              maxTicksLimit: 4,
            },
            beginAtZero: true,
            grace: '8%',
          }
        },
        elements: { point: { radius: 0, hoverRadius: 5, hoverBorderWidth: 2 } },
        onClick: function (evt, elements, chart) {
          if (!elements || !elements.length) return;
          var el = elements[0];
          var ds = chart.data.datasets[el.datasetIndex];
          if (ds && ds.isIssueMarkers && ds.pointDates && ds.pointDates[el.index]) {
            openTimelineAttribution(ds.pointDates[el.index]);
          }
        },
      }
    });
    bindChartResize();
    return chartInstances[canvasId];
  }

  function renderAdvancedCharts(force) {
    if (!pendingAdvancedCharts) return;
    var details = document.querySelector('.v2-advanced');
    if (!force && details && !details.open) return;
    var p = pendingAdvancedCharts;

    function showEmpty(id, show) {
      var el = document.getElementById(id + '-empty');
      var canvas = document.getElementById(id);
      if (el) el.style.display = show ? 'flex' : 'none';
      if (canvas) canvas.style.display = show ? 'none' : '';
    }

    var hasResults = (p.resultsSeries || []).some(function (v) { return v != null && v > 0; });
    var hasCpr = (p.cprSeries || []).some(function (v) { return v != null && v > 0; });
    var hasCpm = (p.cpmSeries || []).some(function (v) { return v != null && v > 0; });
    var hasCtr = (p.ctrSeries || []).some(function (v) { return v != null && v > 0; });
    var hasFreq = (p.freqSeries || []).some(function (v) { return v != null && v > 0; });

    var resultsCard = document.getElementById('adv-results-card');
    var cprCard = document.getElementById('adv-cpr-card');
    var cpmCard = document.getElementById('adv-cpm-card');
    var ctrCard = document.getElementById('adv-ctr-card');
    var freqCard = document.getElementById('adv-freq-card');
    if (resultsCard) resultsCard.style.display = '';
    if (cprCard) cprCard.style.display = '';
    if (cpmCard) cpmCard.style.display = '';
    if (ctrCard) ctrCard.style.display = '';
    if (freqCard) freqCard.style.display = '';

    showEmpty('chart-results', !hasResults);
    showEmpty('chart-cpr', !hasCpr);
    showEmpty('chart-cpm', !hasCpm);
    showEmpty('chart-ctr', !hasCtr);
    showEmpty('chart-frequency', !hasFreq);

    if (hasResults) {
      makeLineChart('chart-results', p.labels, [
        buildDataset(lbl('Results', 'النتائج'), p.resultsSeries, '#2DD4BF', 'rgba(45,212,191,0.12)', true, 'num'),
      ]);
    }
    if (hasCpr) {
      makeLineChart('chart-cpr', p.labels, [
        buildDataset(lbl('Cost per result', 'التكلفة لكل نتيجة'), p.cprSeries, '#60A5FA', 'rgba(96,165,250,0.12)', true, 'currency'),
      ]);
    }
    if (hasCpm) {
      makeLineChart('chart-cpm', p.labels, [
        buildDataset(lbl('CPM', 'CPM'), p.cpmSeries, '#C77A1F', 'rgba(199,122,31,0.10)', true, 'currency'),
      ]);
    }
    if (hasCtr) {
      makeLineChart('chart-ctr', p.labels, [
        buildDataset(lbl('CTR (%)', 'معدل النقر (٪)'), p.ctrSeries, '#34A871', 'rgba(52,168,113,0.08)', true, 'pct'),
      ]);
    }
    if (hasFreq) {
      makeLineChart('chart-frequency', p.labels, [
        buildDataset(lbl('Frequency', 'التكرار'), p.freqSeries, '#FB7185', 'rgba(251,113,133,0.10)', true, 'freq'),
      ]);
    }
  }

  // buildIssueMarkerDataset — provided by SHARED_JS (layout.ts).
  var state = {
    currency: 'USD',
    minorFactor: 100,
    workspaceId: null,
    locale: 'EN',
    mainMovePrimary: null,
    lastInsights: [],
    lastCampaigns: [],
    lastSyncedAt: null,
    lastIssues: [],
    lastIssueDates: [],
  };

  ${i18nHelpersJs}

  // ── helpers ─────────────────────────────────────────────────────────────
  ${formatHelpersJs}
  ${currencyHelpersJs}

  function showError(msg) {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'block';
    document.getElementById('error-msg').textContent = msg;
  }

  function formatLastUpdated(isoOrDate) {
    if (!isoOrDate) return '—';
    try {
      return new Date(isoOrDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return '—'; }
  }
  function updateLastUpdatedLabel(dashData) {
    var el = document.getElementById('dash-last-updated');
    if (!el) return;
    var synced = dashData.workspace && dashData.workspace.lastSyncedAt;
    el.textContent = synced
      ? (lbl('Synced ', 'آخر مزامنة ') + formatLastUpdated(synced))
      : (lbl('Updated ', 'حُدّث ') + formatLastUpdated(new Date()));
  }

  // ── Hero cards ──────────────────────────────────────────────────────────
  function findKpi(dashData, key) {
    return (dashData.kpis || []).find(function (k) { return k.key === key; });
  }
  function renderHero(dashData, insights90) {
    var h30 = document.getElementById('hero-30-val');
    var h7 = document.getElementById('hero-7-val');
    var hLife = document.getElementById('hero-life-val');
    var hLifeSub = document.getElementById('hero-life-sub');
    if (!h30 || !h7 || !hLife) return;
    if (state.lastSyncedAt) {
      document.querySelectorAll('#hero-grid .info-btn[data-metric-info]').forEach(function (btn) {
        btn.setAttribute('data-freshness', state.lastSyncedAt);
      });
    }
    var arr = Array.isArray(insights90) ? insights90 : [];
    var spendKpi = findKpi(dashData, 'spend');
    var spend7 = sumMinor(arr.slice(0, 7));
    var spend90 = sumMinor(arr);

    // 30d hero: authoritative KPI from getDashboard DTO (single source of truth).
    if (spendKpi && spendKpi.display) {
      tickText(h30, spendKpi.display);
    } else {
      tickText(h30, fmtCurrencyMinor(sumMinor(arr.slice(0, 30))));
    }

    tickText(h7, fmtCurrencyMinor(spend7));
    var lifeMinor = (dashData.lifetimeSpend && dashData.lifetimeSpend.syncedAt != null)
      ? dashData.lifetimeSpend.minor
      : spend90; // fallback if lifetime sync pending
    tickText(hLife, fmtCurrencyMinor(lifeMinor));

    function applyDelta(el, pct, goodWhenUp) {
      if (pct == null) { el.className = 'hero-delta flat'; el.textContent = '→ —'; return; }
      var up = pct >= 0;
      var arrow = up ? '↑' : '↓';
      var cls = (up === !!goodWhenUp) ? 'up' : 'down';
      // Spend going up is bad for cost-control; goodWhenUp = false
      el.className = 'hero-delta ' + cls;
      el.textContent = arrow + ' ' + Math.abs(pct).toFixed(1) + '% ' + lbl('vs prior', 'مقابل السابق');
    }

    // 30d delta: align with KPI DTO when present (30d vs prior-30d server math).
    var d30 = (spendKpi && spendKpi.deltaPct != null)
      ? Number(spendKpi.deltaPct) * 100
      : (function () {
          var spend30 = sumMinor(arr.slice(0, 30));
          var prior30 = sumMinor(arr.slice(30, 60));
          return prior30 > 0 ? ((spend30 - prior30) / prior30) * 100 : null;
        })();
    applyDelta(document.getElementById('hero-30-delta'), d30, false);

    // 7d delta: insights fallback only (no 7d KPI in DTO).
    var prior7 = sumMinor(arr.slice(7, 14));
    var d7 = prior7 > 0 ? ((spend7 - prior7) / prior7) * 100 : null;
    applyDelta(document.getElementById('hero-7-delta'), d7, false);

    // Lifetime sub: authoritative Meta lifetime when synced, else honest window label.
    var days = Math.min(arr.length, 90);
    if (hLifeSub) {
      hLifeSub.textContent =
        (dashData.lifetimeSpend && dashData.lifetimeSpend.syncedAt)
          ? lbl('Meta account lifetime total', 'إجمالي حساب Meta الكلي')
          : lbl('Account history (' + days + '-day window)', 'تاريخ الحساب (آخر ' + days + ' يوماً)');
    }

    // Populate CTR, Messages, CPM KPI cards
    var ctrKpi = findKpi(dashData, 'ctr');
    var ctrEl = document.getElementById('kpi-ctr-val');
    var ctrDelta = document.getElementById('kpi-ctr-delta');
    if (ctrEl) {
      tickText(ctrEl, ctrKpi && ctrKpi.display ? ctrKpi.display : '—');
    }
    if (ctrDelta && ctrKpi) {
      applyDelta(ctrDelta, ctrKpi.deltaPct != null ? Number(ctrKpi.deltaPct) * 100 : null, true);
    }

    var msgKpi = findKpi(dashData, 'messages');
    var msgEl = document.getElementById('kpi-messages-val');
    var msgDelta = document.getElementById('kpi-messages-delta');
    if (msgEl) {
      tickText(msgEl, msgKpi && msgKpi.display ? msgKpi.display : '—');
    }
    if (msgDelta && msgKpi) {
      applyDelta(msgDelta, msgKpi.deltaPct != null ? Number(msgKpi.deltaPct) * 100 : null, true);
    }

    var cpmKpi = findKpi(dashData, 'cpm');
    if (!cpmKpi) cpmKpi = findKpi(dashData, 'cpc');
    var cpmEl = document.getElementById('kpi-cpm-val');
    var cpmDelta = document.getElementById('kpi-cpm-delta');
    if (cpmEl) {
      tickText(cpmEl, cpmKpi && cpmKpi.display ? cpmKpi.display : '—');
    }
    if (cpmDelta && cpmKpi) {
      applyDelta(cpmDelta, cpmKpi.deltaPct != null ? Number(cpmKpi.deltaPct) * 100 : null, false);
    }

    try { drawKpiSparks(dashData); } catch (e) { console.error('[dashboard] kpi sparks failed:', e); }
    try { renderCtrBenchmark(dashData); } catch (e) { console.error('[dashboard] ctr benchmark failed:', e); }
  }

  // ── KPI sparklines — 30-day trend shape from real daily series ──────────
  // Colour follows meaning: a line moving the "good" way is green, the bad
  // way red, flat is neutral gold. Null days (unsynced) break the line
  // rather than inventing a zero dip.
  function drawKpiSparks(dashData) {
    var ts = dashData && dashData.trendSeries;
    if (!ts) return;
    var seriesFor = {
      spend: ts.spend, spend7: Array.isArray(ts.spend) ? ts.spend.slice(-7) : null,
      ctr: ts.ctr, cpm: ts.cpm, messages: ts.messages,
    };
    document.querySelectorAll('.kpi-spark').forEach(function (cv) {
      var key = cv.getAttribute('data-spark');
      var good = cv.getAttribute('data-good'); // 'up' | 'down'
      var raw = seriesFor[key];
      var ctx = cv.getContext('2d');
      if (!ctx) return;

      // Crisp on retina: scale the backing store, keep CSS box fixed.
      var dpr = window.devicePixelRatio || 1;
      var cssW = cv.width, cssH = cv.height;
      if (cv._dpr !== dpr) {
        cv.width = cssW * dpr; cv.height = cssH * dpr;
        cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
        cv._dpr = dpr; cv._cssW = cssW; cv._cssH = cssH;
      }
      var W = cv._cssW, H = cv._cssH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var vals = Array.isArray(raw) ? raw.map(function (v) { return v == null ? null : Number(v); }) : [];
      var real = vals.filter(function (v) { return v != null && isFinite(v); });
      if (real.length < 2) { cv.style.display = 'none'; return; }
      cv.style.display = '';

      var max = Math.max.apply(null, real);
      var min = Math.min.apply(null, real);
      var span = (max - min) || Math.abs(max) || 1;
      var pad = 3;
      var stepX = (W - pad * 2) / Math.max(1, vals.length - 1);
      var y = function (v) { return H - pad - ((v - min) / span) * (H - pad * 2); };

      // Direction over the visible window decides colour — but only for
      // metrics with an unambiguous "good" direction. Spend rising or falling
      // is neither good nor bad without context, so it stays neutral gold.
      var first = real[0], last = real[real.length - 1];
      var rising = last > first;
      var flat = Math.abs(last - first) < span * 0.05;
      var color;
      if (good === 'neutral') color = '#D9A759';
      else if (flat) color = '#8A8378';
      else color = (rising === (good === 'up')) ? '#34A871' : '#E2604F';

      // Area under the line (very light), then the stroke — contiguous segments only.
      var startIdx = -1;
      function flush(endIdx, mode) {
        if (startIdx < 0 || endIdx < startIdx) return;
        ctx.beginPath();
        for (var i = startIdx; i <= endIdx; i++) {
          var px = pad + i * stepX;
          if (i === startIdx) ctx.moveTo(px, y(vals[i])); else ctx.lineTo(px, y(vals[i]));
        }
        if (mode === 'area') {
          ctx.lineTo(pad + endIdx * stepX, H); ctx.lineTo(pad + startIdx * stepX, H); ctx.closePath();
          ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = color; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        }
      }
      ['area', 'line'].forEach(function (mode) {
        startIdx = -1;
        for (var i = 0; i < vals.length; i++) {
          if (vals[i] == null) { flush(i - 1, mode); startIdx = -1; }
          else if (startIdx < 0) startIdx = i;
        }
        flush(vals.length - 1, mode);
      });

      // Endpoint dot on the latest value.
      var lastRealIdx = -1;
      for (var k = vals.length - 1; k >= 0; k--) { if (vals[k] != null) { lastRealIdx = k; break; } }
      if (lastRealIdx >= 0) {
        ctx.beginPath();
        ctx.arc(pad + lastRealIdx * stepX, y(vals[lastRealIdx]), 2.2, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      }
    });
  }

  // ── CTR benchmark chip — Meta's published healthy range, honest verdict ──
  function renderCtrBenchmark(dashData) {
    var el = document.getElementById('kpi-bench-ctr');
    if (!el) return;
    var ctrKpi = findKpi(dashData, 'ctr');
    var v = ctrKpi && ctrKpi.value != null ? Number(ctrKpi.value) : null;
    if (v == null || !isFinite(v) || v <= 0) { el.textContent = ''; el.className = 'kpi-bench'; return; }
    var verdict, cls;
    if (v >= 1.5) { verdict = lbl('Good', 'جيد'); cls = 'good'; }
    else if (v >= 1.0) { verdict = lbl('Average', 'متوسط'); cls = 'mid'; }
    else { verdict = lbl('Low', 'منخفض'); cls = 'low'; }
    el.textContent = verdict;
    el.className = 'kpi-bench ' + cls;
    el.title = lbl('Meta healthy range: 1.5%+ good, 1–1.5% average', 'النطاق الصحي حسب Meta: 1.5%+ جيد، 1–1.5% متوسط');
  }

  // Client-side cognitive filter: drop identical generic insight twins that
  // may still arrive from older snapshots before the server gate rewrites them.
  function isGenericInsightCopy(title, body) {
    var t = String(title || '').trim();
    var b = String(body || '').trim();
    if (t.indexOf('تحديث أداء الحملة') === 0 || t === 'Campaign Performance Update') return true;
    if (b.indexOf('راجعنا أداء حملتك وصدرت توصية جديدة') !== -1) return true;
    return false;
  }

  function insightCopyFingerprint(title, body) {
    return String(title || '').toLowerCase().replace(/\d+/g, '#')
      + '||'
      + String(body || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  // ── AI Motion Ticker (Enhanced) ──────────────────────────────────────────
  function buildTickerItems(dashData) {
    var items = [];
    var seenInsightFp = {};
    var cmoFeedV2 = (dashData.brain && Array.isArray(dashData.brain.cmoFeedV2)) ? dashData.brain.cmoFeedV2 : [];
    cmoFeedV2.slice(0, 8).forEach(function (it) {
      if (!it.title) return;
      if (isGenericInsightCopy(it.title, it.body)) return;
      var fp = insightCopyFingerprint(it.title, it.body);
      if (seenInsightFp[fp]) return;
      seenInsightFp[fp] = true;
      var sev = it.severity === 'CRITICAL' ? 'critical' : it.severity === 'HIGH' ? 'warning' : 'success';
      items.push({
        category: 'strategy',
        badge: lbl('Strategy', 'استراتيجية'),
        severity: sev,
        text: it.title + (it.campaignName ? ' — ' + it.campaignName : ''),
        explain: it.body || lbl('AI-generated strategic recommendation', 'توصية استراتيجية من الذكاء الاصطناعي'),
      });
    });
    var issues = Array.isArray(dashData.issues) ? dashData.issues : [];
    issues.slice(0, 5).forEach(function (iss) {
      var sev = (iss.severity || 'low').toLowerCase();
      var mappedSev = sev === 'critical' ? 'critical' : sev === 'high' ? 'warning' : sev === 'medium' ? 'warning' : 'success';
      var rec = Array.isArray(iss.recommendations) ? iss.recommendations[0] : (iss.recommendations || '');
      items.push({
        category: 'alert',
        badge: lbl('Alert', 'تنبيه'),
        severity: mappedSev,
        text: (iss.title || iss.code || lbl('Observation', 'ملاحظة')) + (rec ? ' — ' + rec : ''),
        explain: rec
          ? lbl('Recommended action: ', 'الإجراء المقترح: ') + rec
          : lbl('Review this alert in the issues panel below', 'راجع هذا التنبيه في لوحة المشاكل أدناه'),
      });
    });
    var kpis = Array.isArray(dashData.kpis) ? dashData.kpis : [];
    kpis.slice(0, 4).forEach(function (k) {
      if (k.deltaPct == null) return;
      var pct = Math.abs(Number(k.deltaPct) * 100).toFixed(1);
      var dir = k.direction === 'up' ? lbl('up', 'ارتفاع') : lbl('down', 'انخفاض');
      var isGood = k.direction === 'up' ? (k.goodWhenUp !== false) : (k.goodWhenUp === false);
      items.push({
        category: 'performance',
        badge: lbl('KPI', 'مؤشر'),
        severity: isGood ? 'success' : 'warning',
        text: (k.label || k.key) + ' ' + dir + ' ' + pct + '%',
        explain: isGood
          ? lbl('Positive trend — continue current strategy', 'اتجاه إيجابي — استمر في الاستراتيجية الحالية')
          : lbl('Needs attention — AI is monitoring for further decline', 'يحتاج اهتمام — الذكاء الاصطناعي يراقب أي انخفاض إضافي'),
      });
    });
    // Intra-day pulse if available
    var pulse = dashData.brain && dashData.brain.livePulse;
    if (pulse && pulse.intraDaySpendPct != null) {
      items.push({
        category: 'insight',
        badge: lbl('Today', 'اليوم'),
        severity: 'success',
        text: lbl('Budget pacing: ', 'سرعة الإنفاق: ') + pulse.intraDaySpendPct.toFixed(1) + '% ' + lbl('spent', 'أُنفق'),
        explain: lbl('Percentage of daily budget spent so far today', 'نسبة الميزانية اليومية المنفقة حتى الآن'),
      });
    }
    if (items.length === 0) {
      items.push({
        category: 'insight',
        badge: lbl('Status', 'الحالة'),
        severity: 'success',
        text: lbl('AI is monitoring your account — no active alerts', 'الذكاء الاصطناعي يراقب حسابك — لا توجد تنبيهات'),
        explain: lbl('All metrics are within normal ranges. You will be notified when action is needed.', 'جميع المؤشرات ضمن النطاق الطبيعي. سيتم إعلامك عند الحاجة لإجراء.'),
      });
    }
    return items;
  }
  function hasPrimaryMerchantTask(dashData) {
    var tasks = dashData && Array.isArray(dashData.merchantTasks) ? dashData.merchantTasks.filter(Boolean) : [];
    if (tasks.length) return true;
    var issues = dashData && Array.isArray(dashData.issues) ? dashData.issues.filter(Boolean) : [];
    if (issues.length) return true;
    if (dashData && dashData.priorityAction) return true;
    return false;
  }

  function renderTicker(items, dashData) {
    renderLiveInsights(items, dashData);
  }

  // ── LIVE INSIGHTS — human-readable "what's happening now?" ──────────
  function renderLiveInsights(items, dashData) {
    var section = document.getElementById('live-insights-section');
    var grid = document.getElementById('live-insights-grid');
    var freshnessEl = document.getElementById('ticker-freshness');
    if (!section || !grid) return;

    if (hasPrimaryMerchantTask(dashData)) {
      section.style.display = 'none';
      grid.innerHTML = '';
      return;
    }
    if (!items || items.length === 0) {
      section.style.display = 'none';
      return;
    }

    if (freshnessEl) {
      var synced = dashData && dashData.workspace && dashData.workspace.lastSyncedAt;
      if (synced) {
        var ago = Math.round((Date.now() - new Date(synced).getTime()) / 60000);
        var agoText = ago < 2 ? lbl('Just now', 'الآن') : ago < 60 ? ago + lbl('m ago', 'د') : Math.round(ago / 60) + lbl('h ago', 'س');
        var isStale = ago > 30;
        freshnessEl.innerHTML = '<span class="ticker-freshness-dot' + (isStale ? ' stale' : '') + '"></span> '
          + lbl('Data: ', 'البيانات: ') + escHtml(agoText);
      } else {
        freshnessEl.innerHTML = '';
      }
    }

    var sentimentIcon = function (sev) {
      if (sev === 'critical') return '<span class="live-insight-icon negative">!</span>';
      if (sev === 'warning') return '<span class="live-insight-icon negative">!</span>';
      if (sev === 'success') return '<span class="live-insight-icon positive">&#10003;</span>';
      return '<span class="live-insight-icon neutral">i</span>';
    };
    var shown = items.slice(0, 4);
    grid.innerHTML = shown.map(function (it) {
      var sub = it.explain
        ? '<div class="live-insight-sub" dir="auto">' + escHtml(it.explain) + '</div>'
        : '';
      return '<div class="live-insight-card">'
        + '<div class="live-insight-top">'
          + sentimentIcon(it.severity)
          + '<span class="live-insight-badge">' + escHtml(it.badge) + '</span>'
        + '</div>'
        + '<div class="live-insight-text" dir="auto">' + escHtml(it.text) + '</div>'
        + sub
      + '</div>';
    }).join('');
    section.style.display = 'block';
  }

  // ── COMMAND BAR — health pill, active count, today spend, sync ──────
  function renderCommandBar(dashData) {
    var pill = document.getElementById('cmd-health-pill');
    var healthLabel = document.getElementById('cmd-health-label');
    var activeEl = document.getElementById('cmd-active-count');
    var spendEl = document.getElementById('cmd-today-spend');
    var syncEl = document.getElementById('cmd-sync-time');
    if (!pill) return;

    var health = deriveBusinessHealth(dashData);
    pill.className = 'cmd-health-pill ' + health.level;
    if (healthLabel) {
      var levelLabel = health.level === 'critical' ? lbl('Critical', 'حرج')
        : health.level === 'warning' ? lbl('Attention', 'انتبه')
        : lbl('Healthy', 'جيد');
      healthLabel.textContent = levelLabel;
    }

    var cc = dashData && dashData.workspace && dashData.workspace.campaignCounts;
    if (activeEl) {
      var activeSpan = activeEl.querySelector('span');
      if (activeSpan) {
        var delivering = cc ? (cc.deliveringInWindow || cc.spendingToday || 0) : 0;
        activeSpan.textContent = delivering + ' ' + lbl('active', 'نشطة');
      }
    }

    if (spendEl) {
      var spendSpan = spendEl.querySelector('span');
      if (spendSpan) {
        var pulse = dashData && dashData.brain && dashData.brain.livePulse;
        var todaySpend = '—';
        if (pulse && pulse.intraDaySpendPct != null) {
          todaySpend = pulse.intraDaySpendPct.toFixed(0) + '% ' + lbl('budget', 'ميزانية');
        }
        spendSpan.textContent = todaySpend;
      }
    }

    if (syncEl) {
      var syncSpan = syncEl.querySelector('span');
      if (syncSpan) {
        var synced = dashData && dashData.workspace && dashData.workspace.lastSyncedAt;
        if (synced) {
          var ago = Math.round((Date.now() - new Date(synced).getTime()) / 60000);
          var agoText = ago < 2 ? lbl('Now', 'الآن') : ago < 60 ? ago + lbl('m', 'د') : Math.round(ago / 60) + lbl('h', 'س');
          syncSpan.textContent = agoText;
        }
      }
    }
  }

  // ── SMART TIMELINE — recent events ──────────────────────────────────
  function renderTimeline(dashData) {
    var section = document.getElementById('timeline-section');
    var track = document.getElementById('timeline-track');
    if (!section || !track) return;

    var events = [];
    var synced = dashData && dashData.workspace && dashData.workspace.lastSyncedAt;
    if (synced) {
      events.push({
        type: 'sync',
        time: new Date(synced),
        text: lbl('Data synced successfully', 'تمت مزامنة البيانات بنجاح'),
      });
    }

    var issues = Array.isArray(dashData.issues) ? dashData.issues : [];
    issues.slice(0, 3).forEach(function (iss) {
      var sev = (iss.severity || 'medium').toLowerCase();
      var issTime = iss.detectedAt || iss.createdAt || iss.updatedAt;
      var parsed = issTime ? new Date(issTime) : new Date();
      if (isNaN(parsed.getTime())) parsed = new Date();
      events.push({
        type: sev === 'critical' ? 'critical' : 'alert',
        time: parsed,
        text: '<b>' + escHtml(lbl('Alert', 'تنبيه')) + ':</b> ' + escHtml(iss.title || iss.code || ''),
      });
    });

    var feed = (dashData.brain && Array.isArray(dashData.brain.cmoFeedV2)) ? dashData.brain.cmoFeedV2 : [];
    feed.slice(0, 2).forEach(function (it) {
      if (!it.title || !it.generatedAt) return;
      if (isGenericInsightCopy(it.title, it.body)) return;
      var feedTime = new Date(it.generatedAt);
      if (isNaN(feedTime.getTime())) feedTime = new Date();
      events.push({
        type: 'campaign',
        time: feedTime,
        text: '<b>' + escHtml(lbl('AI', 'ذكاء')) + ':</b> ' + escHtml(it.title),
      });
    });

    events.sort(function (a, b) {
      var ta = a.time.getTime(), tb = b.time.getTime();
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });

    // One line per distinct event — three copies of the same alert tell the
    // merchant nothing extra, they just bury the feed.
    var seenEventText = {};
    events = events.filter(function (ev) {
      if (seenEventText[ev.text]) return false;
      seenEventText[ev.text] = true;
      return true;
    });

    // A lone "data synced" ping carries no information — the sync time already
    // shows in the command bar. Only render when there are real events.
    if (events.length === 0 || (events.length === 1 && events[0].type === 'sync')) {
      section.style.display = 'none';
      return;
    }

    track.innerHTML = events.slice(0, 5).map(function (ev) {
      var timeStr;
      try {
        timeStr = ev.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      } catch (e) { timeStr = '—'; }
      return '<div class="timeline-item event-' + ev.type + '">'
        + '<span class="timeline-time">' + escHtml(timeStr) + '</span>'
        + '<span class="timeline-text" dir="auto">' + ev.text + '</span>'
      + '</div>';
    }).join('');
    section.style.display = 'block';
  }

  // ── KPI INSIGHTS — AI interpretation text in each card ──────────────
  function renderKpiInsights(dashData, kpis) {
    var kpiList = Array.isArray(kpis) ? kpis : [];

    function setInsight(id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text || '';
    }

    var spendKpi = kpiList.find(function (k) { return k && k.key === 'spend'; });
    if (spendKpi && spendKpi.deltaPct != null) {
      var d = Number(spendKpi.deltaPct) * 100;
      setInsight('kpi-insight-spend', d > 5
        ? lbl('Spend increased vs prior period — review active budgets', 'الإنفاق ارتفع مقارنة بالفترة السابقة — راجع الميزانيات')
        : d < -5
          ? lbl('Spend decreased — some campaigns may need more budget', 'الإنفاق انخفض — بعض الحملات قد تحتاج ميزانية أكبر')
          : lbl('Spend is stable — budget allocation is consistent', 'الإنفاق مستقر — توزيع الميزانية ثابت'));
    }

    var ctrKpi = kpiList.find(function (k) { return k && k.key === 'ctr'; });
    if (ctrKpi) {
      var ctrVal = Number(ctrKpi.value || 0);
      setInsight('kpi-insight-ctr', ctrVal >= 2
        ? lbl('Good click-through rate — ads are attracting attention', 'معدل نقر جيد — إعلاناتك تجذب الانتباه')
        : ctrVal >= 1
          ? lbl('Average CTR — test new ad creatives', 'معدل نقر متوسط — جرّب تصميمات إعلانية جديدة')
          : ctrVal > 0
            ? lbl('Low CTR — ads need stronger headlines or images', 'معدل نقر منخفض — إعلاناتك تحتاج عناوين أو صوراً أقوى')
            : '');
    }

    var msgKpi = kpiList.find(function (k) { return k && k.key === 'messages'; });
    if (msgKpi) {
      var msgs = Number(msgKpi.value || 0);
      setInsight('kpi-insight-messages', msgs > 0
        ? msgs + ' ' + lbl('conversations started — each is a potential customer', 'محادثة بدأت — كل واحدة عميل محتمل')
        : lbl('No messages yet this period', 'لا توجد رسائل في هذه الفترة'));
    }

    var cpmKpi = kpiList.find(function (k) { return k && k.key === 'cpm'; });
    if (cpmKpi) {
      var cpmVal = Number(cpmKpi.value || 0);
      setInsight('kpi-insight-cpm', cpmVal > 0
        ? lbl('What you pay for every 1,000 impressions — lower means your budget reaches more people', 'ما تدفعه مقابل كل 1000 ظهور — كلما انخفض وصل إعلانك لعدد أكبر بنفس الميزانية')
        : '');
    }
  }

  // ── Active Ads Showcase ─────────────────────────────────────────────────
  // One connected strip in place of the old scattered active-ads grid +
  // separate counters. Segments are proportional to real campaignCounts —
  // never invented — so "بدون إنفاق" (Meta-active, zero spend) always reads
  // as dormant, not as "working". See lib/campaignCatalog.ts for the
  // deliveringInWindow / spendingToday / dormantActive / paused contract.
  function renderCampaignStatusStrip(campaigns, campaignCounts) {
    var sec = document.getElementById('active-section');
    var bar = document.getElementById('status-strip-bar');
    var legend = document.getElementById('status-strip-legend');
    var note = document.getElementById('status-strip-note');
    var titleEl = document.getElementById('status-strip-title');
    if (!sec || !bar || !legend) return;
    var cc = campaignCounts;
    if (!cc || !cc.total) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';

    // Order matches what matters most to the merchant: spending today (the
    // strongest signal of actually delivering, per classifyCampaignDelivery)
    // first, then the rest of the delivering window, then dormant, then
    // stopped. Every count here is real — never invented.
    var delivering = Math.max(0, cc.deliveringInWindow - cc.spendingToday);
    var segs = [
      { n: cc.spendingToday || 0, color: 'var(--success)', label: lbl('spending today', 'تنفق اليوم') },
      { n: delivering, color: 'var(--accent)', label: lbl('delivering', 'تعمل فعلًا') },
      { n: cc.dormantActive || 0, color: 'var(--warning)', label: lbl('no spend', 'بدون إنفاق') },
      { n: (cc.paused || 0) + (cc.archived || 0), color: 'var(--border-2)', label: lbl('stopped', 'متوقفة') },
    ];

    if (titleEl) {
      titleEl.textContent = lbl('Your ' + cc.total + ' campaigns — where do they really stand?', 'حملاتك الـ' + cc.total + ' — أين تقف فعلًا؟');
    }
    bar.innerHTML = segs.filter(function (s) { return s.n > 0; }).map(function (s) {
      return '<span style="flex:' + s.n + ';background:' + s.color + '"></span>';
    }).join('');
    legend.innerHTML = segs.map(function (s) {
      return '<span class="status-strip-item"><span class="status-strip-dot" style="background:' + s.color + '"></span>'
        + escHtml(s.label) + ' <bdi>' + s.n + '</bdi></span>';
    }).join('');
    if (note) {
      note.textContent = cc.dormantActive > 0
        ? lbl('"No spend" looks active in Meta but is not spending anything — not counted as delivering.', '«بدون إنفاق» تبدو نشطة في Meta لكنها لا تصرف شيئًا — لا تُحسب ضمن ما يعمل.')
        : '';
    }
  }

  // ── Steady-state helpers (rich content when no actions pending) ─────────
  function getSteadyState(dashData) {
    return dashData && dashData.steadyState ? dashData.steadyState : null;
  }
  function buildClientSteadyFallback(dashData, kpis) {
    var kp = Array.isArray(kpis) ? kpis : [];
    var ctr = kp.find(function (k) { return k && k.key === 'ctr'; });
    var best = dashData && dashData.bestCampaign;
    var insights = [];
    if (best && best.name) {
      insights.push({
        title: lbl('Top performer holding steady', 'أفضل حملة مستقرة'),
        body: best.name + ' · ' + lbl('Score', 'النتيجة') + ' ' + (best.health != null ? best.health : '—')
          + (best.ctr != null ? ' · CTR ' + Number(best.ctr).toFixed(2) + '%' : ''),
      });
    }
    if (ctr && ctr.display) {
      insights.push({
        title: lbl('Engagement trend', 'اتجاه التفاعل'),
        body: lbl('CTR', 'تفاعل الإعلان') + ' ' + ctr.display
          + (ctr.deltaPct != null ? ' (' + (ctr.direction === 'up' ? '+' : '-') + Math.abs(Number(ctr.deltaPct) * 100).toFixed(1) + '%)' : ''),
      });
    }
    var pulse = dashData && dashData.brain && dashData.brain.livePulse;
    if (pulse && pulse.campaignsObserved) {
      insights.push({
        title: lbl('Background monitoring', 'المراقبة في الخلفية'),
        body: lbl('Watching', 'يراقب') + ' ' + pulse.campaignsObserved + ' ' + lbl('active campaigns', 'حملات نشطة')
          + (pulse.intraDaySpendPct != null ? ' · ' + pulse.intraDaySpendPct.toFixed(1) + '% ' + lbl("of today's budget", 'من ميزانية اليوم') : ''),
      });
    }
    if (insights.length === 0) {
      insights.push({
        title: lbl('Account overview', 'نظرة على الحساب'),
        body: lbl('Metrics are within normal ranges — AI continues monitoring in the background.', 'المؤشرات ضمن النطاقات الطبيعية — الذكاء الاصطناعي يتابع في الخلفية.'),
      });
    }
    return {
      mainMoveTitle: lbl('Campaigns running stable', 'الحملات تعمل باستقرار'),
      mainMoveNarrative: insights[0] ? insights[0].body : '',
      stableCampaigns: best ? [{ name: best.name, health: best.health, ctrDisplay: best.ctr != null ? Number(best.ctr).toFixed(2) + '%' : '—', messages: best.messages || 0 }] : [],
      benchmarks: ctr ? [{ label: lbl('CTR', 'تفاعل الإعلان'), valueDisplay: ctr.display, verdict: lbl('Monitoring', 'مراقبة'), positive: true }] : [],
      backgroundSummary: insights[insights.length - 1] ? insights[insights.length - 1].body : '',
      insights: insights,
    };
  }
  function renderSteadyMainMove(steady) {
    var card = document.getElementById('main-move-card');
    var meta = document.getElementById('main-move-meta');
    if (!card || !steady) return false;
    state.mainMovePrimary = null;
    if (meta) meta.textContent = lbl('Steady state · no action needed', 'مستقر · لا إجراء مطلوب');
    var stableList = Array.isArray(steady.stableCampaigns) ? steady.stableCampaigns : [];
    var stableHtml = stableList.length > 0
      ? '<div class="main-move-steady-list">' + stableList.slice(0, 4).map(function (c) {
          return '<div class="main-move-steady-item" dir="auto"><b>' + escHtml(c.name || '—') + '</b> · '
            + escHtml(lbl('Health', 'الصحة')) + ' ' + escHtml(String(c.health != null ? c.health : '—'))
            + ' · CTR ' + escHtml(c.ctrDisplay || '—')
            + (c.messages ? ' · ' + escHtml(String(c.messages)) + ' ' + escHtml(lbl('results', 'نتائج')) : '')
            + '</div>';
        }).join('') + '</div>'
      : '';
    var benchHtml = Array.isArray(steady.benchmarks) && steady.benchmarks.length > 0
      ? '<div class="main-move-benchmarks">' + steady.benchmarks.slice(0, 4).map(function (b) {
          var cls = b.positive === true ? ' positive' : (b.positive === false ? ' negative' : '');
          return '<div class="main-move-benchmark' + cls + '">'
            + '<span class="main-move-benchmark-label">' + escHtml(b.label) + '</span>'
            + '<span class="main-move-benchmark-value">' + escHtml(b.valueDisplay) + '</span>'
            + '<span class="main-move-benchmark-verdict">' + escHtml(b.verdict) + '</span>'
          + '</div>';
        }).join('') + '</div>'
      : '';
    card.innerHTML = '<div class="main-move-primary steady" dir="auto">'
      + '<div class="main-move-tag">' + escHtml(lbl('Steady performance', 'أداء مستقر')) + '</div>'
      + '<div class="main-move-title">' + escHtml(steady.mainMoveTitle || lbl('Account is steady', 'الحساب مستقر')) + '</div>'
      + stableHtml
      + benchHtml
      + '<div class="main-move-why">' + escHtml(steady.mainMoveNarrative || steady.backgroundSummary || '') + '</div>'
      + (steady.backgroundSummary && steady.backgroundSummary !== steady.mainMoveNarrative
        ? '<div class="main-move-why" style="border-top:none;margin-top:0;padding-top:0;font-size:12.5px;color:var(--text-3);">' + escHtml(steady.backgroundSummary) + '</div>'
        : '')
    + '</div>';
    return true;
  }
  function renderSteadyBrainBox(steady) {
    var list = document.getElementById('strategy-list');
    var sub = document.getElementById('brain-box-sub');
    if (!list || !steady) return false;
    var cards = Array.isArray(steady.insights) ? steady.insights : [];
    if (cards.length === 0) return false;
    list.innerHTML = cards.slice(0, 6).map(function (c) {
      return '<div class="strategy-card low">'
        + '<div class="strategy-head">'
          + '<div class="strategy-title">' + escHtml(c.title) + '</div>'
          + '<span class="strategy-sev">' + escHtml(lbl('Stable', 'مستقر')) + '</span>'
        + '</div>'
        + '<div class="strategy-body">' + escHtml(c.body) + '</div>'
      + '</div>';
    }).join('');
    if (sub) sub.textContent = cards.length + ' ' + lbl(cards.length === 1 ? 'insight' : 'insights', cards.length === 1 ? 'رؤية' : 'رؤى');
    return true;
  }

  // ── AI Brain Box (secondary tasks — primary lives in Main Move above the fold) ─
  function renderBrainBox(dashData) {
    var list = document.getElementById('strategy-list');
    var sub  = document.getElementById('brain-box-sub');
    var titleEl = document.getElementById('brain-box-title');
    var splitGridEl = document.querySelector('.split-grid');
    var brainBoxEl = splitGridEl ? splitGridEl.querySelector('.brain-box') : null;
    if (brainBoxEl) brainBoxEl.style.display = '';
    if (splitGridEl) splitGridEl.classList.remove('chart-only');
    var cards = [];
    var merchantTasks = Array.isArray(dashData.merchantTasks) ? dashData.merchantTasks.filter(Boolean) : [];
    var mainPrimary = buildAllMoveItems(dashData)[0];
    var skipTitle = (merchantTasks[0] && merchantTasks[0].title) || (mainPrimary ? mainPrimary.title : '');
    var hasPrimaryTask = merchantTasks.length > 0 || !!mainPrimary;

    function shouldSkip(title, body) {
      if (!skipTitle) return false;
      return textsOverlap(title, skipTitle) || textsOverlap(body, skipTitle);
    }

    // Prefer remaining merchant tasks after #1 — one card per distinct advice.
    var seenTaskFp = {};
    merchantTasks.slice(1, 6).forEach(function (t) {
      var body = t.action || t.why || '';
      var fp = insightCopyFingerprint(t.title, body);
      if (seenTaskFp[fp]) return;
      seenTaskFp[fp] = true;
      cards.push({
        sev: String(t.severity || 'medium').toLowerCase(),
        title: t.title,
        body: body,
        isTask: true,
      });
    });

    if (cards.length < 3) {
      var feed = (dashData.brain && Array.isArray(dashData.brain.cmoFeedV2)) ? dashData.brain.cmoFeedV2 : [];
      var seenBrainFp = {};
      feed.slice(0, 8).forEach(function (it) {
        if (shouldSkip(it.title, it.body)) return;
        if (isGenericInsightCopy(it.title, it.body)) return;
        var sev = it.severity === 'CRITICAL' ? 'critical' : it.severity === 'HIGH' ? 'high' : 'medium';
        var title = it.title || it.campaignName || lbl('AI decision', 'قرار ذكي');
        var body = !it.generatedAt ? lbl('AI summary pending…', 'جاري تجهيز الملخص…') : (it.body || lbl('Action recommended', 'إجراء مقترح'));
        if (shouldSkip(title, body)) return;
        var fp = insightCopyFingerprint(title, body);
        if (seenBrainFp[fp]) return;
        seenBrainFp[fp] = true;
        cards.push({ sev: sev, title: title, body: body });
      });
    }

    if (cards.length < 3) {
      var issues = Array.isArray(dashData.issues) ? dashData.issues.slice() : [];
      issues.sort(function (a, b) {
        return severityRank(a.severity) - severityRank(b.severity);
      });
      issues.slice(0, 4).forEach(function (iss) {
        var sev = (iss.severity || 'medium').toLowerCase();
        var rec = Array.isArray(iss.recommendations) ? iss.recommendations[0] : (iss.recommendations || '');
        var title = iss.title || iss.code || lbl('Observation', 'ملاحظة');
        var body = rec || lbl('Review affected campaigns and adjust strategy.', 'راجع الحملات المتأثرة وعدّل الاستراتيجية.');
        if (shouldSkip(title, body)) return;
        if (cards.some(function (c) { return textsOverlap(c.title, title); })) return;
        cards.push({ sev: sev, title: title, body: body });
      });
    }

    if (titleEl) {
      titleEl.textContent = hasPrimaryTask
        ? lbl('Other tasks', 'مهام أخرى')
        : lbl('Smart assistant', 'مساعدك الذكي');
    }

    if (cards.length === 0) {
      // Never paint fake "مستقر" when a primary task exists above.
      if (hasPrimaryTask) {
        // Nothing beyond the primary task — hide the box entirely instead of
        // leaving a tall near-empty card next to the chart.
        if (brainBoxEl) brainBoxEl.style.display = 'none';
        if (splitGridEl) splitGridEl.classList.add('chart-only');
        return;
      }
      var steadyForBrain = getSteadyState(dashData);
      if (steadyForBrain && renderSteadyBrainBox(steadyForBrain)) return;
      var fallbackBrain = buildClientSteadyFallback(dashData, []);
      if (renderSteadyBrainBox(fallbackBrain)) return;
      list.innerHTML = '<div class="v2-action-empty">' + escHtml(lbl(
        'Account is steady — no strategic actions needed right now.',
        'الحساب مستقر — لا توجد إجراءات استراتيجية الآن.'
      )) + '</div>';
      if (sub) sub.textContent = lbl('All clear', 'كل شيء مستقر');
      return;
    }
    list.innerHTML = cards.slice(0, 6).map(function (c) {
      var sevLabel = c.sev === 'critical' ? lbl('Critical', 'مستعجل')
        : c.sev === 'high' ? lbl('High', 'مهم')
        : c.sev === 'medium' ? lbl('Watch', 'للمتابعة')
        : lbl('Info', 'معلومة');
      return '<div class="strategy-card ' + c.sev + '">'
        + '<div class="strategy-head">'
          + '<div class="strategy-title">' + escHtml(c.title) + '</div>'
          + '<span class="strategy-sev">' + escHtml(sevLabel) + '</span>'
        + '</div>'
        + '<div class="strategy-body">' + escHtml(c.body) + '</div>'
      + '</div>';
    }).join('');
    if (sub) {
      sub.textContent = cards.length + ' ' + lbl(
        cards.length === 1 ? 'item' : 'items',
        cards.length === 1 ? 'عنصر' : 'عناصر'
      );
    }
  }

  // ── Advanced: KPI / Issues / Campaign table ─────────────────────────────
  ${renderKpisJs}
  ${renderIssuesJs}
  ${renderDiagnosesJs}

  // Draw/refresh the Advanced Analytics trend charts — only while their
  // <details> is open (see the 0×0-canvas note above). Hides a card whose
  // series is all zeros instead of showing an empty box.
  function renderAdvancedChartsIfOpen() {
    renderAdvancedCharts(true);
  }

  function renderAttribution(attr) {
    var section = document.getElementById('attribution-section');
    if (!attr || !section) { if (section) section.style.display = 'none'; return; }
    section.style.display = 'block';
    var DRIVER_AR = { impressions: 'الظهور', ctr: 'نسبة النقر', cvr: 'نسبة التحويل' };
    var factors = [
      { key: 'impressions', label: 'الظهور', delta: attr.drivers.impressions.change, contribution: attr.drivers.impressions.contribution },
      { key: 'ctr', label: 'نسبة النقر', delta: attr.drivers.ctr.change, contribution: attr.drivers.ctr.contribution },
      { key: 'cvr', label: 'نسبة التحويل', delta: attr.drivers.cvr.change, contribution: attr.drivers.cvr.contribution },
    ];
    var totalDir = attr.totalChange >= 0 ? 'ارتفعت' : 'انخفضت';
    section.innerHTML = '<div class="adv-panel-head"><div>'
      + '<div class="adv-panel-kicker">تفسير</div>'
      + '<div class="adv-panel-title">لماذا تغيّرت النتائج؟</div>'
      + '</div></div>'
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
      + '<div class="attribution-narrative">' + escHtml(
          attr.drivers && attr.drivers.impressions && attr.drivers.ctr && attr.drivers.cvr
            ? ('النتائج ' + totalDir + ' ' + Math.abs((attr.totalChange || 0) * 100).toFixed(0) + '% — '
              + 'الظهور ' + (attr.drivers.impressions.change >= 0 ? '+' : '−') + Math.abs(attr.drivers.impressions.change * 100).toFixed(0) + '%، '
              + 'نسبة النقر ' + (attr.drivers.ctr.change >= 0 ? '+' : '−') + Math.abs(attr.drivers.ctr.change * 100).toFixed(0) + '%، '
              + 'نسبة التحويل ' + (attr.drivers.cvr.change >= 0 ? '+' : '−') + Math.abs(attr.drivers.cvr.change * 100).toFixed(0) + '%. '
              + 'السبب الرئيسي: ' + (DRIVER_AR[attr.primaryDriver] || attr.primaryDriver) + '.')
            : attr.narrative
        ) + '</div>';
  }

  // ── Tier 1: Executive Pulse Banner ──────────────────────────────────────
  function normalizeForDedupe(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function textsOverlap(a, b) {
    var na = normalizeForDedupe(a);
    var nb = normalizeForDedupe(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 12 && nb.length >= 12 && (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) return true;
    return false;
  }
  function issueIndicatesBudgetWaste(iss) {
    var blob = ((iss.code || '') + ' ' + (iss.title || '') + ' ' + (Array.isArray(iss.causes) ? iss.causes.join(' ') : '')).toUpperCase();
    return /BUDGET|WASTE|BURN|OVERSPEND|BLEED|SPEND/.test(blob);
  }
  function deriveBusinessHealth(dashData) {
    var healthyFallback = {
      level: 'healthy',
      text: lbl('Status: Healthy. Your ads are converting efficiently.', 'الحالة: جيد. إعلاناتك تحقق نتائج بكفاءة.'),
    };
    try {
      if (!dashData) return healthyFallback;
      var issues = Array.isArray(dashData.issues) ? dashData.issues.filter(Boolean) : [];
      var tasks = Array.isArray(dashData.merchantTasks) ? dashData.merchantTasks.filter(Boolean) : [];
      var topTask = tasks[0] || null;
      var hasCritical = issues.some(function (i) { return (i.severity || '').toLowerCase() === 'critical'; })
        || tasks.some(function (t) { return String(t.severity || '').toUpperCase() === 'CRITICAL'; });
      var hasHigh = issues.some(function (i) { return (i.severity || '').toLowerCase() === 'high'; })
        || tasks.some(function (t) { return String(t.severity || '').toUpperCase() === 'HIGH'; });
      var budgetWaste = issues.some(issueIndicatesBudgetWaste);
      var band = (dashData.health && dashData.health.band) || 'none';
      var pulse = dashData.brain && dashData.brain.livePulse;
      if (pulse && pulse.intraDaySpendPct != null && pulse.intraDaySpendPct >= 85) budgetWaste = true;
      var feed = (dashData.brain && Array.isArray(dashData.brain.cmoFeedV2)) ? dashData.brain.cmoFeedV2 : [];
      if (feed.some(function (it) { return it && it.severity === 'CRITICAL'; })) hasCritical = true;

      if (hasCritical || band === 'poor' || (hasHigh && budgetWaste)) {
        return {
          level: 'critical',
          text: topTask
            ? lbl(
                'Status: Immediate action needed — ' + topTask.title,
                'الحالة: انتبه — ' + topTask.title
              )
            : lbl(
                'Status: Immediate Action Required. We detected budget waste.',
                'الحالة: انتبه، توجد حملات تهدر الميزانية حالياً'
              ),
        };
      }
      if (hasHigh || band === 'attention' || budgetWaste || topTask) {
        return {
          level: 'warning',
          text: topTask
            ? lbl(
                'Status: Needs attention — start with: ' + topTask.action,
                'الحالة: يحتاج انتباه — ابدأ بـ: ' + topTask.action
              )
            : lbl(
                'Status: Needs Attention. Some campaigns need a quick review.',
                'الحالة: يحتاج انتباه. بعض الحملات تحتاج مراجعة سريعة.'
              ),
        };
      }
      return healthyFallback;
    } catch (e) {
      console.error('[dashboard] deriveBusinessHealth failed:', e);
      return healthyFallback;
    }
  }
  function renderExecutivePulse(dashData) {
    var sec = document.getElementById('exec-pulse-section');
    var el = document.getElementById('exec-pulse-text');
    if (!sec || !el) return;
    if (hasPrimaryMerchantTask(dashData)) {
      sec.style.display = 'none';
      return;
    }
    var health = deriveBusinessHealth(dashData);
    sec.className = 'exec-pulse-banner ' + health.level;
    el.textContent = health.text;

    var detailEl = document.getElementById('exec-pulse-detail');
    var scoreChip = document.getElementById('exec-pulse-score');
    var scoreNum = document.getElementById('exec-pulse-score-num');
    var scoreLbl = document.getElementById('exec-pulse-score-lbl');
    var ctaEl = document.getElementById('exec-pulse-cta');

    if (detailEl && dashData.health) {
      var recs = dashData.aiRecommendations;
      var urgentCount = 0;
      if (Array.isArray(recs)) {
        for (var ri = 0; ri < recs.length; ri++) {
          if (recs[ri].priority === 'high' || recs[ri].priority === 'urgent') urgentCount++;
        }
      }
      var detailParts = [];
      if (urgentCount > 0) {
        detailParts.push(urgentCount + ' ' + lbl('urgent actions', 'إجراء عاجل'));
      }
      var predCount = dashData.predictions ? (dashData.predictions.budgetPredictions || []).length + (dashData.predictions.fatiguePredictions || []).length : 0;
      if (predCount > 0) {
        detailParts.push(predCount + ' ' + lbl('alerts', 'تنبيه'));
      }
      detailEl.textContent = detailParts.length ? detailParts.join(' · ') : '';
    }

    // The gauge above already shows the score big — only repeat it here
    // when the gauge is hidden, otherwise it reads as duplicated data.
    var gaugeEl = document.getElementById('health-gauge-section');
    var gaugeVisible = gaugeEl && gaugeEl.style.display !== 'none';
    if (scoreChip) {
      if (!gaugeVisible && scoreNum && scoreLbl && dashData.health && dashData.health.score != null) {
        scoreNum.textContent = String(dashData.health.score);
        var bandLabels = { excellent: lbl('Excellent', 'ممتاز'), good: lbl('Good', 'جيد'), attention: lbl('Attention', 'انتبه'), poor: lbl('Poor', 'ضعيف'), none: '' };
        scoreLbl.textContent = bandLabels[dashData.health.band] || '';
        scoreChip.style.display = 'flex';
        scoreChip.className = 'exec-pulse-score-chip band-' + (dashData.health.band || 'none');
      } else {
        scoreChip.style.display = 'none';
      }
    }

    if (ctaEl) {
      if (health.level === 'critical') {
        ctaEl.textContent = lbl('Fix now', 'عالج الآن');
        ctaEl.href = '/ai?q=' + encodeURIComponent(lbl('What is wrong with my campaigns?', 'ما مشكلة حملاتي؟'));
        ctaEl.style.display = 'inline-flex';
        ctaEl.className = 'exec-pulse-cta cta-critical';
      } else if (health.level === 'warning') {
        ctaEl.textContent = lbl('Review', 'راجع');
        ctaEl.href = '/ai?q=' + encodeURIComponent(lbl('What needs attention today?', 'ماذا يحتاج اهتمام اليوم؟'));
        ctaEl.style.display = 'inline-flex';
        ctaEl.className = 'exec-pulse-cta cta-warning';
      } else {
        ctaEl.style.display = 'none';
      }
    }

    sec.style.display = 'flex';
  }

  // ── Tier 2+3: Main Move (unified focus + narrative) ─────────────────────
  function severityRank(s) {
    var order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[(s || 'medium').toLowerCase()] != null ? order[(s || 'medium').toLowerCase()] : 9;
  }
  function feedSeverityRank(s) {
    if (s === 'CRITICAL') return 0;
    if (s === 'HIGH') return 1;
    return 2;
  }
  function savedSpendLabel(dashData) {
    var ledger = dashData.brain && dashData.brain.ledger;
    if (ledger && ledger.savedSpendDisplay && ledger.savedSpend > 0) {
      return lbl('Save ' + ledger.savedSpendDisplay, 'وفّر ' + ledger.savedSpendDisplay);
    }
    return null;
  }
  function issueActionCode(iss, dashData) {
    var kb = iss && iss.evidence && iss.evidence.knowledgeBase;
    var kbActions = kb && kb.recommended_optimization_actions;
    if (Array.isArray(kbActions) && kbActions[0] && kbActions[0].id) return kbActions[0].id;
    if (dashData && dashData.priorityAction && dashData.priorityAction.actionCode) {
      return dashData.priorityAction.actionCode;
    }
    return iss && iss.code ? String(iss.code) : null;
  }
  function buildAllMoveItems(dashData) {
    try {
      if (!dashData) return [];
      var items = [];
      var seen = [];

      function pushItem(item) {
        if (!item || !item.title) return;
        for (var i = 0; i < seen.length; i++) {
          if (textsOverlap(seen[i], item.title) || (item.narrative && textsOverlap(seen[i], item.narrative))) return;
        }
        seen.push(item.title);
        if (item.narrative) seen.push(item.narrative);
        items.push(item);
      }

      var issues = Array.isArray(dashData.issues) ? dashData.issues.filter(Boolean).slice() : [];
      issues.sort(function (a, b) { return severityRank(a.severity) - severityRank(b.severity); });

      issues.forEach(function (iss) {
        if (!iss) return;
        var sev = (iss.severity || 'medium').toLowerCase();
        var recs = Array.isArray(iss.recommendations) ? iss.recommendations : (iss.recommendations ? [iss.recommendations] : []);
        var decision = recs[0] || lbl('Review and resolve', 'راجع الحملة وطبّق التوصية');
        var causes = Array.isArray(iss.causes) ? iss.causes.join(' · ') : (iss.causes || '');
        pushItem({
          kind: 'issue',
          itemId: 'issue:' + (iss.code || iss.title || 'unknown'),
          issueCode: iss.code || null,
          actionCode: issueActionCode(iss, dashData),
          rank: severityRank(sev),
          severity: sev,
          title: (iss.title && !/^[A-Z0-9_]+$/.test(String(iss.title)))
            ? iss.title
            : lbl('Action needed', 'ملاحظة على الحساب'),
          decision: decision,
          steps: recs.slice(0, 4),
          narrative: causes || decision,
          impact: savedSpendLabel(dashData),
          buttonText: sev === 'critical' ? lbl('Do this task', 'نفّذ المهمة') : lbl('Review task', 'راجع المهمة'),
          confidence: iss.confidence || (sev === 'critical' ? 92 : sev === 'high' ? 86 : 78),
        });
      });

      if (dashData.priorityAction) {
        var pa = dashData.priorityAction;
        var paText = typeof pa === 'string' ? pa : (pa.text || '');
        if (!paText || /^[A-Z0-9_]+$/.test(String(paText))) {
          paText = lbl('Review campaigns and apply one clear change.', 'راجع الحملات وطبّق تعديلاً واحداً واضحاً');
        }
        if (paText) {
          pushItem({
            kind: 'priority',
            itemId: 'priority:' + (pa.actionCode || 'top'),
            actionCode: pa.actionCode || null,
            rank: 0.5,
            severity: 'high',
            title: paText,
            decision: paText,
            steps: [paText],
            narrative: paText,
            impact: savedSpendLabel(dashData),
            buttonText: lbl('Do this task', 'نفّذ المهمة'),
            confidence: 92,
          });
        }
      }

      var feed = (dashData.brain && Array.isArray(dashData.brain.cmoFeedV2)) ? dashData.brain.cmoFeedV2.filter(Boolean).slice() : [];
      feed.sort(function (a, b) { return feedSeverityRank(a.severity) - feedSeverityRank(b.severity); });
      var seenMoveFp = {};
      feed.forEach(function (it) {
        if (!it || !it.generatedAt) return;
        if (isGenericInsightCopy(it.title, it.body)) return;
        var moveFp = insightCopyFingerprint(it.title, it.body);
        if (seenMoveFp[moveFp]) return;
        seenMoveFp[moveFp] = true;
        var sev = it.severity === 'CRITICAL' ? 'critical' : it.severity === 'HIGH' ? 'high' : 'medium';
        pushItem({
          kind: 'feed',
          itemId: 'feed:' + (it.dedupeKey || it.id || it.campaignName || it.title || 'unknown'),
          actionCode: dashData.priorityAction && dashData.priorityAction.actionCode ? dashData.priorityAction.actionCode : null,
          campaignId: it.campaignId || null,
          campaignName: it.campaignName || null,
          feedKey: it.dedupeKey || null,
          rank: feedSeverityRank(it.severity) + 0.1,
          severity: sev,
          title: it.title || it.campaignName || lbl('AI decision', 'قرار ذكي'),
          decision: it.body || lbl('Review AI recommendation', 'راجع توصية الذكاء الاصطناعي'),
          steps: it.body ? [it.body] : [],
          narrative: it.bodyFull || it.body || '',
          impact: savedSpendLabel(dashData),
          buttonText: sev === 'critical' ? lbl('Do this task', 'نفّذ المهمة') : lbl('Review task', 'راجع المهمة'),
          confidence: sev === 'critical' ? 90 : 82,
        });
      });

      items.sort(function (a, b) { return a.rank - b.rank; });
      return items;
    } catch (e) {
      console.error('[dashboard] buildAllMoveItems failed:', e);
      return [];
    }
  }
  function pickMainMoveNarrative(primary, dashData, kpis) {
    try {
      if (!primary) return '';
      if (primary.narrative && primary.narrative !== primary.decision && primary.narrative !== primary.title) {
        return primary.narrative;
      }
      var kpiList = Array.isArray(kpis) ? kpis : [];
      var ctr = kpiList.find(function (k) { return k && (k.key || '').toLowerCase() === 'ctr'; });
      if (ctr && ctr.deltaPct != null) {
        var up = ctr.direction === 'up';
        return lbl(
          'Engagement moved ' + (up ? '+' : '-') + Math.abs(Number(ctr.deltaPct) * 100).toFixed(1) + '% vs prior period.',
          'تفاعل الإعلان ' + (up ? 'ارتفع' : 'انخفض') + ' مقارنة بالفترة السابقة.'
        );
      }
      return primary.decision || '';
    } catch (e) {
      console.error('[dashboard] pickMainMoveNarrative failed:', e);
      return (primary && primary.decision) || '';
    }
  }
  function renderBleedAlert(dashData) {
    var box = document.getElementById('bleed-alert');
    if (!box) return;
    var alert = dashData && dashData.bleedAlert;
    if (!alert || !alert.text) { box.style.display = 'none'; return; }
    box.textContent = alert.text;
    box.style.display = 'block';
  }

  function renderInsightStrip(dashData) {
    var strip = document.getElementById('insight-strip');
    if (!strip) return;
    var chips = [];
    if (dashData && dashData.audienceInsight && dashData.audienceInsight.text) {
      chips.push('<div class="insight-chip"><span class="ic">🎯</span><span>' + escHtml(dashData.audienceInsight.text) + '</span></div>');
    }
    if (dashData && dashData.forecast && dashData.forecast.text) {
      chips.push('<div class="insight-chip"><span class="ic">🔮</span><span>' + escHtml(dashData.forecast.text) + '</span></div>');
    }
    if (chips.length === 0) { strip.style.display = 'none'; return; }
    strip.innerHTML = chips.join('');
    strip.style.display = 'flex';
  }

  function renderMorningStory(dashData) {
    var box = document.getElementById('morning-story');
    var textEl = document.getElementById('morning-story-text');
    var dateEl = document.getElementById('morning-story-date');
    if (!box || !textEl) return;
    var story = dashData && dashData.morningStory;
    if (!story || !story.text) { box.style.display = 'none'; return; }
    textEl.textContent = story.text;
    if (dateEl) dateEl.textContent = story.date || '';
    box.style.display = 'flex';
  // "Ask AI why" deep-link — hands the Main Move item's own title/campaign
  // straight to the /ai chat as a prefilled question (see aiPage.ts's ?q=
  // handling), instead of duplicating a root-cause explanation UI here.
  function mainMoveAiQuestion(item) {
    var title = item.title || lbl('this priority', 'هذه الأولوية');
    var q = lbl(
      'Explain simply: ' + title + '. What should I do now step by step, and when should I review the result?',
      'اشرح لي ببساطة: ' + title + '. ماذا أفعل الآن خطوة بخطوة؟ ومتى أراجع النتيجة؟'
    );
    if (item.campaignName) q += lbl(' (campaign: ', ' (حملة: ') + item.campaignName + ')';
    return q;
  }
  function confBadge(confidence) {
    if (confidence == null || !isFinite(Number(confidence))) return null;
    var c = Number(confidence);
    if (c > 1) c = c / 100;
    c = Math.max(0, Math.min(1, c));
    var level = c >= 0.75 ? 'high' : c >= 0.5 ? 'medium' : 'low';
    var label = c >= 0.75 ? 'ثقة عالية' : c >= 0.5 ? 'ثقة متوسطة' : 'ثقة منخفضة';
    return { level: level, label: label, pct: Math.round(c * 100) };
  }

  function renderMainMove(dashData, kpis) {
    var card = document.getElementById('main-move-card');
    var meta = document.getElementById('main-move-meta');
    var label = document.getElementById('main-move-label');
    var kicker = document.getElementById('main-move-kicker');
    var sub = document.getElementById('main-move-sub');
    if (!card) return;
    try {
    if (kicker) kicker.textContent = lbl('Top priority', 'أهم شيء الآن');
    if (label) label.textContent = lbl('Diagnosis + fix', 'تشخيص + حل');
    if (sub) sub.textContent = lbl('Why results changed · what to do now', 'لماذا تغيّرت النتائج · وماذا تفعل الآن');
    var merchantTasks = Array.isArray(dashData.merchantTasks) ? dashData.merchantTasks.filter(Boolean) : [];
    var diagnoses = Array.isArray(dashData.diagnoses) ? dashData.diagnoses.filter(Boolean) : [];
    var items = buildAllMoveItems(dashData);
    if (items.length === 0 && !merchantTasks.length && !diagnoses.length) {
      var steady = getSteadyState(dashData) || buildClientSteadyFallback(dashData, kpis);
      if (renderSteadyMainMove(steady)) return;
      if (meta) meta.textContent = lbl('All clear', 'كل شيء مستقر');
      state.mainMovePrimary = null;
      card.innerHTML = '<div class="main-move-empty">' + escHtml(lbl(
        'No actions for today. Account is steady.',
        'لا توجد مهام اليوم. حسابك مستقر.'
      )) + '</div>';
      return;
    }

    var task = merchantTasks[0] || null;
    // Prefer raw diagnosis[0] if merchantTasks somehow missed it.
    if (!task && diagnoses[0]) {
      var d0 = diagnoses[0];
      task = {
        itemKey: (d0.contributingIssues && d0.contributingIssues[0]) ? ('issue:' + d0.contributingIssues[0]) : ('diagnosis:' + d0.code),
        issueCode: (d0.contributingIssues && d0.contributingIssues[0]) || null,
        diagnosisCode: d0.code,
        title: d0.name,
        why: d0.narrative,
        action: d0.action,
        expect: '',
        steps: [],
        confidence: d0.confidence,
        severity: 'HIGH',
        severityLabel: 'مهم',
      };
    }
    var primary = items[0] || null;
    if (task && !primary) {
      primary = {
        kind: task.diagnosisCode ? 'diagnosis' : 'issue',
        itemId: task.itemKey,
        issueCode: task.issueCode,
        actionCode: task.actionCode,
        severity: String(task.severity || 'high').toLowerCase(),
        title: task.title,
        decision: task.action,
        steps: task.steps || [],
        narrative: task.why,
        buttonText: lbl('Do this task', 'نفّذ المهمة'),
        confidence: task.confidence != null ? Math.round(Number(task.confidence) * (Number(task.confidence) <= 1 ? 100 : 1)) : 90,
      };
    }
    if (task && primary) {
      primary.title = task.title || primary.title;
      primary.decision = task.action || primary.decision;
      primary.steps = (task.steps && task.steps.length) ? task.steps : primary.steps;
      primary.narrative = task.why || primary.narrative;
      primary.itemId = task.itemKey || primary.itemId;
      primary.actionCode = task.actionCode || primary.actionCode;
      primary.kind = task.diagnosisCode ? 'diagnosis'
        : (task.itemKey && String(task.itemKey).indexOf('priority:') === 0) ? 'priority' : 'issue';
      primary.buttonText = lbl('Do this task', 'نفّذ المهمة');
      if (task.confidence != null) {
        primary.confidence = Math.round(Number(task.confidence) * (Number(task.confidence) <= 1 ? 100 : 1));
      }
    }

    var secondary = items.slice(primary && items[0] === primary ? 1 : 0, 6).filter(function (it) {
      return !task || it.itemId !== task.itemKey;
    }).slice(0, 5);

    if (meta) {
      meta.textContent = secondary.length > 0
        ? lbl(secondary.length + ' more below', secondary.length + ' إضافية بالأسفل')
        : lbl('Primary diagnosis', 'التشخيص الأساسي');
    }

    var sevCls = primary.severity === 'critical' ? 'has-critical' : primary.severity === 'high' ? 'has-warning' : '';
    var ctaCls = primary.severity === 'critical' ? ' critical' : '';
    var why = (task && task.why) || pickMainMoveNarrative(primary, dashData, kpis);
    var expect = (task && task.expect) || '';
    var badge = confBadge(task && task.confidence != null ? task.confidence : (primary.confidence != null ? primary.confidence / 100 : null));
    var badgeHtml = badge
      ? '<span class="diagnosis-confidence ' + badge.level + '">' + escHtml(badge.label + ' ' + badge.pct + '%') + '</span>'
      : '';

    // Decision-card enrichment: money cost, corroborating evidence, and the
    // outcome-memory expectation — all server-computed on priorityAction.
    var pa = dashData && dashData.priorityAction ? dashData.priorityAction : null;
    var costHtml = pa && pa.costDisplay
      ? '<div class="main-move-cost">💸 ' + escHtml(lbl('Current dip is costing you ~', 'التراجع الحالي يكلفك ~') + pa.costDisplay) + '</div>'
      : '';
    var evidenceHtml = pa && pa.evidence && pa.evidence.length
      ? '<div class="main-move-evidence">' + pa.evidence.map(function (t) {
          return '<span class="main-move-evidence-chip">' + escHtml(t) + '</span>';
        }).join('') + '</div>'
      : '';
    var expectationHtml = pa && pa.expectation
      ? '<div class="main-move-expect">📈 ' + escHtml(pa.expectation) + '</div>'
      : '';

    var html = '<div class="main-move-primary ' + sevCls + '" dir="auto">'
      + '<div class="main-move-tag">' + escHtml(lbl("Today's #1 priority", 'الأولوية الأولى اليوم')) + '</div>'
      + '<div class="main-move-title">' + escHtml(primary.title) + '</div>'
      + impactHtml
      + costHtml
      + evidenceHtml
      + (why ? '<div class="main-move-why">' + escHtml(why) + '</div>' : '')
      + expectationHtml
      + '<div class="main-move-cta-row">'
        + '<button class="main-move-cta' + ctaCls + '" type="button">' + escHtml(primary.buttonText) + '</button>'
        + '<span class="text-xs text-3">' + escHtml(lbl('Confidence', 'الثقة')) + ' ' + escHtml(String(primary.confidence)) + '%</span>'
      + '</div>'
    // Signature card: headline + confidence, then the golden thread —
    // evidence/diagnosis flowing into the recommendation as one continuous
    // line of reasoning (see .thread in layout.ts). Every step here is real
    // product data (why/decision/expect) — never invented sub-steps.
    var threadSteps = '';
    if (why) {
      threadSteps += '<div class="thread-step">'
        + '<div class="thread-step-label">' + escHtml(lbl('Evidence & diagnosis', 'الدليل والتشخيص')) + '</div>'
        + escHtml(why)
      + '</div>';
    }
    threadSteps += '<div class="thread-step thread-step--action">'
      + '<div class="thread-step-label">' + escHtml(lbl('Recommendation', 'التوصية')) + '</div>'
      + escHtml(primary.decision || primary.title)
      + (expect ? '<div class="thread-step-sub">' + escHtml(expect) + '</div>' : '')
    + '</div>';

    var html = '<article class="diagnosis-card diagnosis-card--hero ' + sevCls + '" dir="auto">'
      + (badgeHtml ? '<div class="diagnosis-header">' + badgeHtml + '</div>' : '')
      + '<div class="diagnosis-headline">' + escHtml(primary.title) + '</div>'
      + '<div class="thread"><div class="thread-steps">' + threadSteps + '</div></div>'
      + '<div class="main-move-cta-row diagnosis-cta-row">'
        + '<button class="main-move-cta' + ctaCls + '" type="button">' + escHtml(primary.buttonText || lbl('Do this task', 'نفّذ المهمة')) + '</button>'
        + '<a class="btn btn-secondary btn-sm" href="/ai?q=' + encodeURIComponent(mainMoveAiQuestion(primary)) + '">' + escHtml(lbl('Ask AI', 'اسأل المساعد')) + '</a>'
        + '<a class="btn btn-ghost btn-sm" href="/recommendations">' + escHtml(lbl('All tasks', 'كل المهام')) + '</a>'
      + '</div>'
    + '</article>';

    if (secondary.length > 0) {
      html += '<details class="main-move-more">'
        + '<summary>' + escHtml(lbl('Other priorities (' + secondary.length + ')', 'أولويات أخرى (' + secondary.length + ')')) + '</summary>'
        + '<div class="main-move-secondary">'
        + secondary.map(function (a, idx) {
          return '<div class="main-move-secondary-item" dir="auto">'
            + '<div class="main-move-secondary-pri">#' + (idx + 2) + '</div>'
            + '<div class="main-move-secondary-body">'
              + '<div class="main-move-secondary-title">' + escHtml(a.title) + '</div>'
              + '<div class="main-move-secondary-decision">' + escHtml(a.decision) + '</div>'
            + '</div>'
          + '</div>';
        }).join('')
        + '</div>'
      + '</details>';
    }
    card.innerHTML = html;
    state.mainMovePrimary = primary;
    } catch (e) {
      console.error('[dashboard] renderMainMove failed:', e);
      state.mainMovePrimary = null;
      card.innerHTML = '<div class="main-move-empty">' + escHtml(lbl(
        'No actions for today. Account is steady.',
        'لا توجد إجراءات اليوم. حسابك مستقر.'
      )) + '</div>';
    }
  }

  // ── Main Move action workflow ───────────────────────────────────────────
  function actionStepsForItem(item) {
    if (!item) return [];
    var steps = Array.isArray(item.steps) ? item.steps.filter(Boolean) : [];
    if (steps.length > 0) return steps;
    if (item.decision) return [item.decision];
    return [lbl('Review affected campaigns and apply the recommended fix.', 'راجع الحملات المتأثرة وطبّق الإصلاح الموصى به.')];
  }
  function closeActionModal() {
    var modal = document.getElementById('main-move-action-modal');
    if (modal) modal.style.display = 'none';
  }
  function openActionModal(item) {
    var modal = document.getElementById('main-move-action-modal');
    var titleEl = document.getElementById('action-modal-title');
    var subEl = document.getElementById('action-modal-subtitle');
    var stepsEl = document.getElementById('action-modal-steps');
    if (!modal || !titleEl || !subEl || !stepsEl) return;
    var steps = actionStepsForItem(item);
    titleEl.textContent = item.title || lbl('Recommended action', 'الإجراء الموصى به');
    var subtitleParts = [];
    if (item.campaignName) subtitleParts.push(item.campaignName);
    if (item.decision && item.decision !== item.title) subtitleParts.push(item.decision);
    subEl.textContent = subtitleParts.length > 0
      ? subtitleParts.join(' · ')
      : lbl('Follow these steps in Meta Ads Manager.', 'اتبع هذه الخطوات في مدير إعلانات فيسبوك ثم راجع النتيجة.');
    stepsEl.innerHTML = steps.map(function (step, idx) {
      return '<div class="action-modal-step" dir="auto"><b>' + (idx + 1) + '</b><span>' + escHtml(step) + '</span></div>';
    }).join('');
    var cancelBtn = document.getElementById('action-modal-cancel');
    var confirmBtn = document.getElementById('action-modal-confirm');
    if (cancelBtn) cancelBtn.textContent = lbl('Cancel', 'إلغاء');
    if (confirmBtn) confirmBtn.textContent = lbl("I've applied this", 'نفّذت المهمة');
    modal.style.display = 'flex';
  }
  async function confirmExecuteAction() {
    var item = state.mainMovePrimary;
    var confirmBtn = document.getElementById('action-modal-confirm');
    var cta = document.querySelector('.main-move-cta');
    if (!item || !state.workspaceId) return;
    if (!item.itemId) {
      toast(lbl('Cannot record this action — missing item id.', 'تعذّر تسجيل الإجراء — معرف مفقود.'), 'error');
      return;
    }
    if (confirmBtn) confirmBtn.disabled = true;
    var priorCtaText = cta ? cta.textContent : '';
    try {
      await apiFetch('/api/workspaces/' + encodeURIComponent(state.workspaceId) + '/recommendations/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'EXECUTED',
          itemKey: item.itemId,
          itemKind: item.kind || null,
          actionCode: item.actionCode || null,
          campaignId: item.campaignId || null,
          feedKey: item.feedKey || null,
          title: item.title || null,
        }),
      });
      toast(lbl('Action recorded — we’ll track results over the next 7 days.', 'تم تسجيل الإجراء — سنراقب النتائج خلال ٧ أيام.'), 'success');
      closeActionModal();
      if (cta) {
        cta.disabled = true;
        cta.textContent = lbl('Applied', 'تم التطبيق');
      }
      try {
        var refreshed = await apiFetch('/api/dashboard/' + encodeURIComponent(state.workspaceId));
        if (refreshed && !refreshed.empty) {
          applyDashboardData(refreshed, state.lastInsights || [], state.lastCampaigns || [], null, false);
        }
      } catch (refreshErr) {
        console.warn('[dashboard] post-action refresh failed:', refreshErr);
      }
    } catch (e) {
      console.error('[dashboard] confirmExecuteAction failed:', e);
      if (cta) {
        cta.disabled = false;
        cta.textContent = priorCtaText || item.buttonText || lbl('Fix Now', 'تطبيق الحل فوراً');
      }
      toast(lbl('Could not record action. Try again.', 'تعذّر تسجيل الإجراء. حاول مرة أخرى.'), 'error');
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }
  function handleExecuteAction(item) {
    if (!item) return;
    openActionModal(item);
  }
  function wireMainMoveActions() {
    var section = document.getElementById('main-move-section');
    if (!section || section.getAttribute('data-action-wired') === '1') return;
    section.setAttribute('data-action-wired', '1');
    section.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.main-move-cta');
      if (!btn || btn.disabled) return;
      handleExecuteAction(state.mainMovePrimary);
    });
    var modal = document.getElementById('main-move-action-modal');
    var cancelBtn = document.getElementById('action-modal-cancel');
    var confirmBtn = document.getElementById('action-modal-confirm');
    if (cancelBtn) cancelBtn.addEventListener('click', closeActionModal);
    if (confirmBtn) confirmBtn.addEventListener('click', confirmExecuteAction);
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeActionModal();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = document.getElementById('main-move-action-modal');
      if (m && m.style.display !== 'none') closeActionModal();
    });
  }
  // ── Health Score Gauge ──────────────────────────────────────────────────
  function estimateHealthScore(dashData) {
    if (!dashData) return null;
    var cc = dashData.workspace && dashData.workspace.campaignCounts;
    var hasActivity = cc && ((cc.deliveringInWindow || 0) > 0 || (cc.spendingToday || 0) > 0);
    var hasKpis = Array.isArray(dashData.kpis) && dashData.kpis.length > 0;
    if (!hasActivity && !hasKpis) return null;
    var level = deriveBusinessHealth(dashData).level;
    var score = level === 'critical' ? 35 : level === 'warning' ? 58 : 78;
    var issues = Array.isArray(dashData.issues) ? dashData.issues : [];
    issues.forEach(function (i) {
      var s = (i.severity || '').toLowerCase();
      if (s === 'critical') score -= 8;
      else if (s === 'high') score -= 4;
      else score -= 1;
    });
    var recs = dashData.aiRecommendations && dashData.aiRecommendations.recommendations;
    if (Array.isArray(recs)) {
      recs.forEach(function (r) { if (r.category === 'scale') score += 2; });
    }
    return Math.max(15, Math.min(92, Math.round(score)));
  }

  function renderHealthGauge(dashData) {
    var section = document.getElementById('health-gauge-section');
    if (!section) return;

    var health = dashData && dashData.health;
    var score = health ? health.score : null;
    var band = health ? health.band : 'none';
    var isEstimated = false;

    if (score == null || band === 'none') {
      // Server score not computed yet — estimate client-side from the same
      // signals the pulse uses, and label it as estimated.
      var est = estimateHealthScore(dashData);
      if (est == null) { section.style.display = 'none'; return; }
      score = est;
      band = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'attention' : 'poor';
      isEstimated = true;
    }

    section.style.display = '';
    section.classList.add('section-enter');

    var colors = {
      excellent: { start: '#34A871', end: '#2DD4A0' },
      good:      { start: '#D9A759', end: '#E8C97A' },
      attention: { start: '#C77A1F', end: '#E89C3F' },
      poor:      { start: '#E2604F', end: '#F07C6F' }
    };
    var c = colors[band] || colors.attention;

    var ARC_LEN = 358.14;
    var filled = ARC_LEN * (score / 100);
    var arc = document.getElementById('health-gauge-arc');
    if (arc) {
      arc.setAttribute('stroke', 'url(#gauge-grad)');
      setTimeout(function () {
        arc.setAttribute('stroke-dasharray', filled + ' 477.52');
      }, 60);
    }

    var gradStart = document.getElementById('gauge-grad-start');
    var gradEnd = document.getElementById('gauge-grad-end');
    if (gradStart) gradStart.setAttribute('stop-color', c.start);
    if (gradEnd) gradEnd.setAttribute('stop-color', c.end);

    var scoreText = document.getElementById('hg-score-num');
    // A leading "~" signals the number is an approximation, not the server's
    // authoritative score — so it doesn't read as exact then "jump" on sync.
    if (scoreText) scoreText.textContent = (isEstimated ? '~' : '') + String(Math.round(score));

    var bandLabels = {
      excellent: lbl('Excellent', 'ممتاز'),
      good: lbl('Good', 'جيد'),
      attention: lbl('Needs Attention', 'يحتاج انتباه'),
      poor: lbl('Poor', 'ضعيف')
    };
    var bandText = document.getElementById('hg-band-label');
    if (bandText) {
      bandText.textContent = bandLabels[band] || band;
      bandText.style.color = c.start;
      bandText.style.borderColor = c.start + '44';
    }

    var subtitleEl = document.getElementById('hg-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = lbl('Score: ', 'النقاط: ') + Math.round(score) + '/100'
        + (isEstimated ? lbl(' · estimated', ' · تقديري') : '');
    }

    var statusMessages = {
      excellent: lbl('Your campaigns are in great shape. Keep it up!', 'حملاتك في أفضل حالاتها. استمر!'),
      good: lbl('Good performance overall. A few tweaks could help.', 'أداء جيد بشكل عام. بعض التعديلات قد تساعد.'),
      attention: lbl('Some campaigns need your attention soon.', 'بعض الحملات تحتاج انتباهك قريباً.'),
      poor: lbl('Urgent: several campaigns need immediate fixes.', 'عاجل: عدة حملات تحتاج إصلاحات فورية.')
    };
    var statusEl = document.getElementById('hg-status');
    if (statusEl) statusEl.textContent = statusMessages[band] || '';

    var metricsEl = document.getElementById('hg-metrics');
    if (metricsEl) {
      var recs = dashData.aiRecommendations;
      var preds = dashData.predictions;
      var cc = dashData.workspace && dashData.workspace.campaignCounts;
      var activeCount = cc
        ? (cc.deliveringInWindow || cc.spendingToday || cc.active || 0)
        : (dashData.weeklyReport && dashData.weeklyReport.activeCampaigns) || 0;
      var recCount = recs && Array.isArray(recs.recommendations) ? recs.recommendations.length : 0;
      var predCount = preds
        ? ((preds.budgetExhaustion || []).length + (preds.creativeFatigue || []).length)
        : 0;

      var bandClass = band === 'excellent' ? 'hg-m-success' : band === 'good' ? 'hg-m-accent' : band === 'attention' ? 'hg-m-warning' : 'hg-m-error';
      metricsEl.innerHTML =
        '<div class="hg-metric ' + bandClass + '">'
        + '<span class="hg-metric-val">' + activeCount + '</span>'
        + '<span class="hg-metric-lbl">' + lbl('Active', 'نشطة') + '</span>'
        + '</div>'
        + '<div class="hg-metric">'
        + '<span class="hg-metric-val">' + recCount + '</span>'
        + '<span class="hg-metric-lbl">' + lbl('Recommendations', 'توصيات') + '</span>'
        + '</div>'
        + '<div class="hg-metric">'
        + '<span class="hg-metric-val">' + predCount + '</span>'
        + '<span class="hg-metric-lbl">' + lbl('Warnings', 'تحذيرات') + '</span>'
        + '</div>';
    }

    var actionLink = document.getElementById('hg-action-link');
    var actionText = document.getElementById('hg-action-text');
    if (actionLink && actionText) {
      if (band === 'poor' || band === 'attention') {
        actionLink.style.display = '';
        actionText.textContent = lbl('See what needs review', 'اعرض ما يحتاج مراجعة');
        actionLink.href = '/ai?q=' + encodeURIComponent(
          band === 'poor'
            ? lbl('My account health score is low. What should I fix first?', 'نقاط صحة حسابي منخفضة. ماذا يجب أن أصلح أولاً؟')
            : lbl('What can I improve in my campaigns?', 'ما الذي يمكنني تحسينه في حملاتي؟')
        );
      } else {
        actionLink.style.display = 'none';
      }
    }
  }

  // ── Quick / Advanced Mode Toggle ──────────────────────────────────────
  var _dashMode = 'advanced';
  try { _dashMode = localStorage.getItem('adlytic_dash_mode') || 'advanced'; } catch (e) {}

  function setDashMode(mode) {
    _dashMode = mode;
    try { localStorage.setItem('adlytic_dash_mode', mode); } catch (e) {}
    var dc = document.getElementById('dashboard-content');
    if (dc) dc.setAttribute('data-dash-mode', mode);
    var qb = document.getElementById('mode-quick-btn');
    var ab = document.getElementById('mode-adv-btn');
    if (qb) qb.className = 'mode-btn' + (mode === 'quick' ? ' active' : '');
    if (ab) ab.className = 'mode-btn' + (mode === 'advanced' ? ' active' : '');
  }

  (function initModeToggle() {
    var dc = document.getElementById('dashboard-content');
    if (dc) dc.setAttribute('data-dash-mode', _dashMode);
    var qb = document.getElementById('mode-quick-btn');
    var ab = document.getElementById('mode-adv-btn');
    if (qb) {
      qb.className = 'mode-btn' + (_dashMode === 'quick' ? ' active' : '');
      qb.addEventListener('click', function () { setDashMode('quick'); });
    }
    if (ab) {
      ab.className = 'mode-btn' + (_dashMode === 'advanced' ? ' active' : '');
      ab.addEventListener('click', function () { setDashMode('advanced'); });
    }
  })();

  // ── Predictions ──────────────────────────────────────────────────────────
  var _predAllCards = [];
  var _predActiveFilter = 'all';

  function renderPredictions(pred) {
    var section = document.getElementById('predictions-section');
    var grid = document.getElementById('predictions-grid');
    var filtersEl = document.getElementById('pred-filters');
    var countBadge = document.getElementById('pred-count-badge');
    if (!section || !grid) return;
    var budget = pred ? (pred.budgetExhaustion || []) : [];
    var fatigue = pred ? (pred.creativeFatigue || []) : [];
    if (budget.length === 0 && fatigue.length === 0) {
      section.style.display = 'block';
      section.classList.add('section-enter');
      grid.innerHTML = '<div class="section-empty-state">'
        + '<span class="section-empty-icon">🛡️</span>'
        + '<div class="section-empty-title">' + lbl('No alerts', 'لا توجد تنبيهات') + '</div>'
        + '<div class="section-empty-sub">' + lbl('Your campaigns are running smoothly.', 'حملاتك تعمل بسلاسة.') + '</div>'
      + '</div>';
      if (filtersEl) filtersEl.innerHTML = '';
      if (countBadge) countBadge.textContent = '0 ' + lbl('alerts', 'تنبيه');
      return;
    }
    section.style.display = 'block';
    section.classList.add('section-enter');

    var total = budget.length + fatigue.length;
    var critCount = budget.filter(function(b) { return b.severity === 'critical'; }).length
      + fatigue.filter(function(f) { return f.severity === 'critical'; }).length;
    var warnCount = total - critCount;

    if (countBadge) {
      countBadge.textContent = total + ' ' + lbl('alerts', 'تنبيه');
    }

    _predAllCards = [];
    budget.forEach(function (b) {
      var sev = b.severity === 'critical' ? 'danger' : 'warn';
      var spentPct = (b.dailyBudgetMajor > 0)
        ? Math.min(100, Math.round((b.spentTodayMajor / b.dailyBudgetMajor) * 100))
        : 0;
      var exhaustLabel = b.exhaustionTime
        ? new Date(b.exhaustionTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
      // Null hours = the server couldn't project an ETA — say the honest
      // thing ("burning fast") instead of the broken "خلال ? ساعة".
      var etaLine = b.hoursUntilExhaustion != null
        ? lbl('Budget exhausts in ', 'الميزانية ستنفد خلال ')
          + '<b>' + escHtml(b.hoursUntilExhaustion.toFixed(1)) + '</b> '
          + lbl('hours', 'ساعة')
          + (exhaustLabel ? ' <span style="color:var(--text-3);">(' + escHtml(exhaustLabel) + ')</span>' : '')
        : lbl('Budget is burning fast — review the pace', 'الميزانية تُستهلك بوتيرة سريعة — راجع الإنفاق');
      var html =
        '<div class="pred-card pred-' + sev + '" data-severity="' + b.severity + '" data-campaign="' + escHtml(b.campaignId || '') + '">'
          + '<div class="pred-sev-stripe"></div>'
          + '<div class="pred-card-top">'
            + '<div class="pred-icon">' + (b.severity === 'critical' ? '⚠️' : '⏳') + '</div>'
            + '<div class="pred-body">'
              + '<div class="pred-title">' + escHtml(b.campaignName || '—') + '</div>'
            + '</div>'
            + '<span class="pred-type-tag">' + lbl('BUDGET', 'ميزانية') + '</span>'
          + '</div>'
          + '<div class="pred-card-body">'
            + '<div class="pred-detail">' + etaLine + '</div>'
            + '<div class="pred-progress-wrap">'
              + '<div class="pred-progress-header">'
                + '<span class="pred-progress-label">' + lbl('Spent today', 'أُنفق اليوم') + '</span>'
                + '<span class="pred-progress-val">' + spentPct + '%</span>'
              + '</div>'
              + '<div class="pred-progress-bar">'
                + '<div class="pred-progress-fill" style="width:' + spentPct + '%;"></div>'
              + '</div>'
            + '</div>'
            + '<div class="pred-meta-row">'
              + '<span class="pred-meta-item">' + lbl('Rate', 'السرعة') + ' <b>' + escHtml(String(b.burnRatePerHour)) + '/h</b></span>'
              + '<span class="pred-meta-item">' + lbl('Spent', 'أُنفق') + ' <b>' + escHtml(String(b.spentTodayMajor)) + '</b></span>'
              + '<span class="pred-meta-item">' + lbl('Budget', 'الميزانية') + ' <b>' + escHtml(String(b.dailyBudgetMajor)) + '</b></span>'
            + '</div>'
            + '<div class="pred-actions">'
              + '<a class="pred-action-btn budget" href="/ai?q=' + encodeURIComponent(
                  lbl('Review budget for campaign ' + (b.campaignName || b.campaignId), 'راجع ميزانية حملة ' + (b.campaignName || b.campaignId))
                ) + '">'
                + '💰 ' + lbl('Review Budget', 'راجع الميزانية')
              + '</a>'
            + '</div>'
          + '</div>'
        + '</div>';
      _predAllCards.push({ severity: b.severity, html: html, campaignId: b.campaignId });
    });

    fatigue.forEach(function (f) {
      var sev = f.severity === 'critical' ? 'danger' : 'warn';
      var days = f.daysUntilThreshold != null ? String(f.daysUntilThreshold) : '?';
      var declinePct = f.baselineCtr > 0
        ? Math.round(((f.baselineCtr - f.currentCtr) / f.baselineCtr) * 100)
        : 0;
      var sparkPts = [];
      if (f.ctrDeclineDays > 0 && f.baselineCtr > 0) {
        var step = (f.baselineCtr - f.currentCtr) / Math.max(f.ctrDeclineDays, 1);
        for (var i = 0; i <= f.ctrDeclineDays; i++) {
          sparkPts.push(f.baselineCtr - step * i);
        }
      }
      var sparkSvg = '';
      if (sparkPts.length >= 2) {
        var maxV = Math.max.apply(null, sparkPts);
        var minV = Math.min.apply(null, sparkPts);
        var range = maxV - minV || 1;
        var w = 100;
        var h = 28;
        var pts = sparkPts.map(function(v, idx) {
          var x = (idx / (sparkPts.length - 1)) * w;
          var y = h - ((v - minV) / range) * (h - 4) - 2;
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
        sparkSvg = '<div class="pred-sparkline">'
          + '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
          + '<polyline points="' + pts + '" fill="none" stroke="' + (f.severity === 'critical' ? '#E2604F' : '#C77A1F') + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
          + '</svg></div>';
      }
      var html =
        '<div class="pred-card pred-' + sev + '" data-severity="' + f.severity + '" data-campaign="' + escHtml(f.campaignId || '') + '">'
          + '<div class="pred-sev-stripe"></div>'
          + '<div class="pred-card-top">'
            + '<div class="pred-icon">' + (f.severity === 'critical' ? '🚨' : '🎨') + '</div>'
            + '<div class="pred-body">'
              + '<div class="pred-title">' + escHtml(f.campaignName || '—') + '</div>'
            + '</div>'
            + '<span class="pred-type-tag">' + lbl('FATIGUE', 'إرهاق') + '</span>'
          + '</div>'
          + '<div class="pred-card-body">'
            + '<div class="pred-detail">'
              + lbl('Creative fatigue in ', 'إرهاق الإبداع خلال ')
              + '<b>' + escHtml(days) + '</b> '
              + lbl('days', 'يوم')
              + ' <span style="color:var(--text-3);">(' + lbl('declined ', 'انخفض ') + declinePct + '%)</span>'
            + '</div>'
            + sparkSvg
            + '<div class="pred-progress-wrap">'
              + '<div class="pred-progress-header">'
                + '<span class="pred-progress-label">CTR ' + lbl('decline', 'الانخفاض') + '</span>'
                + '<span class="pred-progress-val">' + escHtml(String(f.currentCtr)) + '% → ' + escHtml(String(f.baselineCtr)) + '%</span>'
              + '</div>'
              + '<div class="pred-progress-bar">'
                + '<div class="pred-progress-fill" style="width:' + Math.min(100, declinePct) + '%;"></div>'
              + '</div>'
            + '</div>'
            + '<div class="pred-meta-row">'
              + '<span class="pred-meta-item">' + lbl('Decline days', 'أيام الانخفاض') + ' <b>' + f.ctrDeclineDays + '</b></span>'
              + '<span class="pred-meta-item">' + lbl('Current CTR', 'CTR الحالي') + ' <b>' + escHtml(String(f.currentCtr)) + '%</b></span>'
            + '</div>'
            + '<div class="pred-actions">'
              + '<a class="pred-action-btn fatigue" href="/ai?q=' + encodeURIComponent(
                  lbl('Refresh creative for campaign ' + (f.campaignName || f.campaignId), 'جدّد إعلان حملة ' + (f.campaignName || f.campaignId))
                ) + '">'
                + '🎨 ' + lbl('Refresh Creative', 'جدّد الإعلان')
              + '</a>'
            + '</div>'
          + '</div>'
        + '</div>';
      _predAllCards.push({ severity: f.severity, html: html, campaignId: f.campaignId });
    });

    if (filtersEl) {
      filtersEl.innerHTML =
        '<button type="button" class="section-filter-tab active" data-pred-filter="all">'
          + lbl('All', 'الكل') + '<span class="section-filter-count">' + total + '</span>'
        + '</button>'
        + (critCount > 0 ? '<button type="button" class="section-filter-tab" data-pred-filter="critical">'
          + lbl('Critical', 'حرجة') + '<span class="section-filter-count">' + critCount + '</span></button>' : '')
        + (warnCount > 0 ? '<button type="button" class="section-filter-tab" data-pred-filter="warning">'
          + lbl('Warning', 'تحذير') + '<span class="section-filter-count">' + warnCount + '</span></button>' : '');
      filtersEl.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-pred-filter]');
        if (!tab) return;
        _predActiveFilter = tab.getAttribute('data-pred-filter');
        filtersEl.querySelectorAll('.section-filter-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        applyPredFilter(grid);
      });
    }

    grid.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var card = e.target.closest('.pred-card');
      if (!card) return;
      var cid = card.getAttribute('data-campaign');
      if (cid) {
        var q = lbl('Investigate campaign ' + cid, 'حلّل الحملة ' + cid);
        window.location.href = '/ai?q=' + encodeURIComponent(q);
      }
    });

    applyPredFilter(grid);
  }

  function applyPredFilter(grid) {
    var filtered = _predAllCards.filter(function (c) {
      if (_predActiveFilter === 'all') return true;
      return c.severity === _predActiveFilter;
    });
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="pred-empty"><div class="pred-empty-icon">✓</div>'
        + lbl('No predictions matching this filter', 'لا توجد تنبؤات تطابق هذا الفلتر') + '</div>';
    } else {
      grid.innerHTML = filtered.map(function (c) { return c.html; }).join('');
    }
  }

  // ── AI Recommendations ─────────────────────────────────────────────────
  var _recsAllCards = [];
  var _recsActiveFilter = 'all';

  function renderAIRecommendations(recs) {
    var section = document.getElementById('ai-recs-section');
    var grid = document.getElementById('ai-recs-grid');
    var filtersEl = document.getElementById('ai-recs-filters');
    var sourceBadge = document.getElementById('ai-recs-source-badge');
    if (!section || !grid) return;
    if (!recs || !recs.recommendations || recs.recommendations.length === 0) {
      section.style.display = 'block';
      section.classList.add('section-enter', 'section-enter-delay-1');
      grid.innerHTML = '<div class="section-empty-state">'
        + '<span class="section-empty-icon">✅</span>'
        + '<div class="section-empty-title">' + lbl('All clear!', 'كل شيء على ما يرام!') + '</div>'
        + '<div class="section-empty-sub">' + lbl('No urgent actions needed right now.', 'لا توجد إجراءات عاجلة حاليًا.') + '</div>'
        + '<a class="section-empty-cta" href="/ai?q=' + encodeURIComponent(lbl('Give me a full account review', 'أعطني مراجعة شاملة لحسابي')) + '">'
          + lbl('Request full review', 'اطلب مراجعة شاملة') + ' →'
        + '</a>'
      + '</div>';
      if (filtersEl) filtersEl.innerHTML = '';
      return;
    }
    section.style.display = 'block';
    section.classList.add('section-enter', 'section-enter-delay-1');

    if (sourceBadge) {
      sourceBadge.textContent = recs.source === 'ai' ? '🤖 AI' : '📊 ' + lbl('Rule-based', 'قواعد');
    }

    var catIcons = { scale: '🚀', fix: '🔧', pause: '⏸️', watch: '👁️', optimize: '⚙️' };
    var catLabels = {
      scale: lbl('Scale Budget', 'وسّع الميزانية'),
      fix: lbl('Fix Now', 'أصلح الآن'),
      pause: lbl('Pause Campaign', 'أوقف الحملة'),
      watch: lbl('Watch Closely', 'تابع عن كثب'),
      optimize: lbl('Optimize', 'حسّن الأداء'),
    };
    var catActions = {
      scale: lbl('Scale', 'وسّع'),
      fix: lbl('Fix', 'أصلح'),
      pause: lbl('Pause', 'أوقف'),
      watch: lbl('Monitor', 'راقب'),
      optimize: lbl('Optimize', 'حسّن'),
    };
    var priLabels = { high: lbl('Urgent', 'عاجل'), medium: lbl('Recommended', 'مُوصى'), low: lbl('Optional', 'اختياري') };

    var catCounts = {};
    recs.recommendations.forEach(function (r) {
      var cat = r.category || 'optimize';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    _recsAllCards = [];
    recs.recommendations.forEach(function (r) {
      var icon = catIcons[r.category] || '⚙️';
      var priLabel = priLabels[r.priority] || r.priority;
      var catLabel = catLabels[r.category] || r.category;
      var confPct = r.confidence != null ? Math.round(r.confidence * 100) : null;

      var campaignTags = '';
      if (r.campaignIds && r.campaignIds.length > 0) {
        var tags = r.campaignIds.slice(0, 3).map(function (cid) {
          var name = findCampaignName(cid);
          return '<span class="ai-rec-campaign-tag" title="' + escHtml(cid) + '">' + escHtml(name || cid.slice(0, 12) + '…') + '</span>';
        });
        if (r.campaignIds.length > 3) {
          tags.push('<span class="ai-rec-campaign-tag">+' + (r.campaignIds.length - 3) + '</span>');
        }
        campaignTags = '<div class="ai-rec-campaigns">' + tags.join('') + '</div>';
      }

      var confHtml = '';
      if (confPct != null) {
        confHtml = '<div class="ai-rec-confidence">'
          + '<div class="ai-rec-conf-bar"><div class="ai-rec-conf-fill" style="width:' + confPct + '%;"></div></div>'
          + '<span class="ai-rec-conf-label">' + confPct + '% ' + lbl('confidence', 'ثقة') + '</span>'
        + '</div>';
      }

      var actionBtnLabel = catActions[r.category] || catActions.optimize;
      // Resolve the campaign NAME for the AI deep-link — a raw internal id
      // (cmrcvu7yq…) means nothing to the merchant or the assistant.
      var firstCampaignName = r.campaignIds && r.campaignIds.length > 0
        ? (findCampaignName(r.campaignIds[0]) || null)
        : null;
      var actionQuery = firstCampaignName
        ? lbl(catLabel + ' campaign "' + firstCampaignName + '"', catLabel + ' حملة «' + firstCampaignName + '»')
        : lbl(catLabel + ': ' + (r.titleAr || ''), catLabel + ': ' + (r.titleAr || ''));

      var html = '<div class="ai-rec-card" data-category="' + escHtml(r.category || '') + '" data-campaign-ids="' + escHtml((r.campaignIds || []).join(',')) + '">'
        + '<div class="ai-rec-header">'
          + '<div class="ai-rec-icon ' + escHtml(r.category || '') + '">' + icon + '</div>'
          + '<div class="ai-rec-title-wrap">'
            + '<div class="ai-rec-title">' + escHtml(r.titleAr || '') + '</div>'
            + '<div class="ai-rec-cat-label">' + escHtml(catLabel) + '</div>'
          + '</div>'
          + '<span class="ai-rec-pri ' + escHtml(r.priority || '') + '">' + escHtml(priLabel) + '</span>'
        + '</div>'
        + '<div class="ai-rec-body-wrap">'
          + '<div class="ai-rec-body">' + escHtml(r.bodyAr || '') + '</div>'
          + confHtml
          + campaignTags
          + '<div class="ai-rec-actions">'
            + '<a class="ai-rec-action-btn ' + escHtml(r.category || '') + '" href="/ai?q=' + encodeURIComponent(actionQuery) + '">'
              + icon + ' ' + escHtml(actionBtnLabel)
            + '</a>'
          + '</div>'
        + '</div>'
      + '</div>';
      _recsAllCards.push({ category: r.category || 'optimize', html: html, campaignIds: r.campaignIds || [] });
    });

    if (filtersEl) {
      var filterHtml = '<button type="button" class="section-filter-tab active" data-rec-filter="all">'
        + lbl('All', 'الكل') + '<span class="section-filter-count">' + recs.recommendations.length + '</span></button>';
      Object.keys(catCounts).forEach(function (cat) {
        var catIcon = catIcons[cat] || '⚙️';
        filterHtml += '<button type="button" class="section-filter-tab" data-rec-filter="' + escHtml(cat) + '">'
          + catIcon + ' ' + escHtml(catLabels[cat] || cat) + '<span class="section-filter-count">' + catCounts[cat] + '</span></button>';
      });
      filtersEl.innerHTML = filterHtml;
      filtersEl.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-rec-filter]');
        if (!tab) return;
        _recsActiveFilter = tab.getAttribute('data-rec-filter');
        filtersEl.querySelectorAll('.section-filter-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        applyRecFilter(grid);
      });
    }

    grid.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var card = e.target.closest('.ai-rec-card');
      if (!card) return;
      var cids = (card.getAttribute('data-campaign-ids') || '').split(',').filter(Boolean);
      if (cids.length > 0) {
        // Name, never the raw internal id — the assistant (and the merchant)
        // can only reason about a campaign they can recognize.
        var cName = findCampaignName(cids[0]);
        var q = cName
          ? lbl('Investigate campaign "' + cName + '"', 'حلّل حملة «' + cName + '»')
          : lbl('Investigate my weakest campaign', 'حلّل أضعف حملة عندي');
        window.location.href = '/ai?q=' + encodeURIComponent(q);
      }
    });

    applyRecFilter(grid);
  }

  // ── Creative Health strip — Meta's own ad-relevance grades, summarized ──
  function renderCreativeHealth(ch) {
    var el = document.getElementById('creative-health-strip');
    if (!el) return;
    // Hide unless Meta graded ads AND at least one needs attention.
    if (!ch || !ch.needAttention || ch.needAttention < 1) { el.style.display = 'none'; return; }
    var iconEl = document.getElementById('ch-icon');
    var titleEl = document.getElementById('ch-title');
    var subEl = document.getElementById('ch-sub');
    var high = ch.worst && ch.worst.severity === 'high';
    el.className = 'creative-health-strip ' + (high ? 'ch-high' : 'ch-mid');
    if (iconEl) iconEl.textContent = high ? '⚠️' : '🎨';
    if (titleEl) {
      titleEl.textContent = ch.needAttention === 1
        ? lbl('1 ad needs creative attention', 'إعلان واحد يحتاج مراجعة إبداعية')
        : ch.needAttention + ' ' + lbl('ads need creative attention', 'إعلانات تحتاج مراجعة إبداعية');
    }
    if (subEl) {
      subEl.textContent = ch.worst && ch.worst.titleAr
        ? (lbl('Worst: ', 'الأسوأ: ') + ch.worst.titleAr)
        : lbl('Based on Meta quality grades.', 'حسب تقييم Meta لجودة إعلاناتك.');
    }
    el.style.display = 'flex';
  }

  function findCampaignName(campaignId) {
    var camps = state.lastCampaigns || [];
    for (var i = 0; i < camps.length; i++) {
      if (camps[i].id === campaignId || camps[i].metaId === campaignId) {
        return camps[i].name;
      }
    }
    return null;
  }

  function applyRecFilter(grid) {
    var filtered = _recsAllCards.filter(function (c) {
      if (_recsActiveFilter === 'all') return true;
      return c.category === _recsActiveFilter;
    });
    grid.innerHTML = filtered.map(function (c) { return c.html; }).join('');
  }

  // ── Weekly Report ──────────────────────────────────────────────────────
  function renderWeeklyReport(report) {
    var section = document.getElementById('weekly-report-section');
    var container = document.getElementById('weekly-report-content');
    if (!section || !container) return;
    if (!report) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    section.classList.add('section-enter', 'section-enter-delay-2');

    var tw = report.thisWeek || {};
    var lw = report.lastWeek || {};
    var d = report.delta || {};

    function deltaChip(val, goodWhenUp) {
      if (val == null) return '';
      var up = val > 0;
      var arrow = up ? '↑' : val < 0 ? '↓' : '→';
      var cls;
      if (val === 0) cls = 'flat';
      else if (goodWhenUp) cls = up ? 'up' : 'down';
      else cls = up ? 'down' : 'up';
      return '<span class="hero-delta ' + cls + '" style="font-size:11px;padding:3px 8px;">' + arrow + ' ' + Math.abs(val).toFixed(1) + '%</span>';
    }

    function compBar(thisVal, lastVal) {
      if (thisVal == null || lastVal == null) return '';
      var maxV = Math.max(thisVal, lastVal, 1);
      var thisPct = Math.round((thisVal / maxV) * 100);
      var lastPct = Math.round((lastVal / maxV) * 100);
      return '<div class="weekly-metric-bar">'
        + '<div class="weekly-metric-bar-inner">'
          + '<div class="weekly-metric-bar-this" style="width:' + thisPct + '%;"></div>'
          + '<div class="weekly-metric-bar-last" style="width:' + (100 - thisPct) + '%;"></div>'
        + '</div></div>';
    }

    function metricCard(label, val, lastVal, lastDisplay, delta, goodWhenUp) {
      return '<div class="weekly-metric">'
        + '<div class="weekly-metric-label">' + label + '</div>'
        + '<div class="weekly-metric-val">' + escHtml(String(val != null ? val : '—')) + '</div>'
        + (lastDisplay ? '<div class="weekly-metric-prev">' + lbl('prev: ', 'سابق: ') + escHtml(String(lastDisplay)) + '</div>' : '')
        + deltaChip(delta, goodWhenUp)
        + compBar(val, lastVal)
      + '</div>';
    }

    // Only the four metrics where week-over-week comparison changes a decision.
    // CPM/impressions live in the KPI grid and trend charts — no need to repeat.
    var metricsGrid = '<div class="weekly-metrics-grid">'
      + metricCard(lbl('Spend', 'الإنفاق'), tw.spendDisplay || '—', null, lw.spendDisplay, d.spendPct, false)
      + metricCard(lbl('Results', 'النتائج'), tw.results, lw.results, lw.results, d.resultsPct, true)
      + metricCard('CTR', tw.ctr != null ? tw.ctr + '%' : '—', lw.ctr, lw.ctr != null ? lw.ctr + '%' : null, d.ctrPct, true)
      + metricCard(lbl('Cost/Result', 'التكلفة لكل نتيجة'), tw.costPerResult, lw.costPerResult, lw.costPerResult, d.costPerResultPct, false)
    + '</div>';

    var summary = report.summaryAr
      ? '<div class="weekly-summary" dir="rtl">' + escHtml(report.summaryAr) + '</div>'
      : '';

    var recsHtml = '';
    if (report.recommendationsAr && report.recommendationsAr.length > 0) {
      var recIcons = ['💡', '🎯', '📊', '⚡'];
      recsHtml = '<div class="weekly-recs-header">' + lbl('Recommendations', 'التوصيات') + '</div>'
        + '<ul class="weekly-recs" dir="rtl">'
        + report.recommendationsAr.map(function (r, i) {
          return '<li>'
            + '<span class="weekly-rec-icon">' + (recIcons[i % recIcons.length]) + '</span>'
            + '<span class="weekly-rec-text">' + escHtml(r) + '</span>'
          + '</li>';
        }).join('')
        + '</ul>';
    }

    var best = report.bestCampaign;
    var worst = report.worstCampaign;
    var highlights = '';
    if (best || worst) {
      highlights = '<div class="weekly-highlights">';
      if (best) {
        highlights += '<div class="weekly-highlight best">'
          + '<span class="highlight-tag">' + lbl('BEST PERFORMER', 'الأفضل أداءً') + '</span>'
          + '<div class="weekly-highlight-name">' + escHtml(best.campaignName || '') + '</div>'
          + '<div class="weekly-highlight-stats">'
            + '<span>CTR <b>' + (best.ctr != null ? best.ctr + '%' : '—') + '</b></span>'
            + '<span>' + lbl('Spend', 'إنفاق') + ' <b>' + escHtml(String(best.spend || '—')) + '</b></span>'
            + '<span>' + lbl('Results', 'نتائج') + ' <b>' + escHtml(String(best.results || '—')) + '</b></span>'
          + '</div>'
          + '<a class="weekly-highlight-action best-action" href="/ai?q=' + encodeURIComponent('زيادة ميزانية حملة ' + (best.campaignName || '')) + '">'
            + lbl('Scale this', 'وسّع هذه') + ' 📈'
          + '</a>'
        + '</div>';
      }
      if (worst && (!best || worst.campaignId !== best.campaignId)) {
        highlights += '<div class="weekly-highlight worst">'
          + '<span class="highlight-tag">' + lbl('NEEDS ATTENTION', 'يحتاج مراجعة') + '</span>'
          + '<div class="weekly-highlight-name">' + escHtml(worst.campaignName || '') + '</div>'
          + '<div class="weekly-highlight-stats">'
            + '<span>CTR <b>' + (worst.ctr != null ? worst.ctr + '%' : '—') + '</b></span>'
            + '<span>' + lbl('Spend', 'إنفاق') + ' <b>' + escHtml(String(worst.spend || '—')) + '</b></span>'
            + '<span>' + lbl('Results', 'نتائج') + ' <b>' + escHtml(String(worst.results || '—')) + '</b></span>'
          + '</div>'
          + '<a class="weekly-highlight-action worst-action" href="/ai?q=' + encodeURIComponent('حلل مشاكل حملة ' + (worst.campaignName || '')) + '">'
            + lbl('Diagnose', 'حلّل المشكلة') + ' 🔍'
          + '</a>'
        + '</div>';
      }
      highlights += '</div>';
    }

    var brainActions = report.brainActions || {};
    var brainLine = '';
    var brainPills = [];
    if (brainActions.scaled) {
      brainPills.push('<div class="weekly-brain-pill"><span class="weekly-brain-pill-icon">📈</span>' + lbl('Scaled', 'تم رفع') + ' <span class="weekly-brain-pill-count">' + brainActions.scaled + '</span></div>');
    }
    if (brainActions.paused) {
      brainPills.push('<div class="weekly-brain-pill"><span class="weekly-brain-pill-icon">⏸️</span>' + lbl('Paused', 'تم إيقاف') + ' <span class="weekly-brain-pill-count">' + brainActions.paused + '</span></div>');
    }
    if (brainActions.refreshed) {
      brainPills.push('<div class="weekly-brain-pill"><span class="weekly-brain-pill-icon">🔄</span>' + lbl('Refreshed', 'تم تجديد') + ' <span class="weekly-brain-pill-count">' + brainActions.refreshed + '</span></div>');
    }
    if (brainActions.watching) {
      brainPills.push('<div class="weekly-brain-pill"><span class="weekly-brain-pill-icon">👁️</span>' + lbl('Watching', 'مراقبة') + ' <span class="weekly-brain-pill-count">' + brainActions.watching + '</span></div>');
    }
    if (brainPills.length) {
      brainLine = '<div class="weekly-brain-actions">' + brainPills.join('') + '</div>';
    }

    var sourceLabel = report.source === 'ai' ? '🤖 AI' : '📊';
    var header = '<div class="weekly-header">'
      + '<div class="weekly-period">'
        + '<span class="weekly-period-dates">' + escHtml(report.weekStart || '') + ' → ' + escHtml(report.weekEnd || '') + '</span>'
      + '</div>'
      + '<span class="weekly-source-badge">' + sourceLabel + ' ' + lbl('Generated', 'تم التوليد') + '</span>'
    + '</div>';

    var campaignSummary = '<div style="display:flex;gap:12px;font-size:12px;color:var(--text-3);margin-bottom:14px;">'
      + '<span>' + lbl('Active', 'نشطة') + ': <b style="color:var(--success);">' + (report.activeCampaigns || 0) + '</b></span>'
      + '<span>' + lbl('Paused', 'متوقفة') + ': <b style="color:var(--text-2);">' + (report.pausedCampaigns || 0) + '</b></span>'
    + '</div>';

    container.innerHTML = header + campaignSummary + metricsGrid + highlights + summary + recsHtml + brainLine;
  }

  function renderBrainSection(brain, dashData) {
    if (!brain) return;
    var hasSignal = applyPulse(brain.livePulse);
    var pulseSection = document.getElementById('brain-pulse-section');
    if (pulseSection) pulseSection.style.display = hasSignal ? 'block' : 'none';
  }
  function updatePulseLabels() {
    var el;
    el = document.getElementById('brain-pulse-burn-label');
    if (el) el.textContent = lbl('Spend pace', 'سرعة الإنفاق');
    el = document.getElementById('brain-pulse-burn-meta');
    if (el) el.textContent = lbl('with spend pace today', 'بوتيرة إنفاق اليوم');
    el = document.getElementById('brain-pulse-spend-label');
    if (el) el.textContent = lbl("Today's spend share", 'حصة الإنفاق اليوم');
    el = document.getElementById('brain-pulse-spend-meta');
    if (el) el.textContent = lbl('of total daily budget', 'من إجمالي الميزانية اليومية');
    el = document.getElementById('brain-pulse-dna-label');
    if (el) el.textContent = lbl('Match to your top campaigns', 'مدى تشابه الإعلان مع الأفضل');
    el = document.getElementById('brain-pulse-dna-meta');
    if (el) el.textContent = lbl('compared to your top past campaigns', 'مقارنة بأفضل حملاتك السابقة');
  }
  /** Paint the live pulse. Returns true only when there is a real signal —
   *  a wall of "USD 0.00 / 0.0% / —" is noise, not analytics, so callers
   *  hide the panel when this returns false. */
  function applyPulse(pulse) {
    updatePulseLabels();
    if (!pulse) return false;
    var hasSignal = (pulse.campaignsObserved || 0) > 0
      || (pulse.intraDaySpendPct != null && pulse.intraDaySpendPct > 0)
      || pulse.dnaMatchPct != null;
    var burn = document.getElementById('brain-pulse-burn');
    var burnN = document.getElementById('brain-pulse-burn-n');
    var spendPct = document.getElementById('brain-pulse-spendpct');
    var dna = document.getElementById('brain-pulse-dna');
    var tick = document.getElementById('brain-pulse-tick');
    if (burn) burn.textContent = pulse.burnRateDisplay || '—';
    if (burnN) burnN.textContent = String(pulse.campaignsObserved || 0);
    if (spendPct) spendPct.textContent = (pulse.intraDaySpendPct != null) ? pulse.intraDaySpendPct.toFixed(1) + '%' : '—';
    if (dna) dna.textContent = (pulse.dnaMatchPct != null) ? pulse.dnaMatchPct.toFixed(1) + '%' : '—';
    if (tick) tick.textContent = pulse.tickDate || lbl('no tick yet today', 'لا يوجد تحديث اليوم');
    return hasSignal;
  }

  /** Shared full refresh — used by auto-refresh, visibility, and post-sync onComplete. */
  async function refreshDashboardData(workspaceId, opts) {
    opts = opts || {};
    if (!workspaceId || document.hidden) return null;
    if (refreshInFlight && !opts.force) return null;
    var gen = ++refreshGeneration;
    refreshInFlight = true;
    try {
      var results = await Promise.all([
        apiFetchWithTimeout('/api/dashboard/' + workspaceId, {}, opts.timeoutMs || 15000),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId + '/insights?days=90', {}, opts.timeoutMs || 15000).catch(function () { return []; }),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId + '/campaigns', {}, opts.timeoutMs || 15000).catch(function () { return []; }),
      ]);
      if (gen !== refreshGeneration) return null; // stale response
      var dashData = results[0];
      if (!dashData || dashData.empty) return dashData || null;
      if (dashData.error || dashData.code === 'DASHBOARD_TIMEOUT') {
        throw Object.assign(new Error(dashData.error || 'Dashboard timed out'), { code: dashData.code || 'DASHBOARD_TIMEOUT' });
      }
      applyDashboardData(dashData, results[1] || [], results[2] || [], null, !!opts.isInitial);
      return dashData;
    } finally {
      if (gen === refreshGeneration) refreshInFlight = false;
    }
  }

  async function refreshPulseOnly(workspaceId) {
    if (!workspaceId || document.hidden) return;
    try {
      var pulse = await apiFetchWithTimeout('/api/dashboard/pulse/' + workspaceId, {}, 8000);
      if (!pulse) return;
      var hasSignal = applyPulse(pulse);
      var pulseSection = document.getElementById('brain-pulse-section');
      if (pulseSection) pulseSection.style.display = hasSignal ? 'block' : 'none';
    } catch (e) { /* silent pulse */ }
  }

  function startAutoRefresh(workspaceId) {
    function stopTimers() {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (fullRefreshTimer) { clearInterval(fullRefreshTimer); fullRefreshTimer = null; }
    }
    function armTimers() {
      stopTimers();
      refreshTimer = setInterval(function () { refreshPulseOnly(workspaceId); }, PULSE_MS);
      fullRefreshTimer = setInterval(function () {
        refreshDashboardData(workspaceId).catch(function () { /* silent */ });
      }, FULL_REFRESH_MS);
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshDashboardData(workspaceId).catch(function () { /* silent */ });
        armTimers();
      } else {
        stopTimers();
      }
    });
    window.addEventListener('pagehide', stopTimers);
    armTimers();
  }

  // ── Insights → KPIs fallback (uses minor-unit-aware spend totals) ───────
  function buildKpisFromInsights(insights) {
    var totals = { spendMinor: 0, impressions: 0, clicks: 0, messages: 0 };
    insights.forEach(function (d) {
      totals.spendMinor += Number(d.spend) || 0;
      totals.impressions += Number(d.impressions) || 0;
      totals.clicks += Number(d.clicks) || 0;
      totals.messages += Number(d.messages) || 0;
    });
    // Reach is daily unique users — NOT additive across days. Insights arrive
    // date-DESC; use the most recent day (matches getDashboard.ts convention).
    var latestReach = insights.length ? (Number(insights[0].reach) || 0) : 0;
    var spendMajor = totals.spendMinor / state.minorFactor;
    // Match getDashboard: missing denominators → null / "—", never fake 0%.
    var ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : null;
    var cpc = totals.clicks ? spendMajor / totals.clicks : null;
    var cpm = totals.impressions ? (spendMajor / totals.impressions) * 1000 : null;
    return [
      { key: 'spend', label: kpiLabel('spend'), value: spendMajor, display: fmtCurrencyMinor(totals.spendMinor), goodWhenUp: false },
      { key: 'impressions', label: kpiLabel('impressions'), value: totals.impressions, display: fmtNum(totals.impressions), goodWhenUp: true },
      { key: 'reach', label: kpiLabel('reach'), value: latestReach, display: fmtNum(latestReach), goodWhenUp: true },
      { key: 'clicks', label: kpiLabel('clicks'), value: totals.clicks, display: fmtNum(totals.clicks), goodWhenUp: true },
      { key: 'ctr', label: kpiLabel('ctr'), value: ctr, display: ctr == null ? '—' : fmtPctLocal(ctr), goodWhenUp: true },
      { key: 'cpc', label: kpiLabel('cpc'), value: cpc, display: cpc == null ? '—' : fmtCurrencyMajor(cpc), goodWhenUp: false },
      { key: 'cpm', label: kpiLabel('cpm'), value: cpm, display: cpm == null ? '—' : fmtCurrencyMajor(cpm), goodWhenUp: false },
      { key: 'messages', label: kpiLabel('messages'), value: totals.messages, display: fmtNum(totals.messages), goodWhenUp: true },
    ];
  }

  function setGreeting() {
    var el = document.getElementById('dash-greeting');
    if (!el) return;
    var h = new Date().getHours();
    var greeting;
    if (h < 6) greeting = lbl('Late night command center', 'مركز القيادة الليلي');
    else if (h < 12) greeting = lbl('Good morning', 'صباح الخير');
    else if (h < 17) greeting = lbl('Good afternoon', 'مساء الخير');
    else greeting = lbl('Good evening', 'مساء الخير');
    el.textContent = greeting + ' 👋';
  }

  function hideLoadingShowDashboard() {
    var loadingEl = document.getElementById('loading-state');
    var contentEl = document.getElementById('dashboard-content');
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    setGreeting();
    // Reveal order mirrors the decision hierarchy: summary → health →
    // decision → shortcuts → context → metrics → evidence.
    staggerReveal(['.cmd-bar', '#exec-pulse-section', '.health-gauge-section', '#main-move-section', '#quick-actions-bar', '#live-insights-section', '.kpi-command-grid', '.active-section', '.split-grid', '#timeline-section']);
  }

  /** Safety net if init hangs — do not rely on layout SHARED_JS globals. */
  function startLoadingSafetyTimeout(ms) {
    setTimeout(function () {
      var loadingEl = document.getElementById('loading-state');
      if (!loadingEl || loadingEl.style.display === 'none') return;
      console.warn('[dashboard] loading safety timeout — revealing page');
      hideLoadingShowDashboard();
    }, ms || 5000);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function onboardingMessageFromJob(job, tick) {
    if (job.status === 'COMPLETED') {
      return lbl('Building your AI insights…', 'جارٍ بناء رؤى الذكاء الاصطناعي…');
    }
    if (job.chunksTotal > 0 && job.chunksDone > 0) {
      var pct = Math.round((job.chunksDone / job.chunksTotal) * 100);
      return lbl(
        'Analyzing your last 30 days of campaigns… (' + pct + '%)',
        'جارٍ تحليل حملاتك خلال آخر 30 يوماً… (' + pct + '%)'
      );
    }
    var msgs = [
      lbl('Connecting to your Meta ad account…', 'جارٍ الاتصال بحساب Meta الإعلاني…'),
      lbl('Analyzing your last 30 days of campaigns…', 'جارٍ تحليل حملاتك خلال آخر 30 يوماً…'),
      lbl('Pulling spend, reach, and engagement data…', 'جارٍ جلب بيانات الإنفاق والوصول والتفاعل…'),
      lbl('Syncing campaign performance history…', 'جارٍ مزامنة سجل أداء الحملات…'),
      lbl('Preparing your dashboard…', 'جارٍ تجهيز لوحة التحكم…'),
    ];
    return msgs[tick % msgs.length];
  }

  function showOnboardingOverlay(show) {
    var el = document.getElementById('onboarding-overlay');
    if (el) el.style.display = show ? 'flex' : 'none';
    var loadingEl = document.getElementById('loading-state');
    if (loadingEl && show) loadingEl.style.display = 'none';
  }

  function updateOnboardingUI(job, tick) {
    var msgEl = document.getElementById('onboarding-msg');
    var barEl = document.getElementById('onboarding-bar');
    var metaEl = document.getElementById('onboarding-meta');
    if (msgEl) msgEl.textContent = onboardingMessageFromJob(job, tick);
    if (barEl) {
      var pct = 8;
      if (job.chunksTotal > 0) pct = Math.max(8, Math.round((job.chunksDone / job.chunksTotal) * 92));
      else if (job.status === 'RUNNING' || job.status === 'IN_PROGRESS') pct = 20 + (tick % 4) * 12;
      else if (job.status === 'COMPLETED') pct = 100;
      barEl.style.width = pct + '%';
    }
    if (metaEl && job.rowsUpserted > 0) {
      metaEl.textContent = lbl(
        job.rowsUpserted + ' data points loaded',
        'تم تحميل ' + job.rowsUpserted + ' نقطة بيانات'
      );
    }
  }

  async function pollSyncJob(jobId) {
    var maxAttempts = 180;
    for (var i = 0; i < maxAttempts; i++) {
      var job = await apiFetch('/api/sync-jobs/' + encodeURIComponent(jobId));
      updateOnboardingUI(job, i);
      if (job.status === 'COMPLETED') return job;
      if (job.status === 'FAILED') throw new Error(job.error || lbl('Sync failed', 'فشلت المزامنة'));
      await sleep(1500);
    }
    throw new Error(lbl('Sync is taking longer than expected — your dashboard will update shortly.',
      'المزامنة تستغرق وقتاً أطول من المتوقع — ستُحدَّث لوحة التحكم قريباً.'));
  }

  async function runOnboardingSync(syncJobId) {
    showOnboardingOverlay(true);
    var titleEl = document.getElementById('onboarding-title');
    if (titleEl) titleEl.textContent = lbl('Setting up your dashboard', 'جارٍ إعداد لوحة التحكم');
    try {
      await pollSyncJob(syncJobId);
      var msgEl = document.getElementById('onboarding-msg');
      if (msgEl) msgEl.textContent = lbl('Almost ready…', 'على وشك الانتهاء…');
      var barEl = document.getElementById('onboarding-bar');
      if (barEl) barEl.style.width = '100%';
      await sleep(600);
    } catch (e) {
      console.warn('[dashboard] onboarding sync poll:', e);
      toast(friendlyApiError(e), 'warning');
    } finally {
      showOnboardingOverlay(false);
    }
  }

  async function waitForInitialSync(syncJobId, workspaceId) {
    if (syncJobId) {
      await runOnboardingSync(syncJobId);
      return;
    }
    showOnboardingOverlay(true);
    var msgEl = document.getElementById('onboarding-msg');
    if (msgEl) msgEl.textContent = lbl('Analyzing your last 30 days of campaigns…', 'جارٍ تحليل حملاتك خلال آخر 30 يوماً…');
    try {
      for (var j = 0; j < 90; j++) {
        var ws = await apiFetch('/api/workspaces/' + workspaceId);
        if (ws && ws.adAccounts && ws.adAccounts.some(function (a) { return a.lastSyncedAt; })) break;
        await sleep(2000);
      }
    } finally {
      showOnboardingOverlay(false);
    }
  }

  // ── Render / refresh dashboard sections ─────────────────────────────────
  function safeRender(sectionName, fn) {
    try { fn(); } catch (e) {
      console.error('[dashboard] ' + sectionName + ' render failed:', e);
    }
  }

  function applyDashboardData(dashData, insights, campaigns, wsData, isInitial) {
    dashData = dashData || {};
    insights = Array.isArray(insights) ? insights : [];
    campaigns = Array.isArray(campaigns) ? campaigns : [];
    state.lastInsights = insights;
    state.lastCampaigns = campaigns;
    try {
      if (dashData.workspace && dashData.workspace.locale) {
        state.locale = String(dashData.workspace.locale).toUpperCase();
      }
      hydrateCurrencyState(dashData, wsData);

      if (isInitial && wsData) {
        var allStale = Array.isArray(wsData.adAccounts)
          && wsData.adAccounts.length > 0
          && wsData.adAccounts.every(function (a) { return a.status !== 'ACTIVE'; });
        if (allStale) {
          var staleBanner = document.getElementById('stale-banner');
          if (staleBanner) staleBanner.style.display = 'flex';
        }
      }

      var workspaceId = state.workspaceId;
      var wsName = (dashData.workspace && (dashData.workspace.name || dashData.workspace.id)) || workspaceId;
      var wsNameEl = document.getElementById('ws-name'); if (wsNameEl) wsNameEl.textContent = wsName;
      var subtitleEl = document.getElementById('dash-subtitle');
      if (subtitleEl) {
        subtitleEl.innerHTML = 'Past 30 days · ' + escHtml(wsName) + ' · <span id="dash-last-updated" class="text-3">—</span>';
      }
      var chartMeta = document.getElementById('chart-panel-meta');
      if (chartMeta) chartMeta.textContent = state.currency;
      updateLastUpdatedLabel(dashData);
      state.lastSyncedAt = (dashData.workspace && dashData.workspace.lastSyncedAt) || null;
      state.lastIssues = Array.isArray(dashData.issues) ? dashData.issues : [];

      var dashKpis = Array.isArray(dashData.kpis) ? dashData.kpis : [];
      var kpis = dashKpis.length > 0 ? dashKpis : buildKpisFromInsights(insights);
      // Command bar + KPI cards first, then task surfaces.
      safeRender('commandBar', function () { renderCommandBar(dashData); });
      safeRender('healthGauge', function () { renderHealthGauge(dashData); });
      safeRender('mainMove', function () { renderMainMove(dashData, kpis); });
      safeRender('hero', function () { renderHero(dashData, insights); });
      safeRender('kpiInsights', function () { renderKpiInsights(dashData, kpis); });
      safeRender('executivePulse', function () { renderExecutivePulse(dashData); });
      safeRender('liveInsights', function () { renderTicker(buildTickerItems(dashData), dashData); });
      safeRender('activeAds', function () { renderCampaignStatusStrip(campaigns, dashData.workspace && dashData.workspace.campaignCounts); });
      safeRender('brainBox', function () { renderBrainBox(dashData); });
      safeRender('timeline', function () { renderTimeline(dashData); });

      if (dashData.brain) {
        safeRender('brainSection', function () { renderBrainSection(dashData.brain, dashData); });
      }

      var dashKpis = Array.isArray(dashData.kpis) ? dashData.kpis : [];
      var kpis = dashKpis.length > 0 ? dashKpis : buildKpisFromInsights(insights);
      safeRender('bleedAlert', function () { renderBleedAlert(dashData); });
      safeRender('morningStory', function () { renderMorningStory(dashData); });
      safeRender('insightStrip', function () { renderInsightStrip(dashData); });
      safeRender('mainMove', function () { renderMainMove(dashData, kpis); });
      safeRender('spotlight', function () { renderSpotlight(dashData.bestCampaign, deriveOpportunity(dashData)); });
      safeRender('kpis', function () { renderKpis(kpis); });
      safeRender('predictions', function () { renderPredictions(dashData.predictions); });
      safeRender('aiRecs', function () { renderAIRecommendations(dashData.aiRecommendations); });
      safeRender('creativeHealth', function () { renderCreativeHealth(dashData.creativeHealth); });
      safeRender('weeklyReport', function () { renderWeeklyReport(dashData.weeklyReport); });

      var last30 = recentAsc(insights, 30);
      var byDate = {};
      last30.forEach(function (d) {
        var raw = d && d.date;
        var key;
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
          key = raw.slice(0, 10);
        } else {
          var parsed = new Date(raw);
          key = isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
        }
        if (!key) return;
        byDate[key] = d;
      });
      // Day axis anchored to the AD ACCOUNT's calendar (workspace.accountToday,
      // computed server-side in the Meta reporting timezone) — the viewer's
      // clock or UTC can disagree with it around midnight and the newest day
      // would vanish from the chart.
      var endKey = (dashData.workspace && dashData.workspace.accountToday) || new Date().toISOString().slice(0, 10);
      var endParts = endKey.split('-').map(Number);
      var endMs = Date.UTC(endParts[0], endParts[1] - 1, endParts[2], 12);
      var labels = [];
      var isoDates = [];
      var spendSeriesMajor = [];
      var ctrSeries = [];
      var resultsSeries = [];
      var freqSeries = [];
      var cpmSeries = [];
      var cprSeries = [];
      for (var i = 29; i >= 0; i--) {
        var key = new Date(endMs - i * 86400000).toISOString().slice(0, 10);
        isoDates.push(key);
        var keyParts = key.split('-').map(Number);
        labels.push(new Date(Date.UTC(keyParts[0], keyParts[1] - 1, keyParts[2], 12))
          .toLocaleDateString('ar-u-nu-latn', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
        var row = byDate[key] || null;
        if (!row) {
          spendSeriesMajor.push(null);
          ctrSeries.push(null);
          resultsSeries.push(null);
          freqSeries.push(null);
          cpmSeries.push(null);
          cprSeries.push(null);
        } else {
          var spendMaj = (Number(row.spend) || 0) / state.minorFactor;
          var imp = Number(row.impressions) || 0;
          // Idle day → null (gap), not a fake crash to zero.
          spendSeriesMajor.push(spendMaj > 0 ? spendMaj : null);
          var dayRes = (Number(row.messages) || 0) + (Number(row.purchases) || 0) + (Number(row.leads) || 0);
          resultsSeries.push(dayRes > 0 ? dayRes : null);
          if (imp <= 0) {
            ctrSeries.push(null);
            freqSeries.push(null);
            cpmSeries.push(null);
          } else {
            var ctrV = Number(row.ctr);
            ctrSeries.push(Number.isFinite(ctrV) ? ctrV : null);
            freqSeries.push(
              row.frequency == null || !Number.isFinite(Number(row.frequency))
                ? null
                : Number(row.frequency),
            );
            // Recompute CPM in MAJOR — stored row.cpm is minor units.
            cpmSeries.push(Number.isFinite(spendMaj) ? (spendMaj / imp) * 1000 : null);
          }
          cprSeries.push(dayRes > 0 && spendMaj > 0 ? spendMaj / dayRes : null);
        }
      }

      if (dashData.trendSeries && Array.isArray(dashData.trendSeries.dates) && dashData.trendSeries.dates.length) {
        var ts = dashData.trendSeries;
        var tsIso = ts.dates.map(function (d) {
          if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
          var dateVal = d && typeof d === 'object' ? d.date : d;
          var pd = new Date(dateVal);
          return isNaN(pd.getTime()) ? '' : pd.toISOString().slice(0, 10);
        });
        var tsByIdx = {};
        tsIso.forEach(function (iso, i) { tsByIdx[iso] = i; });
        spendSeriesMajor = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null || !Array.isArray(ts.spend) || ts.spend[i] == null) return null;
          var maj = Number(ts.spend[i]) / state.minorFactor;
          return maj > 0 ? maj : null;
        });
        ctrSeries = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null || !Array.isArray(ts.ctr) || ts.ctr[i] == null) return null;
          var v = Number(ts.ctr[i]);
          return Number.isFinite(v) ? v : null;
        });
        resultsSeries = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null) return null;
          var v = null;
          if (Array.isArray(ts.results) && ts.results[i] != null) v = Number(ts.results[i]);
          else if (Array.isArray(ts.messages) && ts.messages[i] != null) v = Number(ts.messages[i]);
          return v != null && v > 0 ? v : null;
        });
        freqSeries = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null || !Array.isArray(ts.frequency) || ts.frequency[i] == null) return null;
          var v = Number(ts.frequency[i]);
          return Number.isFinite(v) && v > 0 ? v : null;
        });
        // trendSeries.cpm is already MAJOR after getDashboard fix.
        cpmSeries = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null || !Array.isArray(ts.cpm) || ts.cpm[i] == null) return null;
          var v = Number(ts.cpm[i]);
          return Number.isFinite(v) && v > 0 ? v : null;
        });
        cprSeries = isoDates.map(function (iso) {
          var i = tsByIdx[iso];
          if (i == null) return null;
          if (Array.isArray(ts.costPerResult) && ts.costPerResult[i] != null) {
            var cprV = Number(ts.costPerResult[i]);
            return Number.isFinite(cprV) && cprV > 0 ? cprV : null;
          }
          var res = resultsSeries[isoDates.indexOf(iso)];
          var sp = spendSeriesMajor[isoDates.indexOf(iso)];
          if (res != null && res > 0 && sp != null && sp > 0) return sp / res;
          return null;
        });
        labels = isoDates.map(function (iso) {
          // Force UTC so YYYY-MM-DD labels don't shift a day west-of-UTC.
          return new Date(iso + 'T12:00:00Z').toLocaleDateString('ar-u-nu-latn', {
            month: 'short', day: 'numeric', timeZone: 'UTC',
          });
        });
      }

      pendingAdvancedCharts = {
        labels: labels,
        ctrSeries: ctrSeries,
        resultsSeries: resultsSeries,
        freqSeries: freqSeries,
        cpmSeries: cpmSeries,
        cprSeries: cprSeries,
      };
      var _chartLabels = labels, _chartIsoDates = isoDates, _spendSeriesMajor = spendSeriesMajor;
      requestAnimationFrame(function () {
        safeRender('charts', function () {
          var hasSpend = _spendSeriesMajor.some(function(v){ return v != null && v > 0; });
          var emptyEl = document.getElementById('chart-spend-main-empty');
          var canvasEl = document.getElementById('chart-spend-main');
          if (!hasSpend || !_chartLabels.length) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (canvasEl) canvasEl.style.display = 'none';
          } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (canvasEl) canvasEl.style.display = '';
            var spendDatasets = [
              buildDataset(lbl('Spend', 'الإنفاق'), _spendSeriesMajor, '#D9A759', 'rgba(217,167,89,0.12)', true, 'currency'),
            ];
            var markerDataset = buildIssueMarkerDataset(_chartLabels, _chartIsoDates, state.lastIssueDates);
            if (markerDataset) spendDatasets.push(markerDataset);
            makeLineChart('chart-spend-main', _chartLabels, spendDatasets, { maxTicks: 10 });
          }
          renderAdvancedCharts(false);
        });
      });

      safeRender('attribution', function () { renderAttribution(dashData.attribution || null); });
      safeRender('diagnoses', function () { renderDiagnoses(Array.isArray(dashData.diagnoses) ? dashData.diagnoses : []); });
      safeRender('issues', function () { renderIssues(Array.isArray(dashData.issues) ? dashData.issues : []); });
    } catch (e) {
      console.error('[dashboard] applyDashboardData failed:', e);
      if (isInitial) throw e;
    }
  }

  // ── Main init ───────────────────────────────────────────────────────────
  async function init() {
    try {
      wireMainMoveActions();
      var advDetails = document.querySelector('details.v2-advanced');
      if (advDetails) advDetails.addEventListener('toggle', renderAdvancedChartsIfOpen);
      startLoadingSafetyTimeout(5000);

      // Wire refresh button
      var refreshBtn = document.getElementById('cmd-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          if (!state.workspaceId || refreshInFlight) return;
          refreshBtn.classList.add('spinning');
          refreshDashboardData(state.workspaceId, { force: true })
            .catch(function () { /* silent */ })
            .finally(function () { refreshBtn.classList.remove('spinning'); });
        });
      }

      var token = getToken();
      if (!token) { window.location.href = '/login'; return; }

      // 1) Identify user — shared shell init (timeout-bounded)
      var me = await initAppShell();
      if (!me) return;
      state.locale = (me.locale || 'AR').toUpperCase();
      var userName = me.name || me.email || 'User';
      var userInitials = initialsOf(userName);
      var avEl = document.getElementById('user-avatar');     if (avEl) avEl.textContent = userInitials;
      var nameEl = document.getElementById('user-name');     if (nameEl) nameEl.textContent = userName;
      var emailEl = document.getElementById('user-email');   if (emailEl) emailEl.textContent = me.email || '';

      // 2) Resolve workspace
      var workspaceId = getWsId();
      if (!workspaceId && me.memberships && me.memberships.length > 0) {
        workspaceId = me.memberships[0].workspaceId || (me.memberships[0].workspace && me.memberships[0].workspace.id);
        if (workspaceId) setWsId(workspaceId);
      }
      if (!workspaceId) {
        hideLoadingShowDashboard();
        document.getElementById('kpi-grid').innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">No workspace found</div><div class="empty-text">Create or join a workspace to see your dashboard.</div></div>';
        return;
      }
      state.workspaceId = workspaceId;

      await resumeActiveSyncIfAny(workspaceId, {
        statusContainerId: 'dashboard-content',
        onComplete: function () {
          refreshDashboardData(workspaceId, { force: true }).catch(function (e) {
            console.warn('[dashboard] post-sync refresh failed:', e);
          });
        },
      });

      var urlParams = new URLSearchParams(window.location.search);
      var isPostConnect = urlParams.get('connected') === '1';
      var syncJobId = urlParams.get('syncJob') || null;
      if (isPostConnect || syncJobId) {
        await waitForInitialSync(syncJobId, workspaceId);
        window.history.replaceState({}, '', '/dashboard');
      }

      // 3) Parallel data fetch — dashboard failure is fatal; secondary calls degrade.
      var dashFetchFailed = null;
      var results = await Promise.all([
        apiFetchWithTimeout('/api/dashboard/' + workspaceId, {}, 15000).catch(function (e) {
          console.warn('[dashboard] dashboard fetch failed:', e);
          dashFetchFailed = e;
          return null;
        }),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId + '/insights?days=90', {}, 15000).catch(function () { return []; }),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId + '/campaigns', {}, 15000).catch(function () { return []; }),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId, {}, 15000).catch(function () { return null; }),
        apiFetchWithTimeout('/api/workspaces/' + workspaceId + '/issue-dates?days=30', {}, 15000).catch(function () { return []; }),
      ]);
      var dashData = results[0];

      if (dashFetchFailed || !dashData) {
        hideLoadingShowDashboard();
        showError(friendlyApiError(dashFetchFailed || { message: 'تعذّر تحميل لوحة التحكم' }));
        return;
      }
      if (dashData.error || dashData.code === 'DASHBOARD_TIMEOUT') {
        hideLoadingShowDashboard();
        showError(friendlyApiError(Object.assign(new Error(dashData.error || 'انتهت مهلة تحميل اللوحة'), { code: dashData.code })));
        return;
      }

      if (dashData.workspace && dashData.workspace.locale) {
        state.locale = String(dashData.workspace.locale).toUpperCase();
      }
      var insights = results[1] || [];
      var campaigns = results[2] || [];
      var wsData = results[3];
      state.lastIssueDates = Array.isArray(results[4]) ? results[4] : [];

      // 4) Empty state — no ad account connected
      if (dashData.empty) {
        if (!isPostConnect) {
          window.location.href = '/welcome';
          return;
        }
        hideLoadingShowDashboard();
        document.getElementById('hero-grid').innerHTML =
          '<div class="empty-state" style="grid-column:1/-1;">'
          + '<div class="empty-icon">📊</div>'
          + '<div class="empty-title">' + lbl('Connect your Meta Ads account', 'اربط حساب إعلانات Meta') + '</div>'
          + '<div class="empty-text">' + lbl('Link your ad account to see spend, engagement, reach, and AI-powered recommendations.', 'اربط حسابك الإعلاني لرؤية الإنفاق وتفاعل الإعلان والوصول والتوصيات الذكية.') + '</div>'
          + '<a href="/welcome" class="btn btn-primary" style="margin-top:14px;">' + lbl('Connect with Meta', 'الربط مع Meta') + '</a>'
        + '</div>';
        return;
      }

      // Show the container FIRST so Chart.js canvases have real dimensions.
      hideLoadingShowDashboard();
      try {
        applyDashboardData(dashData, insights, campaigns, wsData, true);
        startAutoRefresh(workspaceId);
      } catch (renderErr) {
        console.error('[dashboard] init render failed:', renderErr);
        showError(friendlyApiError(renderErr));
      }

    } catch (err) {
      console.error('[dashboard] init failed:', err);
      hideLoadingShowDashboard();
      showError(friendlyApiError(err));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
</script>`;

  return layout({ title: 'لوحة التحكم', active: 'dashboard', content, scripts, extraHead, mode: 'pro' });
}
