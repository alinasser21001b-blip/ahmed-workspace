# متابعة الوكالة

منصة داخلية صغيرة لمتابعة مهام فريق الوكالة: محمد وعمار وسما وحسين، والعميلان «عيادة بغداد للسمنة» و«مستشفى ورد».

تغطي المنصة:
- دخولاً حقيقياً بحساب لكل عضو.
- صلاحيات محسوبة على الخادم.
- دورة مهمة كاملة: إنشاء، إسناد، استلام، تنفيذ، تسليم، مراجعة، إكمال.
- عوائق وتوضيحات ومواعيد مقترحة.
- تقويم حجوزات حسين مع منع التعارض.
- تنبيهات وتصعيداً حسب ساعات العمل، وإشعارات أجهزة (Web Push)، وتطبيقاً قابلاً للتثبيت (PWA).

دليل التجربة للفريق: [docs/TRIAL_GUIDE.md](docs/TRIAL_GUIDE.md).

> لا توجد في هذا المستودع أي كلمة مرور أو مفتاح سري أو رابط دخول. المستودع **عام**؛ لا تضف إليه أسراراً أو بيانات مرضى. جعله خاصاً قرار لصاحب المشروع (انظر «حدود معروفة»).

## البنية

| الجزء | التقنية |
|---|---|
| الواجهة | React 19 + TypeScript + Vite، عربية RTL، خط IBM Plex Sans Arabic محلي |
| الخادم | Cloudflare Worker + Hono، على نفس النطاق مع الملفات الثابتة (`assets`، وسقوط SPA) |
| البيانات | D1. قاعدة الإنتاج `agency-followup-db`، وقاعدة الاختبار `agency-followup-staging-db` |
| الدخول | Better Auth مع إضافة اسم المستخدم، دون تسجيل عام. كلمات المرور PBKDF2-SHA256 بمئة ألف تكرار (Web Crypto) |
| التنبيهات | Cron كل دقيقة (`worker/scheduler.ts`)، وجدول `notifications`، و`outbox` مع إعادة المحاولة. الإرسال عبر `@block65/webcrypto-web-push` (VAPID) |
| PWA | `public/sw.js`: يخزّن الهيكل الثابت فقط ولا يخزّن ردود `/api` أبداً |

الملفات الأهم:
- `worker/policy.ts`: كل قرارات الصلاحية، مثل `canViewTask` و`canAssignTo` و`canReviewTask`، ونسختها الـSQL `taskVisibilitySql`.
- `worker/routes/tasks.ts`: دورة المهمة. كل كتابة متعددة الخطوات تمر بدفعة D1 واحدة محمية برقم النسخة (`op_guard`).
- `worker/routes/bookings.ts`: الحجز الذري، مع اقتراح أقرب وقت متاح، وعرض «مشغول» فقط لمن لا يملك التفاصيل.
- `worker/scheduler.ts`: التذكير والتصعيد بدقائق العمل وبمفاتيح منع التكرار، وملخص بداية اليوم، وتفريغ الـoutbox.
- `migrations/0001_init.sql`: المخطط والبيانات الأولية، أي الأعضاء الأربعة والعميلان والإعدادات الافتراضية.

## التشغيل محلياً

```bash
cd agency-followup
npm ci
npx wrangler d1 migrations apply agency-followup-db --local
```

ثم أنشئ ملف `.dev.vars`. هذا الملف خارج Git، ويحتوي ثلاث قيم: `BETTER_AUTH_SECRET` و`VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY`. لتوليد مفتاحَي VAPID:

```bash
node scripts/gen-vapid.mjs public
node scripts/gen-vapid.mjs private
```

بعدها شغّل الخادم المحلي:

```bash
npx vite
```

يعمل على http://localhost:5173. لإنشاء روابط دخول محلية:

```bash
node scripts/setup-links.mjs --origin http://localhost:5173 --sql /tmp/s.sql --links /tmp/links.txt
npx wrangler d1 execute agency-followup-db --local --file /tmp/s.sql
```

