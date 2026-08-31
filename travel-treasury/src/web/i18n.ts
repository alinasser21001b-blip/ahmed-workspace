/**
 * Arabic-first. The traveller's father uses this in Arabic; English exists as
 * a secondary toggle for company reporting. Every user-visible string lives
 * here — a hard-coded English label in a component is a bug.
 */
export type Locale = 'ar' | 'en';

const dict = {
  appName: { ar: 'خزينة السفر', en: 'Travel Treasury' },
  login: { ar: 'تسجيل الدخول', en: 'Sign in' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  logout: { ar: 'خروج', en: 'Sign out' },
  home: { ar: 'الرئيسية', en: 'Home' },
  withdraw: { ar: 'سحب نقدي', en: 'Withdraw' },
  withdrawals: { ar: 'السحوبات', en: 'Withdrawals' },
  cards: { ar: 'البطاقات', en: 'Cards' },
  more: { ar: 'المزيد', en: 'More' },
  all: { ar: 'الكل', en: 'All' },
  personal: { ar: 'شخصي', en: 'Personal' },
  company: { ar: 'الشركة', en: 'Company' },
  personalCash: { ar: 'نقد شخصي', en: 'Personal cash' },
  companyCash: { ar: 'نقد الشركة', en: 'Company cash' },
  companyCashWithdrawn: { ar: 'نقد الشركة المسحوب', en: 'Company Cash Withdrawn' },
  notAnExpense: { ar: 'تحويل من رصيد البطاقة إلى نقد — ليس مصروفًا', en: 'A transfer from card balance to cash — not an expense' },
  totalWithdrawn: { ar: 'إجمالي المسحوب', en: 'Total withdrawn' },
  expectedCashOnHand: { ar: 'النقد المتوقع بحوزتك', en: 'Expected cash on hand' },
  received: { ar: 'المستلم', en: 'Received' },
  spent: { ar: 'المصروف', en: 'Spent' },
  withdrawalCount: { ar: 'عدد السحوبات', en: 'Withdrawals' },
  pending: { ar: 'معلّقة', en: 'Pending' },
  posted: { ar: 'مُقيّدة', en: 'Posted' },
  reconciled: { ar: 'مُطابَقة', en: 'Reconciled' },
  discrepancies: { ar: 'فروقات', en: 'Discrepancies' },
  openDiscrepancies: { ar: 'فروقات تحتاج مراجعة', en: 'Discrepancies needing review' },
  verifiedFees: { ar: 'الرسوم المؤكدة', en: 'Verified fees' },
  referenceRates: { ar: 'أسعار مرجعية', en: 'Reference rates' },
  referenceOnly: { ar: 'سعر مرجعي فقط — ليس سعر السحب الفعلي', en: 'Reference only — not your actual withdrawal rate' },
  quickWithdrawal: { ar: 'سحب سريع', en: 'Quick withdrawal' },
  fullMode: { ar: 'الوضع الكامل', en: 'Full mode' },
  card: { ar: 'البطاقة', en: 'Card' },
  chooseCard: { ar: 'اختر البطاقة', en: 'Choose a card' },
  cashReceived: { ar: 'المبلغ النقدي المستلم', en: 'Cash received' },
  requestedAmount: { ar: 'المبلغ المطلوب', en: 'Amount requested' },
  balanceBefore: { ar: 'الرصيد قبل السحب', en: 'Balance before' },
  balanceAfter: { ar: 'الرصيد بعد السحب', en: 'Balance after' },
  balanceSource: { ar: 'مصدر الرصيد', en: 'Balance source' },
  bankApp: { ar: 'تطبيق البنك', en: 'Bank app' },
  sms: { ar: 'رسالة نصية', en: 'SMS' },
  atmReceipt: { ar: 'إيصال الصراف', en: 'ATM receipt' },
  statement: { ar: 'كشف الحساب', en: 'Statement' },
  manual: { ar: 'إدخال يدوي', en: 'Manual' },
  available: { ar: 'متاح', en: 'Available' },
  ledger: { ar: 'دفتري', en: 'Ledger' },
  unknown: { ar: 'غير معروف', en: 'Unknown' },
  dccQuestion: { ar: 'هل عرض الصراف التحويل إلى عملة أخرى؟', en: 'Did the ATM offer currency conversion?' },
  dccChoseSar: { ar: 'اخترت الريال السعودي (صحيح ✓)', en: 'Chose SAR (correct ✓)' },
  dccChoseCard: { ar: 'اخترت عملة البطاقة (مكلف غالبًا)', en: 'Chose card currency (usually costly)' },
  dccAdvice: { ar: 'انصح دائمًا باختيار الريال السعودي عند السحب في السعودية', en: 'Always choose SAR at Saudi ATMs' },
  yes: { ar: 'نعم', en: 'Yes' },
  no: { ar: 'لا', en: 'No' },
  atmFee: { ar: 'رسوم الصراف (إن ظهرت)', en: 'ATM fee (if shown)' },
  atmOperator: { ar: 'بنك الصراف', en: 'ATM bank' },
  atmLocation: { ar: 'موقع الصراف', en: 'ATM location' },
  atmTerminalId: { ar: 'رقم الجهاز', en: 'Terminal ID' },
  save: { ar: 'حفظ', en: 'Save' },
  saveWithdrawal: { ar: 'حفظ السحب', en: 'Save withdrawal' },
  saving: { ar: 'جارٍ الحفظ…', en: 'Saving…' },
  savedOffline: { ar: 'حُفظ دون اتصال وسيُرسل عند عودة الشبكة', en: 'Saved offline; will sync when back online' },
  offlineDrafts: { ar: 'مسودات بانتظار الإرسال', en: 'Drafts awaiting sync' },
  syncNow: { ar: 'إرسال الآن', en: 'Sync now' },
  duplicateWarning: { ar: 'تنبيه: قد يكون هذا السحب مكررًا', en: 'Warning: this may be a duplicate' },
  duplicateConfirm: { ar: 'أؤكد أنه سحب جديد وليس تكرارًا', en: 'I confirm this is a new withdrawal, not a duplicate' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  state: { ar: 'الحالة', en: 'State' },
  details: { ar: 'التفاصيل', en: 'Details' },
  evidence: { ar: 'الأدلة', en: 'Evidence' },
  calculations: { ar: 'الحسابات', en: 'Calculations' },
  observedDelta: { ar: 'الفرق الملاحظ في الرصيد', en: 'Observed balance change' },
  pendingDebit: { ar: 'الخصم المعلّق', en: 'Pending debit' },
  postedDebit: { ar: 'الخصم النهائي', en: 'Posted debit' },
  issuerFees: { ar: 'رسوم البنك المُصدر', en: 'Issuer fees' },
  atmOperatorFee: { ar: 'رسوم بنك الصراف', en: 'ATM operator fee' },
  allInCost: { ar: 'التكلفة الإجمالية', en: 'All-in cost' },
  effectiveRate: { ar: 'سعر الصرف الفعلي', en: 'Effective rate' },
  referenceIqdCost: { ar: 'التكلفة بالدينار (مرجعية)', en: 'IQD cost (reference)' },
  economicIqdCost: { ar: 'التكلفة الحقيقية بالدينار', en: 'Real IQD cost' },
  verifiedIqdRate: { ar: 'السعر الاقتصادي المؤكد (دينار/ريال)', en: 'Verified IQD/SAR rate' },
  notEnoughEvidence: { ar: 'لا توجد أدلة كافية', en: 'Not enough evidence' },
  missingEvidence: { ar: 'الأدلة الناقصة', en: 'Missing evidence' },
  provenance: { ar: 'مصدر الرقم', en: 'Source of figure' },
  confidence: { ar: 'درجة الثقة', en: 'Confidence' },
  basis: { ar: 'أساس الحساب', en: 'Basis' },
  recordPending: { ar: 'تسجيل الخصم المعلّق', en: 'Record pending debit' },
  recordSettlement: { ar: 'تسجيل التسوية النهائية', en: 'Record final settlement' },
  pendingAmount: { ar: 'المبلغ المعلّق', en: 'Pending amount' },
  pendingFee: { ar: 'رسوم معلّقة', en: 'Pending fee' },
  postedAmount: { ar: 'المبلغ النهائي المخصوم', en: 'Final posted amount' },
  bankFee: { ar: 'رسوم البنك', en: 'Bank fee' },
  intlFee: { ar: 'رسوم دولية', en: 'International fee' },
  cashWithdrawalFee: { ar: 'رسوم سحب نقدي', en: 'Cash withdrawal fee' },
  otherFee: { ar: 'رسوم أخرى', en: 'Other fee' },
  statementDescription: { ar: 'وصف كشف الحساب', en: 'Statement description' },
  reconcile: { ar: 'مطابقة', en: 'Reconcile' },
  reconcileNow: { ar: 'تشغيل المطابقة', en: 'Run reconciliation' },
  expectedBalance: { ar: 'الرصيد المتوقع', en: 'Expected balance' },
  confirmedBalance: { ar: 'الرصيد المؤكد من البنك', en: 'Confirmed bank balance' },
  difference: { ar: 'الفرق', en: 'Difference' },
  unexplainedDifference: { ar: 'فرق غير مفسّر', en: 'Unexplained difference' },
  possibleCauses: { ar: 'أسباب محتملة', en: 'Possible causes' },
  classifyDiscrepancy: { ar: 'تصنيف الفرق', en: 'Classify the difference' },
  classification: { ar: 'التصنيف', en: 'Classification' },
  reverse: { ar: 'تسجيل عكس العملية', en: 'Record reversal' },
  reverseReason: { ar: 'سبب العكس', en: 'Reversal reason' },
  reversalKeepsOriginal: { ar: 'عكس العملية لا يحذف السجل الأصلي', en: 'A reversal never deletes the original record' },
  deleteWithdrawal: { ar: 'حذف السحب', en: 'Delete withdrawal' },
  deleteWithdrawalConfirm: { ar: 'حذف هذا السحب نهائيًا؟', en: 'Delete this withdrawal permanently?' },
  deleteWithdrawalWhen: {
    ar: 'الحذف لسجل يوثّق عملية لم تحدث أصلًا (تجربة أو إدخال بالخطأ) — ويعيد النقد ورصيد البطاقة إلى ما كانا عليه. أمّا إن حدث السحب فعلًا ثم أعاده البنك، فسجّل عكس العملية.',
    en: 'Delete a record of something that never happened — a test entry or a mistake — which returns the cash and the card balance to where they were. If the withdrawal did happen and the bank returned it, record a reversal instead.',
  },
  warnings: { ar: 'تنبيهات', en: 'Warnings' },
  revisions: { ar: 'سجل التعديلات', en: 'Revision history' },
  addCard: { ar: 'إضافة بطاقة', en: 'Add card' },
  manageCard: { ar: 'إدارة البطاقة', en: 'Manage card' },
  deleteCard: { ar: 'حذف البطاقة', en: 'Delete card' },
  archiveCard: { ar: 'أرشفة البطاقة', en: 'Archive card' },
  unarchiveCard: { ar: 'إعادة تفعيل البطاقة', en: 'Reactivate card' },
  archived: { ar: 'مؤرشفة', en: 'Archived' },
  deleteCardConfirm: { ar: 'حذف هذه البطاقة نهائيًا؟', en: 'Delete this card permanently?' },
  deleteCardOnlyEmpty: {
    ar: 'الحذف متاح فقط لبطاقة لم تُسجَّل عليها أي حركة. البطاقة التي تحمل سجلًا ماليًا تُؤرشَف حفاظًا على السجل.',
    en: 'Deleting is only possible for a card with no recorded activity. A card that holds financial records is archived instead, so the trail survives.',
  },
  archiveCardWhat: {
    ar: 'الأرشفة تُخفي البطاقة من المقارنة والمخطِّط وتمنع تسجيل سحوبات جديدة عليها — وكل سجلاتها تبقى محفوظة وقابلة للقراءة.',
    en: 'Archiving hides the card from the comparison and planner and blocks new withdrawals on it. Every existing record stays intact and readable.',
  },
  cardDeleted: { ar: 'تم حذف البطاقة', en: 'Card deleted' },
  cardArchived: { ar: 'تمت أرشفة البطاقة', en: 'Card archived' },
  cardUnarchived: { ar: 'تمت إعادة تفعيل البطاقة', en: 'Card reactivated' },
  nickname: { ar: 'اسم البطاقة', en: 'Nickname' },
  issuer: { ar: 'البنك المُصدر', en: 'Issuer' },
  product: { ar: 'نوع المنتج', en: 'Product' },
  network: { ar: 'الشبكة', en: 'Network' },
  cardType: { ar: 'نوع البطاقة', en: 'Card type' },
  debit: { ar: 'خصم مباشر', en: 'Debit' },
  credit: { ar: 'ائتمانية', en: 'Credit' },
  prepaid: { ar: 'مسبقة الدفع', en: 'Prepaid' },
  corporate: { ar: 'شركة', en: 'Corporate' },
  last4: { ar: 'آخر ٤ أرقام فقط', en: 'Last 4 digits only' },
  last4Warning: { ar: 'لا تُدخل رقم البطاقة الكامل أو الرقم السري أبدًا', en: 'Never enter the full card number or PIN' },
  ownership: { ar: 'العائدية', en: 'Ownership' },
  nativeCurrency: { ar: 'عملة البطاقة', en: 'Card currency' },
  openingBalance: { ar: 'الرصيد الافتتاحي', en: 'Opening balance' },
  dailyLimit: { ar: 'الحد اليومي للسحب', en: 'Daily ATM limit' },
  perTxnLimit: { ar: 'حد العملية الواحدة', en: 'Per-transaction limit' },
  monthlyIntlLimit: { ar: 'السقف الشهري للاستخدام خارج العراق (تعليمات البنك المركزي)', en: 'Monthly international cap (CBI instruction)' },
  intlStatus: { ar: 'هل تعمل البطاقة خارج العراق؟', en: 'Does the card work abroad?' },
  intlConfirmed: { ar: 'مؤكد أنها تعمل', en: 'Confirmed working' },
  intlClaimed: { ar: 'حسب إعلان البنك', en: 'Claimed by issuer' },
  intlRestricted: { ar: 'مقيّدة بقرار تنظيمي', en: 'Restricted by regulation' },
  intlUnknown: { ar: 'غير معروف — يجب التأكد من البنك', en: 'Unknown — confirm with the bank' },
  mastercardWarning: {
    ar: 'تنبيه مهم: وردت تقارير عن إيقاف استخدام ماستركارد العراقية خارج العراق منذ ٢٠٢٥/٠٦/٠١. تأكد من مصرف الرافدين قبل السفر.',
    en: 'Important: Iraqi Mastercard use abroad was reportedly suspended from 2025-06-01. Confirm with Rafidain before travelling.',
  },
  expectedLedgerBalance: { ar: 'الرصيد الدفتري المتوقع (حسابنا)', en: 'Expected ledger balance (ours)' },
  lastConfirmedBalance: { ar: 'آخر رصيد مؤكد من البنك', en: 'Last confirmed bank balance' },
  addSnapshot: { ar: 'تسجيل رصيد جديد', en: 'Record a balance' },
  addFunding: { ar: 'تسجيل شحن للبطاقة', en: 'Record card funding' },
  fundingCredited: { ar: 'المبلغ المضاف للبطاقة', en: 'Amount credited' },
  fundingIqdPaid: { ar: 'الدينار المدفوع فعليًا', en: 'IQD actually paid' },
  fundingFee: { ar: 'رسوم الشحن', en: 'Funding fee' },
  fundingWhy: {
    ar: 'تسجيل الشحن هو الطريقة الوحيدة لمعرفة التكلفة الحقيقية بالدينار لبطاقة بالدولار',
    en: 'Recording funding is the only way to know a USD card’s real dinar cost',
  },
  todayWithdrawn: { ar: 'مسحوب اليوم', en: 'Withdrawn today' },
  remainingToday: { ar: 'المتبقي من الحد اليومي', en: 'Remaining today' },
  settledTotal: { ar: 'إجمالي المُقيّد', en: 'Settled total' },
  pendingTotal: { ar: 'إجمالي المعلّق', en: 'Pending total' },
  avgVerifiedRate: { ar: 'متوسط السعر المؤكد', en: 'Average verified rate' },
  lastSettledRate: { ar: 'آخر سعر مُقيّد', en: 'Last settled rate' },
  samples: { ar: 'عينات', en: 'samples' },
  dataConfidence: { ar: 'موثوقية البيانات', en: 'Data confidence' },
  planner: { ar: 'مخطّط السحب', en: 'Withdrawal planner' },
  plannerPrompt: { ar: 'كم ريالًا تحتاج؟', en: 'How much SAR do you need?' },
  buildPlan: { ar: 'اقتراح خطة', en: 'Suggest a plan' },
  suggestedPlan: { ar: 'الخطة المقترحة', en: 'Suggested plan' },
  planShortfall: { ar: 'عجز غير مغطى', en: 'Uncovered shortfall' },
  planUnusable: { ar: 'بطاقات لا يمكن الاعتماد عليها', en: 'Cards that cannot be planned' },
  planDisclaimer: {
    ar: 'هذه خطة تقديرية، وقد تختلف التسوية النهائية من البنك أو الصراف.',
    en: 'This is a planning estimate. Final bank/ATM settlement may differ.',
  },
  estimatedCost: { ar: 'التكلفة التقديرية', en: 'Estimated cost' },
  basisVerified: { ar: 'مبني على سحوبات مُطابَقة', en: 'Based on reconciled withdrawals' },
  basisReference: { ar: 'مبني على سعر مرجعي فقط', en: 'Based on a reference rate only' },
  bindingConstraint: { ar: 'القيد الحاكم', en: 'Binding constraint' },
  withdrawalsNeeded: { ar: 'عدد عمليات السحب', en: 'Withdrawals needed' },
  comparison: { ar: 'مقارنة البطاقات', en: 'Card comparison' },
  bestVerifiedOption: { ar: 'الخيار الأفضل الموثّق', en: 'Best verified option' },
  insufficientData: { ar: 'لا تتوفر سحوبات مُسوّاة كافية لتوصية موثوقة', en: 'Insufficient settled transactions for reliable recommendation' },
  notComparableUsd: { ar: 'غير قابلة للمقارنة بالدينار (سجّل شحن البطاقة)', en: 'Not comparable in IQD (record funding)' },
  dccUsed: { ar: 'استخدام DCC', en: 'DCC used' },
  dayClose: { ar: 'إقفال اليوم', en: 'Daily close' },
  closeDay: { ar: 'إقفال هذا اليوم', en: 'Close this day' },
  dayClosed: { ar: 'اليوم مُقفل', en: 'Day closed' },
  dayCloseLocks: {
    ar: 'بعد الإقفال تُقفل قيود هذا اليوم، وأي تصحيح لاحق يُسجّل كقيد تصحيحي مُوثّق',
    en: 'Closing soft-locks the day; later fixes become audited correction records',
  },
  unsettled: { ar: 'غير مُسوّاة', en: 'Unsettled' },
  addExpense: { ar: 'تسجيل مصروف نقدي', en: 'Record cash expense' },
  expenseAmount: { ar: 'مبلغ المصروف', en: 'Expense amount' },
  category: { ar: 'الفئة', en: 'Category' },
  purpose: { ar: 'الغرض', en: 'Purpose' },
  sources: { ar: 'المصادر المالية', en: 'Financial sources' },
  feeRules: { ar: 'قواعد الرسوم', en: 'Fee rules' },
  ruleConfidenceNote: {
    ar: 'كل قاعدة تحمل مصدرها وتاريخها ودرجة ثقتها. لا توجد قاعدة مؤكدة ١٠٠٪ إلا ما أكدته أنت من البنك مباشرة.',
    en: 'Every rule carries its source, date and confidence. Nothing is VERIFIED unless you confirmed it with the bank.',
  },
  exports: { ar: 'التصدير والتقارير', en: 'Exports & reports' },
  exportWithdrawals: { ar: 'تصدير السحوبات (CSV)', en: 'Withdrawals (CSV)' },
  exportCompany: { ar: 'تقرير الشركة فقط', en: 'Company-only report' },
  exportPersonal: { ar: 'تقرير الشخصي فقط', en: 'Personal-only report' },
  exportReconciliation: { ar: 'تقرير المطابقة', en: 'Reconciliation report' },
  exportTreasury: { ar: 'حركة الخزينة النقدية', en: 'Cash treasury movements' },
  exportAudit: { ar: 'سجل التدقيق (مشرف)', en: 'Audit log (admin)' },
  addReferenceRate: { ar: 'إضافة سعر مرجعي', en: 'Add reference rate' },
  rateValue: { ar: 'قيمة السعر', en: 'Rate value' },
  rateType: { ar: 'نوع السعر', en: 'Rate type' },
  effectiveDate: { ar: 'تاريخ السريان', en: 'Effective date' },
  language: { ar: 'اللغة', en: 'Language' },
  arabic: { ar: 'العربية', en: 'Arabic' },
  english: { ar: 'الإنجليزية', en: 'English' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  error: { ar: 'حدث خطأ', en: 'Something went wrong' },
  retry: { ar: 'إعادة المحاولة', en: 'Retry' },
  noData: { ar: 'لا توجد بيانات بعد', en: 'No data yet' },
  amount: { ar: 'المبلغ', en: 'Amount' },
  date: { ar: 'التاريخ', en: 'Date' },
  time: { ar: 'الوقت', en: 'Time' },
  saudiTime: { ar: 'بتوقيت السعودية', en: 'Saudi time' },
  actions: { ar: 'إجراءات', en: 'Actions' },
  confirm: { ar: 'تأكيد', en: 'Confirm' },
  reason: { ar: 'السبب', en: 'Reason' },
  required: { ar: 'مطلوب', en: 'Required' },
  optional: { ar: 'اختياري', en: 'Optional' },
  offline: { ar: 'لا يوجد اتصال بالإنترنت', en: 'You are offline' },
  lastSync: { ar: 'آخر تحديث', en: 'Last updated' },
  failedAtm: { ar: 'فشل الصراف (خُصم ولم يُصرف نقد)', en: 'ATM failed (debited, no cash)' },
  partialDispense: { ar: 'صرف جزئي', en: 'Partial dispense' },
  cashNotDispensed: { ar: 'لم يُصرف نقد', en: 'No cash dispensed' },
  states: {
    ar: {
      DRAFT: 'مسودة', CAPTURED: 'مسجّلة', PENDING: 'معلّقة', POSTED: 'مُقيّدة',
      PARTIALLY_RECONCILED: 'مطابقة جزئيًا', RECONCILED: 'مُطابَقة', DISCREPANCY: 'فرق غير مفسّر',
      REVERSED: 'معكوسة', DISPUTED: 'متنازع عليها', FAILED_ATM: 'فشل الصراف', PARTIAL_DISPENSE: 'صرف جزئي',
    },
    en: {
      DRAFT: 'Draft', CAPTURED: 'Captured', PENDING: 'Pending', POSTED: 'Posted',
      PARTIALLY_RECONCILED: 'Partially reconciled', RECONCILED: 'Reconciled', DISCREPANCY: 'Discrepancy',
      REVERSED: 'Reversed', DISPUTED: 'Disputed', FAILED_ATM: 'ATM failed', PARTIAL_DISPENSE: 'Partial dispense',
    },
  },
  causes: {
    ar: {
      PENDING_HOLD: 'حجز معلّق', SEPARATE_ISSUER_FEE: 'رسوم بنكية منفصلة', ATM_SURCHARGE: 'رسوم الصراف',
      OTHER_TRANSACTION: 'عملية أخرى على البطاقة', DELAYED_BALANCE_REFRESH: 'تأخر تحديث الرصيد',
      DCC: 'تحويل عملة عند الصراف', REVERSAL: 'عكس عملية', ENTRY_ERROR: 'خطأ إدخال', UNKNOWN: 'غير معروف',
    },
    en: {
      PENDING_HOLD: 'Pending hold', SEPARATE_ISSUER_FEE: 'Separate issuer fee', ATM_SURCHARGE: 'ATM surcharge',
      OTHER_TRANSACTION: 'Another transaction', DELAYED_BALANCE_REFRESH: 'Delayed balance refresh',
      DCC: 'DCC', REVERSAL: 'Reversal', ENTRY_ERROR: 'Entry error', UNKNOWN: 'Unknown',
    },
  },
  provenances: {
    ar: {
      BANK_APP: 'تطبيق البنك', BANK_STATEMENT: 'كشف الحساب', ATM_RECEIPT: 'إيصال الصراف',
      OFFICIAL_TARIFF: 'تعرفة البنك المعلنة', USER_ENTRY: 'إدخال المستخدم',
      DERIVED_CALCULATION: 'حساب مشتق', REFERENCE_RATE: 'سعر مرجعي',
    },
    en: {
      BANK_APP: 'Bank app', BANK_STATEMENT: 'Bank statement', ATM_RECEIPT: 'ATM receipt',
      OFFICIAL_TARIFF: 'Published tariff', USER_ENTRY: 'User entry',
      DERIVED_CALCULATION: 'Derived calculation', REFERENCE_RATE: 'Reference rate',
    },
  },
  confidences: {
    ar: {
      ESTIMATED: 'تقديري', OBSERVED: 'ملاحظ', PENDING: 'معلّق', POSTED: 'مُقيّد',
      VERIFIED: 'مؤكد', RECONCILED: 'مُطابَق', HIGH: 'عالية', MEDIUM: 'متوسطة', LOW: 'منخفضة', NONE: 'لا يوجد',
      LIKELY: 'مرجّح', UNVERIFIED: 'غير مؤكد', UNKNOWN: 'غير معروف',
    },
    en: {
      ESTIMATED: 'Estimated', OBSERVED: 'Observed', PENDING: 'Pending', POSTED: 'Posted',
      VERIFIED: 'Verified', RECONCILED: 'Reconciled', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', NONE: 'None',
      LIKELY: 'Likely', UNVERIFIED: 'Unverified', UNKNOWN: 'Unknown',
    },
  },
  currencies: {
    ar: { IQD: 'دينار عراقي', USD: 'دولار', SAR: 'ريال سعودي' },
    en: { IQD: 'IQD', USD: 'USD', SAR: 'SAR' },
  },
} as const;

export type DictKey = keyof typeof dict;

let current: Locale = (typeof localStorage !== 'undefined' && (localStorage.getItem('tt_locale') as Locale)) || 'ar';

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  current = l;
  try {
    localStorage.setItem('tt_locale', l);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function t(key: DictKey): string {
  const entry = dict[key] as Record<string, unknown>;
  const v = entry[current];
  return typeof v === 'string' ? v : String(entry.ar);
}

export function tState(state: string): string {
  const m = dict.states[current] as Record<string, string>;
  return m[state] ?? state;
}
export function tCause(cause: string): string {
  const m = dict.causes[current] as Record<string, string>;
  return m[cause] ?? cause;
}
export function tProvenance(p: string): string {
  const m = dict.provenances[current] as Record<string, string>;
  return m[p] ?? p;
}
export function tConfidence(c: string): string {
  const m = dict.confidences[current] as Record<string, string>;
  return m[c] ?? c;
}
export function tCurrency(c: string): string {
  const m = dict.currencies[current] as Record<string, string>;
  return m[c] ?? c;
}

/**
 * Engine message codes → user language. The financial core emits codes with
 * English fallback text; this is where the traveller's language happens.
 */
const msgs: Record<string, { ar: string; en: string }> = {
  // Bases
  OBSERVED_DELTA: { ar: 'الرصيد قبل السحب ناقص الرصيد بعده — رقم ملاحظ وليس نهائيًا', en: 'Before balance minus after balance. Observed, not necessarily final.' },
  PENDING_TOTAL: { ar: 'الخصم المعلّق كما يظهر في تطبيق البنك — ليس نهائيًا', en: 'Pending debit as shown by the banking app. Not final.' },
  POSTED_DEBIT: { ar: 'الخصم النهائي المُقيّد من البنك', en: 'Final posted debit from the bank.' },
  ISSUER_FEES_SUM: { ar: 'مجموع الرسوم المُقيّدة بشكل منفصل', en: 'Sum of separately posted issuer fees.' },
  ISSUER_FEES_NONE: { ar: 'لم تُسجَّل رسوم منفصلة؛ قد تكون الرسوم ضمن مبلغ الخصم نفسه', en: 'No separately posted fee recorded; any fee may be inside the debit.' },
  SURCHARGE_INCLUDED: { ar: 'رسوم الصراف داخلة أصلًا في مبلغ الخصم', en: 'ATM surcharge already included in the debit.' },
  SURCHARGE_SEPARATE: { ar: 'رسوم الصراف مُقيّدة بشكل منفصل', en: 'ATM surcharge posted separately.' },
  SURCHARGE_UNKNOWN_HANDLING: { ar: 'رسوم الصراف كما ظهرت — لا يُعرف إن كانت داخل الخصم أم منفصلة', en: 'Surcharge as displayed; unknown whether inside the debit or separate.' },
  ALLIN_POSTED: { ar: 'الخصم النهائي + الرسوم المُقيّدة بشكل منفصل', en: 'Posted debit plus separately posted fees.' },
  ALLIN_OBSERVED: { ar: 'النقص الملاحظ في رصيد البطاقة — لم يُطابَق مع كشف الحساب بعد', en: 'Observed balance reduction; not yet confirmed against a statement.' },
  ALLIN_PENDING: { ar: 'المبلغ المعلّق فقط — المبلغ النهائي يختلف غالبًا', en: 'Pending amount only; the final amount frequently differs.' },
  RATE_FROM_ALLIN: { ar: 'التكلفة الإجمالية بعملة البطاقة ÷ النقد المستلم فعليًا', en: 'All-in cost divided by SAR actually dispensed.' },
  IQD_CARD_NATIVE_IS_IQD: { ar: 'البطاقة بالدينار؛ التكلفة بعملة البطاقة هي نفسها بالدينار', en: 'Card is in IQD; the native cost is the IQD cost.' },
  IQD_CARD_REAL_DINARS: { ar: 'البطاقة بالدينار؛ الدنانير الخارجة منها دنانير حقيقية', en: 'Card is in IQD; dinars leaving it are real dinars.' },
  REFERENCE_CONVERSION: { ar: 'تحويل مرجعي فقط — هذا ليس ما كلّفته هذه الأموال فعلًا بالدينار', en: 'Reference conversion only — NOT the real dinar cost of these funds.' },
  ECONOMIC_FROM_FUNDING: { ar: 'محسوبة على سعر شراء العملة الفعلي من سجلات شحن البطاقة', en: 'Converted at the rate the funds were actually acquired at (funding records).' },
  VERIFIED_RATE_FROM_ECONOMIC: { ar: 'التكلفة الحقيقية بالدينار ÷ النقد المستلم فعليًا', en: 'Economic IQD cost divided by SAR actually dispensed.' },
  EXPECTED_FROM_COST: { ar: 'الرصيد قبل السحب ناقص التكلفة الإجمالية', en: 'Before balance minus the all-in cost.' },
  OBSERVED_BALANCE: { ar: 'الرصيد كما شوهد من مصدره', en: 'Balance as observed from its source.' },
  DIFFERENCE_CONFIRMED_MINUS_EXPECTED: { ar: 'الرصيد المؤكد من البنك ناقص الرصيد المتوقع', en: 'Confirmed bank balance minus expected balance.' },
  LEDGER_FROM_OPENING: { ar: 'الرصيد الافتتاحي + الشحن − تكلفة كل السحوبات المسجلة', en: 'Opening balance plus funding minus all recorded withdrawal costs.' },
  LAST_CONFIRMED: { ar: 'آخر رصيد مؤكد من البنك', en: 'Last confirmed bank balance.' },
  // Unknowns
  NEED_BOTH_BALANCES: { ar: 'يلزم رصيد قبل السحب ورصيد بعده لملاحظة الفرق', en: 'Both a before and an after balance are needed.' },
  NO_PENDING_RECORDED: { ar: 'لم يُسجَّل خصم معلّق بعد', en: 'No pending transaction recorded yet.' },
  NO_POSTED_RECORDED: { ar: 'لم تُسجَّل التسوية النهائية من البنك بعد', en: 'The final posted transaction has not been recorded yet.' },
  FEES_NEED_POSTING: { ar: 'رسوم البنك تُعرف فقط بعد التسوية النهائية', en: 'Issuer fees are only known once the transaction posts.' },
  NO_SURCHARGE_RECORDED: { ar: 'لم تُسجَّل رسوم من جهاز الصراف', en: 'No ATM operator surcharge recorded.' },
  COST_NOT_DETERMINABLE: { ar: 'تكلفة هذا السحب بعملة البطاقة غير معروفة بعد', en: 'The cost in the card currency is not determinable yet.' },
  RATE_NEEDS_COST: { ar: 'لا يمكن تحديد سعر صرف مؤكد بعد — التكلفة غير معروفة', en: 'Cannot determine a verified rate yet: the cost is unknown.' },
  NO_CASH_DISPENSED: { ar: 'لم يُصرف نقد، فلا يوجد سعر صرف لهذه العملية — القسمة على صفر ليست سعرًا', en: 'No cash was dispensed, so there is no exchange rate.' },
  NO_REFERENCE_RATE: { ar: 'لا يوجد سعر مرجعي مسجّل لهذه العملة مقابل الدينار', en: 'No reference rate on file for this currency to IQD.' },
  NEED_FUNDING_BASIS: { ar: 'لا توجد أدلة كافية: التكلفة الحقيقية بالدينار تعتمد على سعر شراء عملة البطاقة — سجّل عملية شحن', en: 'Not enough evidence: the real dinar cost depends on the funding rate.' },
  RECON_NEEDS_BALANCES: { ar: 'المطابقة تحتاج رصيدًا قبل السحب ورصيدًا بعده', en: 'Reconciliation needs both balances.' },
  RECON_NEEDS_COST: { ar: 'لا يمكن حساب الرصيد المتوقع قبل معرفة تكلفة السحب', en: 'Cannot form an expected balance until the cost is determinable.' },
  LEDGER_HAS_UNKNOWN_COSTS: { ar: 'توجد سحوبات لم تُعرف تكلفتها بعد، فالرصيد المتوقع سيكون خاطئًا بمقدار مجهول', en: 'Some withdrawals have no determinable cost yet.' },
  NO_CONFIRMED_BALANCE: { ar: 'لم يُسجَّل أي رصيد مؤكد من البنك لهذه البطاقة', en: 'No bank balance has been confirmed for this card yet.' },
  DIFF_NEEDS_BOTH: { ar: 'الفرق يحتاج رصيدًا متوقعًا ورصيدًا مؤكدًا معًا', en: 'The difference needs both an expected and a confirmed balance.' },
  // Warnings
  W_AVAILABLE_NOT_FINAL: { ar: 'الرصيد بعد السحب هو رصيد «متاح»: قد يتضمن حجزًا مؤقتًا وقد لا يكون نهائيًا', en: 'The after balance is an AVAILABLE reading and may not be final.' },
  W_BALANCE_INCREASED: { ar: 'الرصيد زاد بدل أن ينقص — راجع القراءات أو ابحث عن إيداع آخر', en: 'Balance increased across this withdrawal — check the readings.' },
  W_SURCHARGE_HANDLING_UNKNOWN: { ar: 'سُجّلت رسوم صراف لكن لا يُعرف إن كانت داخل الخصم أم منفصلة، فلم تُضف إلى التكلفة', en: 'Surcharge recorded but its handling is unknown; not added to the cost.' },
  W_SURCHARGE_CURRENCY_UNCONVERTED: { ar: 'رسوم الصراف بعملة مختلفة ولم تُحوَّل — التحويل يحتاج سعرًا غير مؤكد', en: 'Surcharge in a different currency was not converted.' },
  W_DCC_ACCEPTED: { ar: 'قُبل تحويل العملة عند الصراف (DCC): الصراف هو من حدد سعر الصرف وغالبًا يكون أغلى', en: 'DCC was accepted: the ATM set the rate, typically costlier.' },
  W_DCC_UNKNOWN: { ar: 'لم يُسجَّل هل عرض الصراف تحويل العملة أم لا', en: 'Whether the ATM offered DCC is not recorded.' },
  W_PARTIAL_DISPENSE: { ar: 'المبلغ المطلوب يختلف عن المستلم — كل الحسابات تستخدم النقد المستلم فعليًا', en: 'Requested and dispensed differ; figures use cash actually dispensed.' },
  W_NO_CASH: { ar: 'لم يُصرف نقد — هذه العملية لا تضيف شيئًا إلى الخزينة النقدية', en: 'No cash was dispensed; nothing enters the cash treasury.' },
  W_CARD_RESTRICTED: { ar: 'هذه البطاقة مسجلة كمقيّدة للاستخدام خارج العراق بقرار تنظيمي', en: 'This card is recorded as restricted for international use.' },
  W_POSTED_VS_OBSERVED: { ar: 'التكلفة النهائية تختلف عن التغير الملاحظ في الرصيد — كلاهما محفوظ، راجع المطابقة', en: 'Posted cost differs from the observed change; both preserved.' },
  // Explanations
  E_RECONCILED_POSTED: { ar: 'الرصيد المؤكد من البنك يطابق الرصيد المتوقع باستخدام التكلفة النهائية المُقيّدة ✓', en: 'Confirmed balance matches expected using the final posted cost.' },
  E_RECONCILED_NOT_POSTED: { ar: 'الأرصدة متطابقة، لكن التكلفة ليست نهائية بعد، فالمطابقة جزئية فقط', en: 'Balances agree but the cost is not final yet; partially reconciled.' },
  E_DIFFERENCE_NEEDS_PERSON: { ar: 'يوجد فرق غير مفسّر. يجب أن يصنّفه شخص — لا يُحل تلقائيًا أبدًا', en: 'An unexplained difference exists and must be classified by a person.' },
  E_NOT_ENOUGH_TO_RECONCILE: { ar: 'لا توجد أدلة كافية لمطابقة هذا السحب بعد', en: 'Not enough evidence to reconcile yet.' },
  E_CANNOT_EXPECT_BALANCE: { ar: 'لا يمكن تحديد رصيد متوقع مؤكد بعد', en: 'Cannot determine a verified expected balance yet.' },
  // Missing-evidence items
  EV_BEFORE_BALANCE: { ar: 'الرصيد قبل السحب', en: 'Before balance' },
  EV_AFTER_BALANCE: { ar: 'الرصيد بعد السحب', en: 'After balance' },
  EV_PENDING_DEBIT: { ar: 'الخصم المعلّق من تطبيق البنك', en: 'Pending debit from the bank app' },
  EV_POSTED_DEBIT: { ar: 'الخصم النهائي من كشف الحساب', en: 'Posted debit from the statement' },
  EV_POSTED_FEES: { ar: 'سطور الرسوم من كشف الحساب', en: 'Posted fee lines from the statement' },
  EV_ATM_SURCHARGE: { ar: 'رسوم الصراف من الشاشة أو الإيصال', en: 'ATM surcharge from screen or receipt' },
  EV_CASH_DISPENSED: { ar: 'نقد مستلم فعليًا (حاليًا صفر)', en: 'Cash actually dispensed (currently zero)' },
  EV_REFERENCE_RATE: { ar: 'سعر مرجعي مسجّل بمصدره وتاريخه', en: 'A reference rate with source and date' },
  EV_FUNDING_RECORD: { ar: 'سجل شحن للبطاقة يبيّن الدينار المدفوع فعلًا', en: 'A funding record showing IQD actually paid' },
  EV_SETTLEMENT_DETAILS: { ar: 'تفاصيل تسوية السحوبات التي لم تُقيّد بعد', en: 'Settlement details for unposted withdrawals' },
  EV_OPENING_BALANCE: { ar: 'الرصيد الافتتاحي', en: 'Opening balance' },
  EV_BALANCE_READING: { ar: 'قراءة رصيد من تطبيق البنك أو كشف الحساب', en: 'A balance reading from the bank app or statement' },
  EV_ANY_COST_EVIDENCE: { ar: 'رصيد قبل/بعد، أو الخصم المعلّق، أو الخصم النهائي', en: 'Before/after balances, or the pending debit, or the posted debit' },
};

/** Rationale text for each discrepancy cause, translated. */
const causeRationales: Record<string, { ar: string; en: string }> = {
  PENDING_HOLD: { ar: 'التكلفة المستخدمة ليست الرقم النهائي؛ الحجز المؤقت يختلف عادة عن مبلغ التسوية', en: 'The cost used is not final; a hold commonly differs from settlement.' },
  SEPARATE_ISSUER_FEE: { ar: 'البطاقة خسرت أكثر من المتوقع — وهذا نمط رسوم بنكية قُيّدت بشكل منفصل', en: 'The card lost more than expected — the signature of a separately posted fee.' },
  ATM_SURCHARGE: { ar: 'سُجّلت رسوم صراف وقد تكون خُصمت إضافة إلى مبلغ السحب', en: 'A surcharge was recorded and may have been charged in addition.' },
  OTHER_TRANSACTION: { ar: 'ربما حدثت عملية أخرى على البطاقة بين قراءتي الرصيد', en: 'Another transaction may have occurred between the two readings.' },
  DELAYED_BALANCE_REFRESH: { ar: 'الرصيد بعد السحب رصيد «متاح» وقد لا يكون البنك حدّثه بعد', en: 'The after balance is AVAILABLE and may not be refreshed yet.' },
  DCC: { ar: 'قُبل تحويل العملة عند الصراف فحدد الصراف السعر وقد تزيد التكلفة', en: 'DCC was accepted, so the ATM set the rate.' },
  REVERSAL: { ar: 'البطاقة تحتفظ بأكثر من المتوقع — يتفق ذلك مع عكس خصم أو تحرير حجز', en: 'The card holds more than expected, consistent with a reversal.' },
  ENTRY_ERROR: { ar: 'قد يكون أحد الأرقام المُدخلة كُتب خطأً', en: 'One of the recorded figures may be mistyped.' },
  UNKNOWN: { ar: 'سبب غير معروف بعد', en: 'Cause not yet known.' },
};

export function tMsg(code: string | null | undefined, fallback?: string): string | null {
  if (!code) return fallback ?? null;
  const entry = msgs[code];
  if (!entry) return fallback ?? code;
  return entry[current];
}

export function tCauseRationale(cause: string, fallback: string): string {
  const entry = causeRationales[cause];
  return entry ? entry[current] : fallback;
}

/**
 * Server errors carry both languages: `error` in English and `errorAr` in
 * Arabic. Show the one matching the current locale, falling back to whichever
 * exists so a message is never swallowed.
 */
export function errText(e: unknown): string {
  const err = e as { message?: string; errorAr?: string | null } | null;
  if (current === 'ar' && err?.errorAr) return err.errorAr;
  return err?.message ?? String(e);
}
