// ════════════════════════════════════════════════════════════════════════
//  src/web/pages/settingsPage.ts
// ════════════════════════════════════════════════════════════════════════

import { layout } from '../layout';

export function settingsPage(): string {
  const content = `
<div class="settings-shell">
  <div class="page-header settings-header">
    <div>
      <div class="page-title">الإعدادات</div>
      <div class="page-subtitle">إدارة حسابك، الحسابات المتصلة، والاشتراك</div>
    </div>
    <div class="settings-version" title="إصدار المنتج">
      <span class="settings-version-dot"></span>
      <span class="settings-version-label">الإصدار</span>
      <span class="settings-version-value">V1.1</span>
    </div>
  </div>

  <div class="settings-layout">
    <!-- Side nav (RTL: appears on the right) -->
    <nav class="settings-nav" id="settings-nav">
      <div class="settings-nav-group">
        <div class="settings-nav-section-label">الحساب</div>
        <button class="settings-nav-item active" data-tab="profile">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 17c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>الملف الشخصي</span>
        </button>
        <button class="settings-nav-item" data-tab="accounts">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6 10h8M6 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>الحسابات المتصلة</span>
        </button>
        <button class="settings-nav-item" data-tab="security">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><rect x="5" y="9" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.5a3 3 0 016 0V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="13" r="1" fill="currentColor"/></svg>
          <span>الأمان</span>
        </button>
      </div>
      <div class="settings-nav-group">
        <div class="settings-nav-section-label">التفضيلات</div>
        <button class="settings-nav-item" data-tab="notifications">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><path d="M10 2a5 5 0 00-5 5v3l-1.3 2.6a.5.5 0 00.45.7h11.7a.5.5 0 00.45-.7L15 10V7a5 5 0 00-5-5z" stroke="currentColor" stroke-width="1.5"/><path d="M8 14a2 2 0 004 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>الإشعارات</span>
        </button>
        <button class="settings-nav-item" data-tab="billing">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.5"/><path d="M5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>الفوترة</span>
        </button>
      </div>
      <div class="settings-nav-group">
        <button class="settings-nav-item settings-nav-danger" data-tab="danger">
          <svg class="settings-nav-svg" viewBox="0 0 20 20" fill="none"><path d="M10 3L2 17h16L10 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 9v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="14.5" r="0.8" fill="currentColor"/></svg>
          <span>منطقة الخطر</span>
        </button>
      </div>
    </nav>

    <div class="settings-main">
      <!-- Profile -->
      <div id="tab-profile" class="settings-panel">
        <div class="settings-card settings-profile-hero">
          <div id="profile-loading" class="loading-overlay" style="min-height:80px;"><div class="spinner"></div></div>
          <div id="profile-form" style="display:none;">
            <div class="settings-profile-top">
              <div class="settings-avatar-lg" id="profile-avatar"></div>
              <div class="settings-profile-info">
                <div id="profile-name-display" class="settings-profile-name"></div>
                <div id="profile-email-display" class="settings-profile-email"></div>
                <div class="settings-profile-joined">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                  <span id="profile-joined-text">عضو منذ ٢٠٢٤</span>
                </div>
              </div>
            </div>
            <div id="profile-success" class="alert alert-success" style="display:none;"></div>
            <div id="profile-error" class="alert alert-error" style="display:none;"></div>
            <div class="settings-form-grid">
              <div class="form-group">
                <label class="form-label">الاسم الكامل</label>
                <input type="text" id="name-input" class="form-input" placeholder="اسمك الكامل">
              </div>
              <div class="form-group">
                <label class="form-label">اللغة</label>
                <select id="locale-input" class="form-input">
                  <option value="EN">English</option>
                  <option value="AR">العربية (Arabic)</option>
                </select>
              </div>
              <div class="form-group settings-form-full">
                <label class="form-label">البريد الإلكتروني</label>
                <input type="email" id="email-input" class="form-input" disabled>
                <div class="form-hint">تغيير البريد الإلكتروني يتطلب التحقق من الحساب.</div>
              </div>
            </div>
            <div class="settings-actions">
              <button class="btn btn-primary" id="save-profile-btn">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                حفظ التغييرات
              </button>
            </div>
          </div>
        </div>

        <!-- Workspace overview card -->
        <div class="settings-card settings-workspace-card">
          <div class="settings-card-head">
            <div class="settings-card-head-row">
              <h3>مساحة العمل</h3>
              <span id="ws-tier-badge" class="badge badge-gray">—</span>
            </div>
            <p>نظرة عامة على مساحة العمل وحصص الاستخدام</p>
          </div>
          <div id="ws-overview-loading" class="loading-overlay" style="min-height:60px;"><div class="spinner"></div></div>
          <div id="ws-overview-body" style="display:none;">
            <div class="ws-stats-row">
              <div class="ws-stat-item">
                <div class="ws-stat-value" id="ws-ad-accounts">—</div>
                <div class="ws-stat-label">حسابات إعلانية</div>
              </div>
              <div class="ws-stat-item">
                <div class="ws-stat-value" id="ws-campaigns">—</div>
                <div class="ws-stat-label">حملات نشطة</div>
              </div>
              <div class="ws-stat-item">
                <div class="ws-stat-value" id="ws-syncs">—</div>
                <div class="ws-stat-label">آخر مزامنة</div>
              </div>
              <div class="ws-stat-item">
                <div class="ws-stat-value" id="ws-members">—</div>
                <div class="ws-stat-label">أعضاء</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Connected Accounts -->
      <div id="tab-accounts" class="settings-panel" style="display:none;">
        <div class="settings-card">
          <div class="settings-card-head">
            <h3>الحسابات الإعلانية المتصلة</h3>
            <p>حسابات Meta المرتبطة بمساحة عملك</p>
          </div>
          <div id="accounts-loading" class="loading-overlay" style="min-height:80px;"><div class="spinner"></div></div>
          <div id="accounts-body" style="display:none;">
            <div id="accounts-list" class="settings-accounts-list"></div>
            <div id="accounts-empty" class="settings-empty-state" style="display:none;">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="4" y="8" width="32" height="24" rx="4" stroke="var(--text-3)" stroke-width="2"/><path d="M12 20h16M12 25h8" stroke="var(--text-3)" stroke-width="1.5" stroke-linecap="round"/></svg>
              <p>لا توجد حسابات إعلانية متصلة بعد</p>
              <span>اربط حسابك الإعلاني في Meta لبدء تتبع حملاتك</span>
            </div>
          </div>
        </div>
        <div class="settings-card settings-meta-connect-card">
          <div class="settings-card-head-row" style="margin-bottom:16px;">
            <div>
              <h3 class="settings-card-head h3" style="margin:0 0 4px;">ربط حساب جديد</h3>
              <p class="settings-card-head p" style="margin:0;">أضف حسابات Meta Ads إضافية لمراقبتها</p>
            </div>
            <button class="btn btn-primary btn-sm" id="connect-meta-btn">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              ربط حساب
            </button>
          </div>
          <div class="settings-meta-note">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 7v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="5" r="0.8" fill="currentColor"/></svg>
            <span>يتطلب صلاحية مسؤول (Admin) أو معلن (Advertiser) على حساب Meta Business</span>
          </div>
        </div>
      </div>

      <!-- Security -->
      <div id="tab-security" class="settings-panel" style="display:none;">
        <div class="settings-card">
          <div class="settings-card-head">
            <h3>تغيير كلمة المرور</h3>
            <p>استخدم كلمة مرور قوية لا تقل عن 8 أحرف</p>
          </div>
          <div id="pw-success" class="alert alert-success" style="display:none;"></div>
          <div id="pw-error" class="alert alert-error" style="display:none;"></div>
          <div class="settings-form-grid">
            <div class="form-group settings-form-full">
              <label class="form-label">كلمة المرور الحالية</label>
              <div class="input-with-icon">
                <input type="password" id="pw-current" class="form-input" autocomplete="current-password">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">كلمة المرور الجديدة</label>
              <input type="password" id="pw-new" class="form-input" autocomplete="new-password">
              <div class="pw-strength-bar"><div class="pw-strength-fill" id="pw-strength-fill"></div></div>
            </div>
            <div class="form-group">
              <label class="form-label">تأكيد كلمة المرور</label>
              <input type="password" id="pw-confirm" class="form-input" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-actions"><button class="btn btn-primary" id="save-pw-btn">تحديث كلمة المرور</button></div>
        </div>
        <div class="settings-card">
          <div class="settings-card-head">
            <h3>الجلسات النشطة</h3>
            <p>الأجهزة المتصلة بحسابك حالياً</p>
          </div>
          <div class="settings-session-row">
            <div class="settings-session-info">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 16h6M10 13v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <div>
                <div class="settings-session-title">الجلسة الحالية</div>
                <div class="settings-session-meta">هذا الجهاز · نشط الآن</div>
              </div>
            </div>
            <span class="badge badge-green">الحالية</span>
          </div>
          <div class="settings-actions"><button class="btn btn-danger btn-sm" id="signout-all-btn">تسجيل الخروج من جميع الجلسات الأخرى</button></div>
        </div>
      </div>

      <!-- Notifications -->
      <div id="tab-notifications" class="settings-panel" style="display:none;">
        <div class="settings-card">
          <div class="settings-card-head">
            <h3>تفضيلات الإشعارات</h3>
            <p>اختر ما تريد أن يصلك من تنبيهات Adlytic</p>
          </div>
          <div class="settings-toggle-list">
            ${[
              ['notif-issues', 'تنبيهات المشكلات', 'إشعار عند اكتشاف مشكلات أداء جديدة في حملاتك', 'var(--error)'],
              ['notif-budget', 'تحذيرات الميزانية', 'تنبيه عندما تكون وتيرة الإنفاق غير طبيعية أو تقترب من الحد', 'var(--warning)'],
              ['notif-recs', 'توصيات جديدة', 'ملخص أسبوعي لأهم التوصيات المبنية على بيانات Meta', 'var(--accent)'],
              ['notif-sync', 'إشعارات المزامنة', 'عند اكتمال أو فشل مزامنة البيانات من Meta', 'var(--text-3)'],
              ['notif-digest', 'ملخص الأداء الأسبوعي', 'تقرير موجز بأهم مقاييس الأداء كل أسبوع', 'var(--success)'],
            ].map(([id, label, desc, color]) => `
            <div class="settings-toggle-row">
              <div class="settings-toggle-row-content">
                <span class="settings-toggle-indicator" style="background:${color};"></span>
                <div>
                  <div class="settings-toggle-label">${label}</div>
                  <div class="settings-toggle-desc">${desc}</div>
                </div>
              </div>
              <label class="settings-toggle"><input type="checkbox" id="${id}" checked><span class="toggle-track"></span></label>
            </div>`).join('')}
          </div>
          <div class="settings-actions"><button class="btn btn-primary" id="save-notif-btn">حفظ التفضيلات</button></div>
        </div>
      </div>

      <!-- Billing -->
      <div id="tab-billing" class="settings-panel" style="display:none;">
        <div class="settings-card">
          <div class="settings-card-head">
            <h3>الاشتراك</h3>
            <p>إدارة خطتك وطرق الدفع</p>
          </div>
          <div id="billing-banner" class="alert" style="display:none;margin-bottom:16px;"></div>
          <div id="billing-loading" class="loading-overlay" style="min-height:80px;"><div class="spinner"></div></div>
          <div id="billing-body" style="display:none;">
            <div class="settings-billing-plan">
              <div class="billing-plan-card" id="billing-plan-card">
                <div class="billing-plan-header">
                  <span id="billing-tier-badge" class="badge">—</span>
                  <div id="billing-status-line" class="settings-session-meta"></div>
                </div>
                <div id="billing-expiry-line" class="billing-plan-expiry" style="display:none;"></div>
                <div class="billing-plan-features">
                  <div class="billing-feature"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12l-3.5-3.5" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> مزامنة كل 6 ساعات</div>
                  <div class="billing-feature"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12l-3.5-3.5" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> توصيات مدعومة بـ AI</div>
                  <div class="billing-feature"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12l-3.5-3.5" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> تنبيهات فورية</div>
                </div>
              </div>
            </div>
            <div id="billing-owner-actions" style="display:none;margin-top:20px;">
              <button id="upgrade-premium-btn" class="btn btn-accent-gradient" style="width:100%;">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l2.2 4.5 4.8.7-3.5 3.4.8 4.9L8 12.1l-4.3 2.4.8-4.9L1 6.2l4.8-.7L8 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
                ترقية إلى Premium — $10 / شهر
              </button>
              <div class="form-hint" style="margin-top:8px;text-align:center;">Powered by Stripe. Sandbox: card 4242 4242 4242 4242.</div>
            </div>
            <div id="billing-non-owner-note" style="display:none;margin-top:16px;" class="form-hint">فقط مالك مساحة العمل يمكنه إدارة الفوترة.</div>
            <div class="settings-divider"></div>
            <div class="billing-alt-pay">
              <div class="billing-alt-pay-text">
                <h4>طرق دفع بديلة</h4>
                <p>Zain Cash، Asia Hawala، أو تحويل بنكي</p>
              </div>
              <button id="whatsapp-pay-btn" class="btn btn-secondary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 00-6.1 10.4L1 15l3.7-.9A7 7 0 108 1z" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 6.5c.2-.8.6-1 1-1s.8.4.9.8l.3.8c.1.2 0 .4-.2.6l-.4.3s0 .3.5.8.7.5.7.5l.4-.4c.2-.2.4-.2.6-.1l.8.4c.4.2.6.5.5 1-.1.5-.5 1-1.2 1-1.5 0-3.4-1.2-3.9-3.7z" stroke="currentColor" stroke-width="1"/></svg>
                تواصل عبر واتساب
              </button>
            </div>
          </div>
          <div id="billing-error" class="alert alert-error" style="display:none;margin-top:12px;"></div>
        </div>
      </div>

      <!-- Danger -->
      <div id="tab-danger" class="settings-panel" style="display:none;">
        <div class="settings-card settings-card-danger">
          <div class="settings-card-head"><h3 style="color:var(--error);">منطقة الخطر</h3><p>إجراءات لا يمكن التراجع عنها — تأكد قبل التنفيذ</p></div>
          <div class="settings-danger-item">
            <div class="settings-danger-item-info">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M6 6V5a2 2 0 012-2h4a2 2 0 012 2v1M8 9v5M12 9v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 6l.7 10a2 2 0 002 1.8h4.6a2 2 0 002-1.8L15 6" stroke="currentColor" stroke-width="1.5"/></svg>
              <div>
                <div class="settings-toggle-label">تصدير بيانات الحساب</div>
                <div class="settings-toggle-desc">تحميل أرشيف JSON لجميع بياناتك (الحملات، التوصيات، الإعدادات)</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="export-btn">تصدير</button>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-danger-item">
            <div class="settings-danger-item-info">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="color:var(--error);"><path d="M10 3L2 17h16L10 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 9v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="14.5" r="0.8" fill="currentColor"/></svg>
              <div>
                <div class="settings-toggle-label" style="color:var(--error);">حذف الحساب</div>
                <div class="settings-toggle-desc">حذف نهائي لجميع البيانات — لا يمكن استرجاعها بعد الحذف</div>
              </div>
            </div>
            <button class="btn btn-danger btn-sm" id="delete-account-btn">حذف</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-shell { direction: rtl; max-width: 980px; margin: 0 auto; }
  .settings-header {
    margin-bottom: 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .settings-version {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(217,167,89,0.05);
    flex-shrink: 0;
  }
  .settings-version-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 6px rgba(52,168,113,0.5);
    animation: pulse-dot 2s infinite;
  }
  @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .settings-version-label {
    font-size: 12px; font-weight: 600; color: var(--text-3);
  }
  .settings-version-value {
    font-family: var(--font-display);
    font-size: 13px; font-weight: 700;
    color: var(--accent-2); letter-spacing: 0.02em;
  }
  .settings-layout {
    display: grid; grid-template-columns: 230px 1fr; gap: 28px; align-items: start;
  }
  @media (max-width: 768px) {
    .settings-layout { grid-template-columns: 1fr; }
    .settings-nav {
      display: flex !important; flex-wrap: wrap; gap: 6px;
      flex-direction: row !important; padding: 10px !important;
    }
    .settings-nav-item { flex: 1 1 auto; justify-content: center; min-width: 100px; }
    .settings-nav-group { display: contents; }
    .settings-nav-section-label { display: none; }
  }
  .settings-nav {
    display: flex; flex-direction: column; gap: 2px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 12px;
    position: sticky; top: 16px;
    box-shadow: var(--shadow);
  }
  .settings-nav-group { margin-bottom: 10px; }
  .settings-nav-group:last-child { margin-bottom: 0; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border); }
  .settings-nav-section-label {
    font-size: 10px; font-weight: 700; color: var(--text-3);
    letter-spacing: 0.06em; padding: 6px 12px 6px;
    text-transform: uppercase;
  }
  .settings-nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px; border: none; border-radius: var(--radius);
    background: transparent; color: var(--text-2); font-size: 13px; font-weight: 600;
    cursor: pointer; text-align: right; width: 100%;
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }
  .settings-nav-item:hover { background: var(--surface-hover); color: var(--text); }
  .settings-nav-item:active { transform: scale(0.98); }
  .settings-nav-item.active {
    background: var(--accent-dim); color: var(--accent-2);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .settings-nav-danger { color: var(--error); }
  .settings-nav-danger:hover { background: var(--error-dim); }
  .settings-nav-danger.active { background: var(--error-dim); color: var(--error); box-shadow: inset 3px 0 0 var(--error); }
  .settings-nav-svg { width: 18px; height: 18px; flex-shrink: 0; }

  .settings-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 24px 28px; margin-bottom: 16px;
    transition: border-color 0.2s;
  }
  .settings-card:hover { border-color: var(--border-2); }
  .settings-card-danger { border-color: rgba(199,56,42,0.25); background: linear-gradient(180deg, rgba(199,56,42,0.03), var(--surface)); }
  .settings-card-head { margin-bottom: 20px; }
  .settings-card-head h3 { font-size: 16px; font-weight: 700; color: var(--text); margin: 0 0 4px; }
  .settings-card-head p { font-size: 12.5px; color: var(--text-3); margin: 0; }
  .settings-card-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

  .settings-profile-hero {
    background: linear-gradient(145deg, rgba(217,167,89,0.06), var(--surface));
    border-color: rgba(217,167,89,0.2);
  }
  .settings-profile-top { display: flex; align-items: center; gap: 20px; margin-bottom: 28px; }
  .settings-avatar-lg {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #1A1613; font-size: 26px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 20px rgba(217,167,89,0.3);
    flex-shrink: 0;
  }
  .settings-profile-info { display: flex; flex-direction: column; gap: 3px; }
  .settings-profile-name { font-size: 18px; font-weight: 700; color: var(--text); }
  .settings-profile-email { font-size: 13px; color: var(--text-2); }
  .settings-profile-joined {
    display: flex; align-items: center; gap: 5px;
    font-size: 11.5px; color: var(--text-3); margin-top: 4px;
  }

  .settings-workspace-card { border-color: var(--border); }
  .ws-stats-row {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  }
  @media (max-width: 600px) { .ws-stats-row { grid-template-columns: repeat(2, 1fr); } }
  .ws-stat-item {
    text-align: center; padding: 16px 8px;
    background: var(--surface-2); border-radius: var(--radius);
    border: 1px solid var(--border);
  }
  .ws-stat-value {
    font-family: var(--font-display); font-size: 20px; font-weight: 700;
    color: var(--accent-2); margin-bottom: 4px;
  }
  .ws-stat-label { font-size: 11px; color: var(--text-3); font-weight: 600; }

  .settings-accounts-list { display: flex; flex-direction: column; gap: 10px; }
  .settings-account-item {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 16px; border-radius: var(--radius);
    background: var(--surface-2); border: 1px solid var(--border);
    transition: border-color 0.15s;
  }
  .settings-account-item:hover { border-color: var(--border-2); }
  .settings-account-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .settings-account-icon {
    width: 36px; height: 36px; border-radius: 8px;
    background: linear-gradient(135deg, #1877F2, #0B5ED7);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(24,119,242,0.25);
  }
  .settings-account-icon svg { width: 18px; height: 18px; color: #fff; }
  .settings-account-name { font-size: 13.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .settings-account-id { font-size: 11px; color: var(--text-3); margin-top: 1px; font-family: monospace; }
  .settings-account-status {
    font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px;
    flex-shrink: 0;
  }
  .settings-account-status.active { background: var(--success-dim); color: var(--success); }
  .settings-account-status.paused { background: var(--warning-dim); color: var(--warning); }

  .settings-empty-state {
    text-align: center; padding: 32px 16px;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .settings-empty-state p { font-size: 14px; font-weight: 600; color: var(--text-2); margin: 0; }
  .settings-empty-state span { font-size: 12px; color: var(--text-3); }

  .settings-meta-connect-card { background: linear-gradient(145deg, rgba(24,119,242,0.04), var(--surface)); }
  .settings-meta-note {
    display: flex; align-items: center; gap: 8px;
    font-size: 11.5px; color: var(--text-3);
    padding: 10px 12px; border-radius: var(--radius);
    background: var(--surface-2); border: 1px solid var(--border);
  }

  .settings-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .settings-form-full { grid-column: 1 / -1; }
  @media (max-width: 520px) { .settings-form-grid { grid-template-columns: 1fr; } }
  .form-hint { font-size: 11.5px; color: var(--text-3); margin-top: 6px; }
  .settings-actions { margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap; }

  .pw-strength-bar {
    height: 3px; border-radius: 2px; margin-top: 8px;
    background: var(--border); overflow: hidden;
  }
  .pw-strength-fill {
    height: 100%; width: 0%; border-radius: 2px;
    transition: width 0.3s, background 0.3s;
  }

  .settings-session-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    padding: 14px 0;
  }
  .settings-session-info { display: flex; align-items: center; gap: 12px; }
  .settings-session-info svg { color: var(--text-3); flex-shrink: 0; }
  .settings-session-title { font-size: 14px; font-weight: 600; color: var(--text); }
  .settings-session-meta { font-size: 12px; color: var(--text-3); margin-top: 2px; }

  .settings-toggle-list { display: flex; flex-direction: column; }
  .settings-toggle-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 0; border-bottom: 1px solid var(--border);
  }
  .settings-toggle-row:last-child { border-bottom: none; }
  .settings-toggle-row-content { display: flex; align-items: flex-start; gap: 12px; }
  .settings-toggle-indicator {
    width: 4px; height: 4px; border-radius: 50%; margin-top: 7px; flex-shrink: 0;
  }
  .settings-toggle-label { font-size: 14px; font-weight: 600; color: var(--text); }
  .settings-toggle-desc { font-size: 12px; color: var(--text-3); margin-top: 2px; max-width: 340px; }
  .settings-toggle { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; flex-shrink: 0; }
  .settings-toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute; inset: 0; background: var(--border-2); border-radius: 12px; transition: background 0.2s;
  }
  .toggle-track::after {
    content: ''; position: absolute; width: 18px; height: 18px; border-radius: 50%; background: #fff;
    top: 3px; left: 3px; transition: transform 0.2s;
  }
  .settings-toggle input:checked + .toggle-track { background: var(--accent); }
  .settings-toggle input:checked + .toggle-track::after { transform: translateX(20px); }
  .settings-divider { height: 1px; background: var(--border); margin: 18px 0; }

  .settings-billing-plan { margin-bottom: 0; }
  .billing-plan-card {
    padding: 20px; border-radius: var(--radius);
    background: var(--surface-2); border: 1px solid var(--border);
  }
  .billing-plan-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .billing-plan-expiry { font-size: 12px; color: var(--text-3); margin-bottom: 12px; }
  .billing-plan-features { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .billing-feature {
    display: flex; align-items: center; gap: 8px;
    font-size: 12.5px; color: var(--text-2); font-weight: 500;
  }
  .btn-accent-gradient {
    background: var(--grad-accent); color: #1A1613;
    border: none; border-radius: var(--radius); padding: 12px 20px;
    font-size: 14px; font-weight: 700; cursor: pointer;
    display: inline-flex; align-items: center; gap: 8px; justify-content: center;
    transition: opacity 0.15s, transform 0.1s;
    box-shadow: var(--shadow-accent);
  }
  .btn-accent-gradient:hover { opacity: 0.9; }
  .btn-accent-gradient:active { transform: scale(0.98); }

  .billing-alt-pay {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }
  .billing-alt-pay-text h4 { font-size: 13px; font-weight: 700; color: var(--text); margin: 0 0 2px; }
  .billing-alt-pay-text p { font-size: 12px; color: var(--text-3); margin: 0; }

  .settings-danger-item {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    padding: 14px 0;
  }
  .settings-danger-item-info { display: flex; align-items: flex-start; gap: 12px; }
  .settings-danger-item-info svg { flex-shrink: 0; color: var(--text-3); margin-top: 2px; }
</style>`;

  const scripts = `<script>
(async () => {
  const token = localStorage.getItem('adlytic_token');
  if (!token) { window.location.href = '/login'; return; }
  const wsId = localStorage.getItem('adlytic_workspace_id');

  const me = await apiFetch('/api/auth/me');
  if (!me) return;
  document.getElementById('user-name').textContent  = me.name || me.email;
  document.getElementById('user-email').textContent = me.email;
  document.getElementById('user-avatar').textContent = (me.name||me.email||'?')[0].toUpperCase();
  const wsM = wsId && me.memberships?.find(m => m.workspaceId === wsId);
  document.getElementById('ws-name').textContent = wsM?.workspace?.name || 'Workspace';

  document.getElementById('profile-loading').style.display = 'none';
  document.getElementById('profile-form').style.display = 'block';
  document.getElementById('profile-avatar').textContent = (me.name||me.email||'?')[0].toUpperCase();
  document.getElementById('profile-name-display').textContent = me.name || '—';
  document.getElementById('profile-email-display').textContent = me.email;
  document.getElementById('name-input').value = me.name || '';
  document.getElementById('email-input').value = me.email || '';
  document.getElementById('locale-input').value = me.locale || 'AR';

  // Tab navigation
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
    });
  });

  // Profile save
  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const name = document.getElementById('name-input').value.trim();
    if (!name) { toast('الاسم مطلوب', 'error'); return; }
    try {
      await apiFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
      document.getElementById('profile-name-display').textContent = name;
      document.getElementById('user-name').textContent = name;
      document.getElementById('user-avatar').textContent = name[0].toUpperCase();
      document.getElementById('profile-avatar').textContent = name[0].toUpperCase();
      document.getElementById('profile-success').textContent = 'تم تحديث الملف الشخصي بنجاح.';
      document.getElementById('profile-success').style.display = 'flex';
      setTimeout(() => document.getElementById('profile-success').style.display = 'none', 3000);
    } catch (e) {
      document.getElementById('profile-error').textContent = e.message || 'فشل التحديث';
      document.getElementById('profile-error').style.display = 'flex';
    }
  });

  // Password change
  document.getElementById('save-pw-btn').addEventListener('click', async () => {
    const cur = document.getElementById('pw-current').value;
    const nw = document.getElementById('pw-new').value;
    const conf = document.getElementById('pw-confirm').value;
    const errEl = document.getElementById('pw-error');
    const sucEl = document.getElementById('pw-success');
    errEl.style.display = sucEl.style.display = 'none';
    if (!cur || !nw || !conf) { errEl.textContent = 'جميع الحقول مطلوبة'; errEl.style.display = 'flex'; return; }
    if (nw !== conf) { errEl.textContent = 'كلمتا المرور غير متطابقتين'; errEl.style.display = 'flex'; return; }
    if (nw.length < 8) { errEl.textContent = '8 أحرف على الأقل'; errEl.style.display = 'flex'; return; }
    try {
      await apiFetch('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
      sucEl.textContent = 'تم تحديث كلمة المرور.';
      sucEl.style.display = 'flex';
      document.getElementById('pw-current').value = document.getElementById('pw-new').value = document.getElementById('pw-confirm').value = '';
      document.getElementById('pw-strength-fill').style.width = '0%';
    } catch (e) {
      errEl.textContent = e.message || 'فشل التحديث';
      errEl.style.display = 'flex';
    }
  });

  // Password strength indicator
  document.getElementById('pw-new').addEventListener('input', (e) => {
    const val = e.target.value;
    const fill = document.getElementById('pw-strength-fill');
    let strength = 0;
    if (val.length >= 8) strength++;
    if (val.length >= 12) strength++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) strength++;
    if (/[0-9]/.test(val)) strength++;
    if (/[^A-Za-z0-9]/.test(val)) strength++;
    const pct = Math.min(strength / 4 * 100, 100);
    fill.style.width = pct + '%';
    fill.style.background = pct <= 25 ? 'var(--error)' : pct <= 50 ? 'var(--warning)' : pct <= 75 ? 'var(--accent)' : 'var(--success)';
  });

  // Sign out all
  document.getElementById('signout-all-btn').addEventListener('click', async () => {
    if (!confirm('سيتم تسجيل الخروج من جميع الأجهزة الأخرى.')) return;
    try {
      await apiFetch('/api/auth/logout-all', { method: 'POST' });
      toast('تم تسجيل الخروج من الجلسات الأخرى.', 'success');
    } catch (e) { toast(e.message || 'فشل', 'error'); }
  });

  // Notifications save
  document.getElementById('save-notif-btn').addEventListener('click', () => toast('تم حفظ التفضيلات.', 'success'));

  // Export data
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const tk = localStorage.getItem('adlytic_token');
      const res = await fetch('/api/auth/export', { headers: { Authorization: 'Bearer ' + tk } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'adlytic-export.json'; a.click();
      URL.revokeObjectURL(url);
      toast('تم التصدير.', 'success');
    } catch (e) { toast(e.message || 'فشل التصدير', 'error'); }
  });

  // Billing result from redirect
  const _billingResult = new URLSearchParams(window.location.search).get('billing');
  if (_billingResult === 'success' || _billingResult === 'cancel') {
    const b = document.getElementById('billing-banner');
    b.className = _billingResult === 'success' ? 'alert alert-success' : 'alert alert-error';
    b.textContent = _billingResult === 'success'
      ? 'تم إرسال طلب الدفع — سيتم تفعيل Premium قريباً.'
      : 'تم إلغاء عملية الدفع.';
    b.style.display = 'flex';
    document.querySelector('[data-tab="billing"]').click();
  }

  // Workspace overview
  if (wsId) {
    (async function loadWorkspaceOverview() {
      try {
        const ws = await apiFetch('/api/workspaces/' + wsId);
        const badge = document.getElementById('ws-tier-badge');
        badge.className = 'badge ' + (ws.tier === 'PREMIUM' ? 'badge-green' : 'badge-gray');
        badge.textContent = ws.tier || 'FREE';
        const adAccounts = ws._count?.adAccounts ?? ws.adAccountCount ?? '—';
        const campaigns = ws._count?.campaigns ?? '—';
        const members = ws._count?.members ?? ws.memberCount ?? '—';
        document.getElementById('ws-ad-accounts').textContent = adAccounts;
        document.getElementById('ws-campaigns').textContent = campaigns;
        document.getElementById('ws-members').textContent = members;
        if (ws.lastSyncAt) {
          const syncDate = new Date(ws.lastSyncAt);
          if (!isNaN(syncDate.getTime())) {
            const ago = Math.round((Date.now() - syncDate.getTime()) / 60000);
            document.getElementById('ws-syncs').textContent = ago < 60 ? ago + ' د' : Math.round(ago/60) + ' س';
          } else {
            document.getElementById('ws-syncs').textContent = '—';
          }
        } else {
          document.getElementById('ws-syncs').textContent = '—';
        }
        document.getElementById('ws-overview-loading').style.display = 'none';
        document.getElementById('ws-overview-body').style.display = 'block';
      } catch (e) {
        document.getElementById('ws-overview-loading').style.display = 'none';
        document.getElementById('ws-overview-body').style.display = 'block';
      }
    })();
  }

  // Connected accounts tab
  if (wsId) {
    (async function loadAccounts() {
      try {
        const accounts = await apiFetch('/api/workspaces/' + wsId + '/ad-accounts');
        const listEl = document.getElementById('accounts-list');
        const emptyEl = document.getElementById('accounts-empty');
        if (!accounts || accounts.length === 0) {
          emptyEl.style.display = 'flex';
        } else {
          listEl.innerHTML = accounts.map(acc => \`
            <div class="settings-account-item">
              <div class="settings-account-info">
                <div class="settings-account-icon">
                  <svg viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1z" fill="#fff"/><path d="M10.5 5.5H9.2c-.4 0-.7.3-.7.7V7h2l-.3 2h-1.7v4H7V9H5.5V7H7V6a2 2 0 012-2h1.5v1.5z" fill="#1877F2"/></svg>
                </div>
                <div>
                  <div class="settings-account-name">\${escHtml(acc.name || acc.externalAccountId)}</div>
                  <div class="settings-account-id">ID: \${escHtml(acc.externalAccountId)}</div>
                </div>
              </div>
              <span class="settings-account-status \${acc.status === 'ACTIVE' ? 'active' : 'paused'}">\${acc.status === 'ACTIVE' ? 'متصل' : 'متوقف'}</span>
            </div>
          \`).join('');
        }
        document.getElementById('accounts-loading').style.display = 'none';
        document.getElementById('accounts-body').style.display = 'block';
      } catch (e) {
        document.getElementById('accounts-loading').style.display = 'none';
        document.getElementById('accounts-body').style.display = 'block';
        document.getElementById('accounts-empty').style.display = 'flex';
      }
    })();
  }

  // Connect Meta button
  document.getElementById('connect-meta-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/meta/auth-url?workspaceId=' + encodeURIComponent(wsId));
      if (res && res.url) window.location.href = res.url;
      else toast('لا يمكن بدء عملية الربط حالياً', 'error');
    } catch (e) { toast(e.message || 'فشل', 'error'); }
  });

  // Billing
  if (wsId) {
    (async function loadBilling() {
      const loadEl = document.getElementById('billing-loading');
      const bodyEl = document.getElementById('billing-body');
      const errEl = document.getElementById('billing-error');
      try {
        const ws = await apiFetch('/api/workspaces/' + wsId);
        const badge = document.getElementById('billing-tier-badge');
        badge.className = 'badge ' + (ws.tier === 'PREMIUM' ? 'badge-green' : 'badge-gray');
        badge.textContent = ws.tier || 'FREE';
        document.getElementById('billing-status-line').textContent = ws.subscriptionStatus || 'بدون اشتراك';
        if (ws.subscriptionExpiresAt) {
          const expEl = document.getElementById('billing-expiry-line');
          expEl.textContent = 'ينتهي: ' + new Date(ws.subscriptionExpiresAt).toLocaleDateString('ar');
          expEl.style.display = 'block';
        }
        if (wsM && wsM.role === 'OWNER' && ws.tier !== 'PREMIUM') {
          document.getElementById('billing-owner-actions').style.display = 'block';
        } else if (!wsM || wsM.role !== 'OWNER') {
          document.getElementById('billing-non-owner-note').style.display = 'block';
        }
        loadEl.style.display = 'none';
        bodyEl.style.display = 'block';
      } catch (e) {
        loadEl.style.display = 'none';
        errEl.textContent = e.message || 'فشل تحميل الفوترة';
        errEl.style.display = 'flex';
      }
    })();
  }

  document.getElementById('upgrade-premium-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('upgrade-premium-btn');
    btn.disabled = true;
    try {
      const res = await apiFetch('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ workspaceId: wsId, tier: 'PREMIUM' }) });
      if (res && res.url) window.location.href = res.url;
    } catch (e) {
      btn.disabled = false;
      toast(e.message || 'Checkout failed', 'error');
    }
  });

  document.getElementById('whatsapp-pay-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/billing/whatsapp-link?workspaceId=' + encodeURIComponent(wsId));
      if (res && res.url) window.open(res.url, '_blank', 'noopener');
    } catch (e) { toast(e.message || 'Failed', 'error'); }
  });

  // Delete account — requires password re-auth so a stolen session alone
  // cannot permanently erase customer data.
  document.getElementById('delete-account-btn').addEventListener('click', async () => {
    if (!confirm('حذف الحساب نهائياً؟ سيتم حذف جميع البيانات بلا رجعة.')) return;
    if (!confirm('هل أنت متأكد تماماً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    var password = prompt('أدخل كلمة المرور لتأكيد حذف الحساب:');
    if (!password) { toast('تم الإلغاء — كلمة المرور مطلوبة', 'error'); return; }
    try {
      await apiFetch('/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: password }),
      });
      logout();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
  });
})();
</script>`;

  return layout({ title: 'الإعدادات', active: 'settings', content, scripts });
}