## الاختبارات

```bash
npx vitest run     # اختبارات داخل بيئة Workers: الصلاحيات والدورة والمجدول والحجوزات والدخول وPush، ومعها اختبارات انحدار لملاحظات المراجعة الأمنية
BASE_URL=http://localhost:5173 LINKS=/tmp/links.txt node e2e/run.mjs   # سيناريو التجربة في متصفح حقيقي، على الهاتف والحاسوب
BASE_URL=https://... node e2e/smoke.mjs                               # فحوص النسخة المنشورة دون حسابات
```

## حالة الاختبارات

**الأحد 25 أكتوبر 2026. تُحدَّث بعد النشر.**

مصادر الدليل:
- **vitest**: `npx vitest run` داخل بيئة Workers، شُغّل اليوم محلياً: 144 من 144 في 12 ملفاً. الأسماء أدناه أسماء الاختبارات كما هي.
- **متصفح محلي**: `e2e/run.mjs` (32 من 32) و`e2e/smoke.mjs` (14 من 14) على نسخة إنتاج مبنية محلياً في Chromium، شُغّلا اليوم بعد إصلاحات اليوم.
- لم يُشغَّل أي اختبار بعد على رابط Cloudflare المنشور، ولا على هاتف حقيقي. النشر ينتظر سرَّي GitHub (انظر «النشر»).

