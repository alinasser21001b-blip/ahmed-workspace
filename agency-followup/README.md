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

> لا توجد في هذا المستودع أي كلمة مرور أو مفتاح سري. المستودع **عام**؛ لا تضف إليه أسراراً أو بيانات مرضى.

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
- `worker/scheduler.ts`: التذكير والتصعيد بدقائق العمل وبمفاتيح منع التكرار، وتفريغ الـoutbox.
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
npx vitest run     # 84 اختباراً داخل بيئة Workers (الصلاحيات، الدورة، المجدول، الحجوزات، الدخول، Push)
BASE_URL=http://localhost:5173 LINKS=/tmp/links.txt node e2e/run.mjs   # سيناريو التجربة في متصفح حقيقي
BASE_URL=https://... node e2e/smoke.mjs                               # فحوص النسخة المنشورة دون حسابات
```

## النشر

النشر يتم من GitHub Actions عبر `.github/workflows/agency-followup.yml`، عند الدفع إلى الفرع أو بالتشغيل اليدوي. ترتيب المراحل:

1. اختبارات النوع، ثم اختبارات Workers، ثم البناء.
2. نشر نسخة **staging**، ثم تجربة كاملة عليها في متصفح حقيقي، بما فيها Web Push حقيقي في Google Chrome.
3. نشر **الإنتاج**، ثم فحوص دون حسابات، ثم التحقق من أن الـCron يعمل فعلاً.

المطلوب مرة واحدة في GitHub، من Settings ثم Secrets and variables ثم Actions:
- `CLOUDFLARE_API_TOKEN`: توكن بصلاحيتي Workers Scripts: Edit وD1: Edit، على هذا الحساب فقط.
- `CLOUDFLARE_ACCOUNT_ID`: معرّف الحساب.

مفاتيح التطبيق تُولَّد عند أول نشر عبر `scripts/ensure-secrets.mjs` دون أن تُطبع. مكانها Worker secrets: `BETTER_AUTH_SECRET` و`VAPID_*`.

النشر يدوياً من جهاز عليه `wrangler login`:

```bash
npx wrangler d1 migrations apply agency-followup-db --remote
npx vite build && npx wrangler deploy
node scripts/ensure-secrets.mjs agency-followup
```

## الحسابات وروابط الدخول

لا يوجد تسجيل عام، ولا مسار تهيئة مفتوح. الأعضاء الأربعة موجودون في الـmigration دون كلمات مرور. يدخل كل عضو أول مرة عبر **رابط إعداد** يستخدم مرة واحدة ويصلح 72 ساعة، ويختار كلمة مروره بنفسه. يُخزَّن في القاعدة هاش الرابط فقط (SHA-256)، ويأتي الرمز بعد `#` فلا يصل إلى سجلات الخادم.

- محمد ينشئ رابطاً جديداً لأي عضو من صفحة **الإدارة**. هذا الإجراء يوقف كلمة المرور القديمة، ويُخرج العضو من كل أجهزته، ويُسجَّل.
- إذا احتاج محمد نفسه رابطاً جديداً، فمن جهاز عليه `wrangler`:

```bash
node scripts/setup-links.mjs --origin https://<رابط التطبيق> --users mohammed --sql /tmp/s.sql --links /tmp/links.txt
npx wrangler d1 execute agency-followup-db --remote --file /tmp/s.sql
```

ثم أرسل الرابط من `/tmp/links.txt` لصاحبه فقط، واحذف الملف.

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
- **التذكير والتصعيد داخل ساعات العمل فقط.** الساعات الافتراضية من الأحد إلى الخميس، 09:00–18:00 بتوقيت بغداد، وهي افتراض قابل للتعديل من الإدارة. استثناء العاجل مطفأ افتراضياً.
- **التسليم الواحد مؤكد، والإشعار قد يتكرر.** الإرسال يتم مرة واحدة على الأقل، وفي حالة نادرة قد يصل إشعار مكرر. سجل التنبيهات داخل التطبيق لا يتكرر.
- **خارج نطاق هذه النسخة.** المحاسبة، والذكاء الاصطناعي، والمحادثة العامة، ودخول العملاء، ورفع الفيديو، والتكامل مع واتساب وتلغرام والبريد.