| البند (§14) | الحالة | الدليل |
|---|---|---|
| 1. محمد يسند لكل عضو، وتظهر المهمة في حساب العضو | نجح | vitest: `permissions.test.ts` «§14.1 assigns Ammar, Sama, Hussein and himself; outside-team assignment grants that one task only». في المتصفح يُختبر إسناد سما لحسين فقط، لا إسناد محمد. |
| 2. عمار يسند لسما ولحسين ضمن نطاقه | نجح | vitest: `permissions.test.ts` «§14.2 Sama on the clinic, Hussein on both clients; never Mohammed; never Sama on Ward» |
| 3. سما تسند لحسين مهمة للعيادة | نجح | vitest: `permissions.test.ts` «§14.3 Hussein and herself on the clinic; not Ammar or Mohammed; no Ward tasks». متصفح محلي: «sama: creates a shoot request for hussein» |
| 4. سما تُمنع من مهام مستشفى ورد بالرابط أو الـpayload | نجح | vitest: `permissions.test.ts` «§14.4 by URL, edit, actions, comments, subtask parent and payload». متصفح محلي: «sama: Ward task URL shows not-available» |
| 5. حسين يُمنع من القراءة والإسناد والاعتماد وتعديل الموعد | نجح | vitest: `permissions.test.ts` «§14.5 404 on others' tasks; cannot create, assign, approve own work, or change due date, priority or owner; no admin». متصفح محلي: «hussein: has no approve button on his own work» |
| 6. عمار يُمنع من تغيير دور محمد وإعدادات الأمن | نجح | vitest: `permissions.test.ts` «§14.6 admin endpoints refuse him; no endpoint changes a role». متصفح محلي: «ammar: no admin page» |
| 7. البحث والعدادات والإشعارات والتصدير لا تسرّب | نجح | vitest: `permissions.test.ts` «§14.7 Sama never sees a Ward title; Hussein never sees work he is not part of» |
| 8. سما ترى «مشغول» فقط لحجز خارج نطاقها | نجح | vitest: `bookings.test.ts` «§14.8 Ward bookings reach Sama as «مشغول» with no title, client or task — in the calendar, the check and a refused booking». متصفح محلي: «sama: calendar shows other client's slot as «مشغول» only» |
| 9. حجزان متزامنان متعارضان لا يُعتمدان معاً | نجح | vitest: `bookings.test.ts` «§14.9 five simultaneous overlapping requests → exactly one booking». متصفح محلي: «booking form warns about a conflict and offers the nearest free time» |
| 10. الاستلام يسجّل الوقت ويوقف تذكيراته | نجح | vitest: `scheduler.test.ts` «§14.10 pending deliveries are cancelled and no later stage fires». متصفح محلي: «hussein: «استلمت» records acknowledgement» |
| 11. التصعيد الصحيح مرة واحدة لكل مرحلة | نجح | vitest: `scheduler.test.ts` «§14.11 Hussein on the clinic: reminder at 60, then Sama 120, Ammar 240, Mohammed 480 — each once however often the cron runs». بساعة محقونة، لا بالـCron المنشور (انظر صف الـCron). |
| 12. تغيير المسؤول أو الموعد يلغي التذكيرات القديمة ويحفظ الأثر | نجح | vitest: `scheduler.test.ts` «§14.12 reassignment starts a new cycle; the old assignee's pending reminders are cancelled» و`lifecycle.test.ts` «§14.12 a direct due-date or owner change needs a reason and is recorded» |
| 13. العائق يُشعر صاحب الحل، والانتظار لا يُحتسب على حسين | نجح | vitest: `scheduler.test.ts` «§14.13 waiting on the client: the resolver hears at once and is followed up; the photographer is not chased» و`waiting.test.ts` «§14.13 a client wait across the deadline: nothing on resolve, then one overdue and one escalation when his own time runs out» (أُضيف اليوم) |
| 14. التسليم يصل للمراجع، وطلب التعديل يرجع، والاعتماد يقفل | نجح | vitest: `lifecycle.test.ts` «§14.14 submission needs a link or written evidence; reviewer approves or asks for changes». متصفح محلي: «hussein: submits with evidence → بانتظار المراجعة» و«sama: approves → مكتملة» |
| 15. البيانات تبقى بعد التحديث والخروج وجهاز آخر | نجح | vitest: `lifecycle.test.ts` «§14.15 a second device sees the same data; logging out one device ends only that session». متصفح محلي: «task link survives a page refresh» و«data persists after sign-out and on another device» |
| 16. فشل الشبكة لا يظهر نجاح حفظ | نجح | vitest: `lifecycle.test.ts` «§14.16 a stale version is refused with 409 and a message, nothing changes». متصفح محلي: «offline write shows a failure, never a success» |
| 17. الجلسات والخروج وتغيير كلمة المرور؛ وتغيير الدور مرفوض | نجح | vitest: `auth.test.ts` «§14.17 sign-out ends the session; a copied cookie no longer works» و«§14.17 changing the password signs out every other device and the old password stops working»، والدور في صف 6. متصفح محلي: «wrong password shows a generic error» |
| 18أ. اشتراك Push يتبع الحساب، والإرسال المشفّر | نجح | vitest، بخدمة Push محاكاة داخل الاختبار: `push.test.ts` «§14.18 the outbox sends an encrypted, VAPID-signed push with a terse lock-screen text and the task link» و«§14.18 signing out stops that device receiving the account's notifications» |
| 18ب. Push يصل فعلياً إلى متصفح مدعوم (Google Chrome) | لم يُختبر بعد — ينتظر النشر | `e2e/push.mjs` يعمل في CI على staging. لم يُشغَّل بعد. |
| 18ج. Push على آيفون وأندرويد حقيقيين | فحص يدوي مطلوب | لم يُجرَّب على أي هاتف حقيقي. الخطوات في «فحص يدوي مطلوب اليوم» أدناه. |
| 19. رابط إشعار أو مهمة محجوبة لا يتجاوز الصلاحيات | نجح | vitest: `push.test.ts` «§14.19 opening a pushed link re-checks permission: the old assignee cannot open a reassigned task» و`lifecycle.test.ts` «§14.19 after reassignment the old assignee's link is a 404 and the new assignee must acknowledge again» |
| 20. التنقل المباشر على رابط Cloudflare المنشور، وAPI مجهول يرجع JSON | لم يُختبر بعد — ينتظر النشر | محلياً نجح: `auth.test.ts` «§14.20 unknown routes are JSON: 401 without a session, 404 with one»، و`e2e/smoke.mjs` «deep link returns the app (SPA fallback)» و«unknown /api route returns JSON, not HTML». على الرابط المنشور يعمل `e2e/smoke.mjs` في CI. |
| فحص الأنواع والبناء | نجح | `tsc` للمشاريع الثلاثة و`npx vite build`، شُغّلت اليوم محلياً. |
| الهاتف والحاسوب مع نص عربي طويل | نجح محلياً | متصفح محلي على عرض الهاتف (iPhone 13 في Chromium) والحاسوب (1280px): «long Arabic text: no sideways scroll on the phone/desktop (Today and task page)»، بعنوان من 140 حرفاً فيه رابط طويل دون مسافات ووصف طويل. على هاتف حقيقي ضمن الفحص اليدوي. |
| تجربة المتصفح الكاملة على staging | لم يُختبر بعد — ينتظر النشر | `e2e/run.mjs` و`e2e/push.mjs` في CI. |
| الـCron منشور ويعمل دون أخطاء | لم يُختبر بعد — ينتظر النشر | خطوة «The cron is actually running» في CI: تشغيلان ناجحان على الأقل، ولا تشغيل انتهى بخطأ منذ النشر. |
| دخول الأعضاء الأربعة على رابط الإنتاج | لم يُختبر بعد — ينتظر النشر | روابط الإعداد جاهزة وتُسلَّم بشكل خاص (انظر «الحسابات وروابط الدخول»). |

لا يوجد بند «فشل» في آخر تشغيل.

### فحص يدوي مطلوب اليوم

**لم تُختبر إشعارات الجهاز (Web Push) على آيفون أو أندرويد حقيقي.** الاختبار الآلي الحقيقي يعمل في Google Chrome على الحاسوب فقط، وتجربة الآيفون في المتصفح المحلي محاكاة لحجم الشاشة لا أكثر. على هاتف واحد على الأقل من كل نوع موجود في الفريق:

1. **آيفون (iOS 16.4 أو أحدث):** افتح الرابط في Safari ← المشاركة ← «إضافة إلى الشاشة الرئيسية» ← افتح التطبيق من الأيقونة وسجّل الدخول. **أندرويد:** Chrome ← ⋮ ← «تثبيت التطبيق».
2. من صفحة الحساب: «فعّل إشعارات جهازي» ← «سماح» ← «أرسل إشعار اختبار لي». يجب أن يصل الإشعار خلال دقيقة.
3. أغلق التطبيق تماماً. اطلب من زميل أن يسند لك مهمة، أو اترك مهمة دون استلام ساعة عمل. تأكد أن **إشعاراً حقيقياً** من المنصة يصل والتطبيق مغلق، وليس إشعار الاختبار فقط.
4. اضغط الإشعار: يجب أن يفتح المهمة الصحيحة نفسها.
5. سجّل النتيجة ونوع الهاتف وإصدار النظام، وحدّث الصف 18ج أعلاه.

**داخل التطبيق** تظهر التنبيهات دائماً في مركز التنبيهات وشاشة اليوم. **والتطبيق مغلق** لا يصل إلا إشعار الجهاز، وفقط بعد تثبيت التطبيق (على الآيفون) والسماح بالإشعارات. مركز التنبيهات ليس بديلاً عن إشعار الجهاز.

## النشر

النشر يتم من GitHub Actions عبر `.github/workflows/agency-followup.yml`، عند الدفع إلى الفرع أو بالتشغيل اليدوي. ترتيب المراحل:

1. اختبارات النوع، ثم اختبارات Workers، ثم البناء.
2. نشر نسخة **staging**، ثم تجربة كاملة عليها في متصفح حقيقي، بما فيها Web Push حقيقي في Google Chrome.
3. نشر **الإنتاج**، ثم فحوص دون حسابات، ثم التحقق من أن الـCron يعمل فعلاً: تشغيلان ناجحان على الأقل منذ النشر، ولا تشغيل انتهى بخطأ. عند الفشل تُطبع آخر ثلاثة تشغيلات فاشلة مع بداية الخطأ.

المطلوب مرة واحدة:
- في GitHub، من Settings ثم Secrets and variables ثم Actions:
  - `CLOUDFLARE_API_TOKEN`: توكن بصلاحيتي Workers Scripts: Edit وD1: Edit، على هذا الحساب فقط.
  - `CLOUDFLARE_ACCOUNT_ID`: معرّف الحساب.
- بعد أول نشر للإنتاج: **رابط دخول محمد**. الخطوة في «أول تشغيل» تحت «الحسابات وروابط الدخول». للنشر الحالي الروابط الأربعة جاهزة وتُسلَّم بشكل خاص، فلا حاجة لها.

مفاتيح التطبيق تُولَّد عند أول نشر عبر `scripts/ensure-secrets.mjs` دون أن تُطبع. مكانها Worker secrets: `BETTER_AUTH_SECRET` و`VAPID_*`.

النشر يدوياً من جهاز عليه `wrangler login`:

```bash
npx wrangler d1 migrations apply agency-followup-db --remote
npx vite build && npx wrangler deploy
node scripts/ensure-secrets.mjs agency-followup
```

## الحسابات وروابط الدخول

لا يوجد تسجيل عام، ولا مسار تهيئة مفتوح. الأعضاء الأربعة موجودون في الـmigration دون كلمات مرور. يدخل كل عضو أول مرة عبر **رابط إعداد** يستخدم مرة واحدة ويصلح 72 ساعة، ويختار كلمة مروره بنفسه. يُخزَّن في القاعدة هاش الرابط فقط (SHA-256)، ويأتي الرمز بعد `#` فلا يصل إلى سجلات الخادم.

الروابط لا تدخل Git ولا سجلات CI أبداً. سير النشر لا ينشئ روابط للإنتاج عمداً، لأن سجلاته عامة.

**النشر الحالي:** روابط الأعضاء الأربعة جُهّزت، وهاشاتها في قاعدة الإنتاج، وتُسلَّم لأصحابها بشكل خاص. لا تُعِد «أول تشغيل» عليه إلا إذا ضاع رابط محمد أو انتهت مدته، لأن الخطوة تلغي رابطه السابق غير المستخدم.

### أول تشغيل (إلزامي، مرة واحدة بعد أول نشر للإنتاج)

في نشر جديد لا يستطيع أحد الدخول قبل هذه الخطوة: الأعضاء بلا كلمات مرور، ومحمد لا يستطيع إنشاء رابط لنفسه من صفحة الإدارة.

1. ينشئ صاحب النشر أو من يتولى التشغيل رابط محمد. يكفي Node، ولا حاجة لـ`wrangler` هنا. اكتب الملفين خارج مجلد المستودع حتى لا يدخلا Git. رابط الإنتاج في ملخص تشغيل GitHub Actions.

   ```bash
   node scripts/setup-links.mjs --origin https://<رابط الإنتاج> --users mohammed --sql /tmp/s.sql --links /tmp/links.txt
   ```

2. طبّق `/tmp/s.sql` على قاعدة الإنتاج بإحدى طريقتين:
   - من جهاز عليه `wrangler login`:

     ```bash
     npx wrangler d1 execute agency-followup-db --remote --file /tmp/s.sql
     ```

   - أو من لوحة Cloudflare: D1 ← `agency-followup-db` ← Console، ثم ألصق محتوى الملف ونفّذه.
3. سلّم الرابط من `/tmp/links.txt` لمحمد وحده، برسالة خاصة، ثم احذف الملفين. الرابط يصلح 72 ساعة.
4. يدخل محمد من رابطه ويختار كلمة مروره، ثم ينشئ روابط عمار وسما وحسين من صفحة **الإدارة**، ويسلّم كل رابط لصاحبه.

### بعد ذلك

- محمد ينشئ رابطاً جديداً لأي عضو من صفحة **الإدارة**. هذا الإجراء يوقف كلمة المرور القديمة، ويُخرج العضو من كل أجهزته، ويُسجَّل.
- إذا احتاج محمد نفسه رابطاً جديداً، فتُعاد خطوات «أول تشغيل» نفسها.

## النسخ الاحتياطي والاستعادة

- نسخة كاملة بصيغة JSON، أو المهام بصيغة CSV: من صفحة الإدارة، أو من `/api/admin/export` (لمحمد فقط).
- تصدير القاعدة كاملة:

```bash
npx wrangler d1 export agency-followup-db --remote --output backup.sql
```

- الاسترجاع الزمني (Time Travel) في D1، للعودة إلى أي دقيقة خلال آخر 7 أيام على الخطة المجانية، أو 30 يوماً على المدفوعة:

```bash
npx wrangler d1 time-travel info agency-followup-db
npx wrangler d1 time-travel restore agency-followup-db --timestamp <ISO>
```

## التراجع عن نشر

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

التراجع يعيد الكود فقط ولا يمس البيانات. أي تغيير في المخطط يأتي كـmigration جديدة، ولا يُعدَّل `0001` بعد تطبيقه.

## حدود معروفة

- **حد المعالج على الخطة المجانية.** تجزئة كلمة المرور تستغرق نحو 16 ملّي ثانية من المعالج عند الدخول وتغيير كلمة المرور. خطة Workers المجانية تسمح بـ10 ملّي ثانية فقط لكل طلب. إذا ظهر الخطأ 1102 عند الدخول فالحل خطة Workers Paid، وليس تخفيض التكرارات دون قرار. عدد التكرارات محفوظ داخل كل هاش ويمكن تغييره من `PBKDF2_ITERATIONS`.
- **إشعارات الأجهزة غير مضمونة التوقيت.** الوصول يعتمد على خدمة Push في المتصفح، ولا يمكن ضمان الصوت أو تجاوز وضع عدم الإزعاج. على الآيفون تعمل الإشعارات فقط بعد إضافة التطبيق للشاشة الرئيسية، على iOS 16.4 أو أحدث.
- **Web Push لم يُختبر على آيفون أو أندرويد حقيقي.** الاختبار الآلي الحقيقي في Google Chrome على الحاسوب فقط. فحص الهواتف يدوي ومطلوب في يوم التجربة: انظر «فحص يدوي مطلوب اليوم».
- **سلسلة تصعيد أقصر لمهمة مكلّفة استثنائياً غير موجودة في هذه النسخة.** صاحب الطلب يبقى متابعاً للمهمة، لكن التصعيد يمر دائماً بالسلسلة الافتراضية للعميل.
- **المستودع عام، فسجلات GitHub Actions عامة.** يرى أي شخص سجلات التشغيل وملخصاتها، ومنها رابط `workers.dev` للإنتاج وstaging. روابط الإعداد وكلمات المرور لا تُطبع فيها أبداً، والتطبيق نفسه محمي بتسجيل الدخول. جعل المستودع خاصاً، أو نقل المشروع إلى مستودع خاص به، قرار لصاحب المشروع. إن نُقل فالأسرار تُضاف في المستودع الجديد.
- **التذكير والتصعيد داخل ساعات العمل فقط.** الساعات الافتراضية من الأحد إلى الخميس، 09:00–18:00 بتوقيت بغداد، وهي افتراض قابل للتعديل من الإدارة. استثناء العاجل مطفأ افتراضياً.
- **التسليم الواحد مؤكد، والإشعار قد يتكرر.** الإرسال يتم مرة واحدة على الأقل، وفي حالة نادرة قد يصل إشعار مكرر. سجل التنبيهات داخل التطبيق لا يتكرر.
- **خارج نطاق هذه النسخة.** المحاسبة، والذكاء الاصطناعي، والمحادثة العامة، ودخول العملاء، ورفع الفيديو، والتكامل مع واتساب وتلغرام والبريد.
