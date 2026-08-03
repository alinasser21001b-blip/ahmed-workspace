# MedMind IQ — Technical Handoff Spec

**Version:** 1.0  
**Audience:** Backend / Bot / DevOps engineer  
**Owner:** Product (medical content + business)  
**Status:** Ready for implementation  

---

## Table of Contents

| Part | Title |
|------|-------|
| 0 | Milestone 0 — Manual validation (no code) |
| 1 | Product philosophy & scope |
| 2 | System architecture |
| 3 | Database schema (PostgreSQL) |
| 4 | Telegram bot flows (Student + Admin) |
| 5 | REST API endpoints |
| 6 | Content production pipeline (AI) |
| 7 | Payments & subscriptions |
| 8 | Milestones & acceptance criteria |
| 9 | Non-negotiables & legal guardrails |
| A | Environment variables |
| B | File formats & storage layout |
| C | Error codes & observability |

---

# Part 0 — Milestone 0: Manual Validation (No Developer)

> **Do not write production code until this passes.**

## Goal

Sell manually to **30–50 students** using Telegram + Google Forms + manual PDF/Anki delivery. Prove willingness to pay before spending on development.

## Process

1. Create Telegram channel + support account (not bot yet).
2. Prepare **3 demo Study Packs** (Cardiology, Pharmacology, Anatomy) — product owner creates manually.
3. Price: 5,000–12,000 IQD/month. Accept ZainCash / bank transfer screenshot.
4. Track in Google Sheet: name, college, year, specialty, payment date, packs delivered.
5. Run for **2–4 weeks** including one exam season window if possible.

## Pass criteria (all required)

| # | Criterion | Target |
|---|-----------|--------|
| 0.1 | Paying students | ≥ 30 |
| 0.2 | Renewal intent | ≥ 60% say they would pay next month |
| 0.3 | Referrals | ≥ 5 organic referrals |
| 0.4 | Content quality | ≥ 4/5 average rating on delivered packs |
| 0.5 | Support load | ≤ 15 min/student/week (proves automation need) |

## Fail criteria → stop or pivot

- < 15 paying students after 4 weeks of active selling.
- Quality complaints about medical accuracy > 20% of users.
- Students only want free ChatGPT-style Q&A, not Study Packs.

---

# Part 1 — Product Philosophy & Scope

## 1.1 Core principle: Library-first, not AI wrapper

MedMind IQ is **not** a chatbot that answers medical questions. It is a **structured study library generator**:

```
Input (lecture PDF / topic name)
  → Validated pipeline
  → Fixed output bundle (Summary, MindMap, Keywords, Quiz, Anki, Sources)
  → Stored in user's library
  → Delivered on schedule via Telegram + Gmail
```

The AI is an **internal production tool**. The user-facing product is **repeatable, reviewable study artifacts**.

## 1.2 In scope (v1)

- Student Telegram bot (Arabic + English content)
- Admin Telegram bot (operations — **no web dashboard in v1**)
- Study Pack generation from PDF/text/topic
- Subscription tiers with usage limits
- Manual + semi-automated payment confirmation (Admin bot)
- Gmail delivery of PDF bundles
- User library (list + re-download past packs)
- Scheduled quizzes & reminders

## 1.3 Out of scope (v1)

- Free-form medical Q&A
- Web dashboard (deferred to v2)
- WhatsApp bot
- Real-time voice / video
- Diagnosis or treatment advice
- University LMS integration

## 1.4 User specialties (enum)

`general_medicine` | `pharmacy` | `dentistry` | `nursing` | `medical_labs` | `other`

## 1.5 Study Pack output bundle

Every successful generation produces **one `study_pack` record** with these artifacts:

| Artifact | Format | Required |
|----------|--------|----------|
| Summary | PDF + Markdown | Yes |
| Mind map | PNG + source (Mermaid `.mmd`) | Yes |
| Keywords | TXT + JSON | Yes |
| Quiz | PDF + JSON | Yes |
| Anki deck | `.apkg` | Yes |
| Sources | Markdown with citations | Yes |
| Study plan | JSON (optional v1.1) | No |

---

# Part 2 — System Architecture

## 2.1 High-level diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Student TG Bot │     │   Admin TG Bot  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   API Gateway (FastAPI)│
         │   Auth: TG user_id     │
         └───────────┬───────────┘
                     │
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
┌────────┐    ┌────────────┐   ┌───────────┐
│ Postgres│    │ Redis Queue │   │ S3 / MinIO │
│ (state) │    │ (Bull/RQ)   │   │ (files)    │
└────────┘    └──────┬──────┘   └───────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│ Worker: Pack     │    │ Worker: Delivery │
│ Pipeline         │    │ (TG + Gmail)     │
└────────┬────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌─────────────────┐
│ LLM (Claude/    │    │ Vector DB       │
│ GPT-4o)         │    │ (RAG — phase 2) │
└─────────────────┘    └─────────────────┘

┌─────────────────┐
│ Cron Scheduler  │──► daily quiz, reminders, expiry checks
└─────────────────┘
```

## 2.2 Tech stack (mandated for v1)

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | Python 3.12 | Single codebase for API + workers + bots |
| API | FastAPI | OpenAPI auto-docs |
| Bot | `python-telegram-bot` v21+ | Long polling first; webhook later |
| Queue | Redis + ARQ or Celery | Job idempotency required |
| DB | PostgreSQL 16 | Migrations via Alembic |
| Object storage | MinIO (dev) / S3 (prod) | All artifacts |
| PDF | WeasyPrint or ReportLab | Summary + Quiz PDFs |
| Anki | `genanki` | `.apkg` export |
| Mind map | Mermaid CLI → PNG | Store `.mmd` source |
| Email | SendGrid or Gmail SMTP | Transactional only |
| Hosting | Hetzner VPS or Railway | Single region OK for v1 |

## 2.3 Deployment topology (v1)

Minimum production:

- 1× API + Bot process (or split if load requires)
- 1× Worker process (pack generation)
- 1× Worker process (delivery — can merge with above at low scale)
- 1× Redis
- 1× PostgreSQL
- 1× MinIO/S3

## 2.4 Idempotency & concurrency

**Critical:** Payment confirmation and pack generation must be idempotent.

- Every job has `idempotency_key` (UUID or hash of `user_id + input_hash + pack_type`).
- Redis lock: `pack:generate:{user_id}` — max 1 concurrent generation per user.
- DB unique constraint on `study_packs.idempotency_key`.
- Payment webhook/manual confirm: unique on `payments.provider_ref`.

---

# Part 3 — Database Schema (PostgreSQL)

## 3.1 ER overview

```
users ──┬── subscriptions ── subscription_plans
        ├── study_packs ── pack_artifacts
        ├── pack_jobs
        ├── quiz_attempts
        ├── payment_requests ── payments
        └── user_settings

admin_users (separate table, linked to admin bot tg id)
audit_logs
scheduled_tasks
```

## 3.2 Full SQL (migration 001)

```sql
-- ============================================================
-- MedMind IQ — Initial Schema
-- PostgreSQL 16+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE specialty AS ENUM (
  'general_medicine', 'pharmacy', 'dentistry',
  'nursing', 'medical_labs', 'other'
);

CREATE TYPE subscription_status AS ENUM (
  'active', 'expired', 'cancelled', 'pending_payment'
);

CREATE TYPE pack_status AS ENUM (
  'queued', 'processing', 'completed', 'failed', 'cancelled'
);

CREATE TYPE artifact_type AS ENUM (
  'summary_pdf', 'summary_md', 'mindmap_png', 'mindmap_mmd',
  'keywords_txt', 'keywords_json', 'quiz_pdf', 'quiz_json',
  'anki_apkg', 'sources_md', 'study_plan_json'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'confirmed', 'rejected', 'refunded'
);

CREATE TYPE payment_method AS ENUM (
  'zaincash', 'bank_transfer', 'qi_card', 'agent_code', 'manual'
);

CREATE TYPE job_type AS ENUM (
  'generate_pack', 'deliver_pack', 'send_quiz', 'send_reminder'
);

CREATE TYPE job_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'dead'
);

-- ── Subscription plans ─────────────────────────────────────

CREATE TABLE subscription_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(32) NOT NULL UNIQUE,  -- basic, pro, ultimate, group
  name_ar         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  price_iqd       INTEGER NOT NULL CHECK (price_iqd > 0),
  packs_per_month INTEGER NOT NULL CHECK (packs_per_month >= 0), -- 0 = unlimited
  features        JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans (code, name_ar, name_en, price_iqd, packs_per_month, features) VALUES
  ('basic',    'أساسي',   'Basic',    5000,  10,  '{"anki":false,"mindmap":false,"quiz":false,"automation":false}'),
  ('pro',      'احترافي', 'Pro',      12000, 30,  '{"anki":true,"mindmap":true,"quiz":true,"automation":false}'),
  ('ultimate', 'شامل',    'Ultimate', 20000, 0,   '{"anki":true,"mindmap":true,"quiz":true,"automation":true}');

-- ── Users ────────────────────────────────────────────────────

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id       BIGINT NOT NULL UNIQUE,
  telegram_username CITEXT,
  full_name         VARCHAR(256),
  email             CITEXT,
  specialty         specialty NOT NULL DEFAULT 'general_medicine',
  university        VARCHAR(256),
  study_year        SMALLINT CHECK (study_year BETWEEN 1 AND 7),
  locale            VARCHAR(8) NOT NULL DEFAULT 'ar',
  is_blocked        BOOLEAN NOT NULL DEFAULT FALSE,
  referral_code     VARCHAR(16) NOT NULL UNIQUE,
  referred_by       UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_referral ON users(referred_by);

-- ── Subscriptions ────────────────────────────────────────────

CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES subscription_plans(id),
  status      subscription_status NOT NULL DEFAULT 'pending_payment',
  starts_at   TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  packs_used  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE UNIQUE INDEX idx_subscriptions_one_active
  ON subscriptions(user_id)
  WHERE status = 'active';

-- ── Study packs ──────────────────────────────────────────────

CREATE TABLE study_packs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id   UUID REFERENCES subscriptions(id),
  title             VARCHAR(512) NOT NULL,
  topic             VARCHAR(512),
  input_type        VARCHAR(32) NOT NULL,  -- pdf, text, topic
  input_storage_key VARCHAR(512),          -- S3 key of original input
  input_hash        VARCHAR(64) NOT NULL,  -- SHA-256 of input
  status            pack_status NOT NULL DEFAULT 'queued',
  idempotency_key   VARCHAR(128) NOT NULL UNIQUE,
  error_message     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_study_packs_user ON study_packs(user_id, created_at DESC);
CREATE INDEX idx_study_packs_status ON study_packs(status) WHERE status IN ('queued', 'processing');

-- ── Pack artifacts ─────────────────────────────────────────

CREATE TABLE pack_artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_pack_id   UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  artifact_type   artifact_type NOT NULL,
  storage_key     VARCHAR(512) NOT NULL,
  file_size_bytes BIGINT,
  mime_type       VARCHAR(128),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (study_pack_id, artifact_type)
);

-- ── Pack generation jobs ─────────────────────────────────────

CREATE TABLE pack_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_pack_id   UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  job_type        job_type NOT NULL,
  status          job_status NOT NULL DEFAULT 'pending',
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  payload         JSONB NOT NULL DEFAULT '{}',
  result          JSONB,
  error_message   TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pack_jobs_pending ON pack_jobs(status, scheduled_at)
  WHERE status = 'pending';

-- ── Quiz attempts ────────────────────────────────────────────

CREATE TABLE quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_pack_id   UUID NOT NULL REFERENCES study_packs(id) ON DELETE CASCADE,
  score           SMALLINT NOT NULL,
  total           SMALLINT NOT NULL,
  answers         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payments ─────────────────────────────────────────────────

CREATE TABLE payment_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
  amount_iqd      INTEGER NOT NULL,
  method          payment_method NOT NULL,
  status          payment_status NOT NULL DEFAULT 'pending',
  proof_storage_key VARCHAR(512),   -- screenshot of transfer
  provider_ref    VARCHAR(256),     -- transaction id / agent code
  admin_note      TEXT,
  confirmed_by    UUID,             -- admin_users.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_payment_provider_ref
  ON payment_requests(provider_ref)
  WHERE provider_ref IS NOT NULL AND status = 'confirmed';

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id  UUID NOT NULL UNIQUE REFERENCES payment_requests(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  subscription_id     UUID NOT NULL REFERENCES subscriptions(id),
  amount_iqd          INTEGER NOT NULL,
  confirmed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Admin users ──────────────────────────────────────────────

CREATE TABLE admin_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     BIGINT NOT NULL UNIQUE,
  display_name    VARCHAR(128) NOT NULL,
  role            VARCHAR(32) NOT NULL DEFAULT 'operator',  -- operator, superadmin
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User settings ────────────────────────────────────────────

CREATE TABLE user_settings (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_quiz_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  daily_quiz_hour         SMALLINT NOT NULL DEFAULT 7 CHECK (daily_quiz_hour BETWEEN 0 AND 23),
  gmail_delivery_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  timezone                VARCHAR(64) NOT NULL DEFAULT 'Asia/Baghdad'
);

-- ── Scheduled tasks ──────────────────────────────────────────

CREATE TABLE scheduled_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type       VARCHAR(64) NOT NULL,  -- daily_quiz, exam_reminder, weekly_plan
  cron_expr       VARCHAR(64),
  next_run_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_next ON scheduled_tasks(next_run_at)
  WHERE is_active = TRUE;

-- ── Audit logs ───────────────────────────────────────────────

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type      VARCHAR(16) NOT NULL,  -- user, admin, system
  actor_id        UUID,
  action          VARCHAR(64) NOT NULL,
  entity_type     VARCHAR(64),
  entity_id       UUID,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ── Helper: reset monthly pack counter ───────────────────────

CREATE OR REPLACE FUNCTION reset_monthly_pack_usage()
RETURNS void AS $$
BEGIN
  UPDATE subscriptions
  SET packs_used = 0, updated_at = NOW()
  WHERE status = 'active';
END;
$$ LANGUAGE plpgsql;
-- Run via cron on 1st of each month: SELECT reset_monthly_pack_usage();
```

## 3.3 Key business rules (enforce in application layer)

| Rule | Implementation |
|------|----------------|
| Pack quota | Before enqueue: check `packs_used < plan.packs_per_month` (0 = unlimited) |
| Active subscription | Only `status = 'active' AND expires_at > NOW()` |
| One active sub per user | DB unique partial index + app check |
| Blocked user | Reject all bot commands except `/support` |
| Referral credit | On confirmed payment of referred user → extend referrer sub 7 days (v1.1) |

---

# Part 4 — Telegram Bot Flows

## 4.1 Student bot — command map

| Command / Trigger | Action |
|-------------------|--------|
| `/start` | Onboarding FSM (if new) or main menu |
| `/menu` | Main menu inline keyboard |
| `/newpack` | Start pack creation flow |
| `/library` | List last 20 packs with download buttons |
| `/subscription` | Show plan, usage, expiry, upgrade |
| `/pay` | Payment flow (method selection → proof upload) |
| `/settings` | Email, daily quiz hour, specialty, year |
| `/referral` | Show referral code + stats |
| `/help` | FAQ + disclaimer |
| `/support` | Forward to admin group |

## 4.2 Student bot — onboarding FSM

```
/start
  → Welcome + disclaimer (must tap "أفهم وأوافق")
  → Select specialty [inline buttons]
  → Select study year [1-7]
  → Enter university (text or skip)
  → Enter email (text or skip)
  → Main menu
```

**Disclaimer text (mandatory, store consent timestamp in audit_logs):**

> MedMind IQ أداة مراجعة دراسية. لا يقدّم تشخيصاً أو علاجاً. المحتوى للمراجعة الأكاديمية فقط.

## 4.3 Student bot — new pack flow

```
/newpack
  → Check subscription active + quota
  → "Choose input type:"
      [📄 Upload PDF] [📝 Paste text] [📚 Topic name only]
  → User provides input
  → Optional: confirm detected title
  → Show summary: "سيتم إنشاء: Summary, MindMap, Keywords, Quiz, Anki"
  → [Confirm] [Cancel]
  → On confirm:
      - Create study_pack (status=queued)
      - Increment packs_used (optimistic; rollback on fail)
      - Enqueue pack_jobs
      - Reply: "⏳ جاري التحضير... (~3-5 دقائق)"
  → On complete (push notification):
      - Send each file as Telegram document
      - Inline: [⭐ Rate this pack] [🔄 Regenerate — uses quota]
```

## 4.4 Student bot — blocked intents (Non-Negotiable #6)

If user sends free text that looks like a medical question (not a command, not in pack flow):

```
Detect: question patterns, "what is", "how to treat", "diagnosis", Arabic equivalents
  → DO NOT call LLM
  → Reply template:

"🔒 MedMind IQ ينتج حزم مراجعة من محاضراتك — لا يجيب أسئلة طبية مباشرة.

استخدم /newpack لإنشاء حزمة من موضوعك أو PDF محاضرتك."
```

Implement with:
1. FSM state guard — only process LLM outside `generate_pack` job.
2. Regex + lightweight classifier (no LLM) for question detection.
3. Log blocked attempts to `audit_logs` for monitoring abuse.

## 4.5 Student bot — payment flow

```
/pay
  → Show active plans with prices
  → User selects plan
  → Show payment methods:
      [ZainCash] [Bank transfer] [Agent code]
  → Instructions + amount + reference code (payment_requests.id short form)
  → User uploads screenshot OR enters agent code
  → Status: "⏳ بانتظار تأكيد الدفع (通常 خلال ساعات)"
  → Admin confirms → bot notifies user → subscription activated
```

## 4.6 Admin bot — scope (replaces web dashboard v1)

**Authorized `telegram_id` only** — check `admin_users.is_active`.

| Command | Action |
|---------|--------|
| `/pending` | List pending payment_requests (paginated) |
| `/confirm {payment_id}` | Confirm payment → activate subscription → notify user |
| `/reject {payment_id} {reason}` | Reject → notify user |
| `/user {telegram_id}` | User profile, sub status, pack count |
| `/block {telegram_id}` | Block user |
| `/stats` | Today: new users, payments, packs generated, failures |
| `/pack {pack_id}` | Pack status + artifacts + error |
| `/retry {pack_id}` | Re-enqueue failed pack (no quota charge) |
| `/broadcast {message}` | Send to all active subscribers (superadmin only) |

## 4.7 Admin bot — payment confirmation flow

```
/pending
  → List:
    #abc123 | @username | Pro | 12,000 IQD | ZainCash | 2h ago
    [✅ Confirm abc123] [❌ Reject abc123]
  → On confirm:
    - Idempotent: if already confirmed, show warning, no double activation
    - Create subscription (active, starts_at=now, expires_at=+30 days)
    - Insert payments row
    - Audit log
    - Notify user via student bot
```

---

# Part 5 — REST API Endpoints

Base URL: `https://api.medmind.iq/v1`  
Auth: Internal only (bot + workers). No public API in v1.

## 5.1 Health

```
GET /health
→ 200 { "status": "ok", "db": "ok", "redis": "ok", "storage": "ok" }
```

## 5.2 Users (called by bot service)

```
POST /internal/users/upsert
Body: { telegram_id, username, full_name }
→ 200 { user, is_new }

PATCH /internal/users/{user_id}
Body: { specialty, study_year, university, email, locale }
→ 200 { user }

GET /internal/users/by-telegram/{telegram_id}
→ 200 { user, subscription, settings, packs_used, packs_limit }
```

## 5.3 Study packs

```
POST /internal/packs
Body: {
  user_id,
  input_type: "pdf" | "text" | "topic",
  input_storage_key?,   // if pdf uploaded
  input_text?,          // if text/topic
  title?
}
Headers: Idempotency-Key: {uuid}
→ 202 { study_pack, job_id }
→ 402 if quota exceeded
→ 403 if no active subscription

GET /internal/packs/{pack_id}
→ 200 { study_pack, artifacts: [{ type, download_url, expires_in }] }

GET /internal/users/{user_id}/packs?limit=20&offset=0
→ 200 { packs[], total }
```

## 5.4 Payments

```
POST /internal/payments/request
Body: { user_id, plan_code, method }
→ 201 { payment_request, payment_instructions }

POST /internal/payments/{request_id}/proof
Body: multipart screenshot OR { provider_ref, agent_code }
→ 200 { payment_request }

POST /internal/admin/payments/{request_id}/confirm
Headers: X-Admin-Id: {admin_uuid}
→ 200 { payment, subscription }
→ 409 if already confirmed

POST /internal/admin/payments/{request_id}/reject
Body: { reason }
→ 200 { payment_request }
```

## 5.5 Jobs (worker internal)

```
POST /internal/jobs/{job_id}/claim
→ 200 { job } | 404

PATCH /internal/jobs/{job_id}
Body: { status, result?, error_message? }
→ 200

POST /internal/jobs/enqueue
Body: { study_pack_id, job_type }
→ 201 { job_id }
```

## 5.6 Webhooks (future)

```
POST /webhooks/zaincash   (v1.1 — auto payment confirm)
```

## 5.7 File upload

```
POST /internal/files/upload
Body: multipart (pdf, max 20MB)
→ 201 { storage_key, input_hash, page_count }
```

---

# Part 6 — Content Production Pipeline

## 6.1 Pipeline stages

```
Stage 0: Extract text
  PDF → pymupdf/pdfplumber → raw_text + page_map
  Validate: min 200 chars, max 150 pages

Stage 1: Structure analysis (LLM call #1)
  Input: raw_text + user context (specialty, year)
  Output JSON: { title, sections[], high_yield_topics[], suggested_sources[] }

Stage 2: Parallel generation (LLM calls #2-#6)
  2a. Summary → Markdown → PDF
  2b. Keywords → JSON + TXT
  2c. Quiz → JSON (20 questions) → PDF
  2d. Anki → JSON cards → genanki → .apkg
  2e. Mind map → Mermaid → PNG

Stage 3: Sources pass (LLM call #7 — optional merge with #1)
  Append sources.md with citation format

Stage 4: Upload artifacts to S3
  Keys: packs/{user_id}/{pack_id}/{artifact_type}.{ext}

Stage 5: Update study_pack status=completed
  Enqueue deliver_pack job
```

## 6.2 LLM configuration

| Setting | Value |
|---------|-------|
| Primary model | Claude 3.5 Sonnet or GPT-4o |
| Temperature | 0.2 (generation), 0.0 (quiz answers) |
| Max tokens | Per stage limits in prompt files |
| Timeout | 120s per call, 3 retries with backoff |
| JSON mode | Required for structured outputs |

## 6.3 Prompt files (maintained by product owner — NOT developer)

Location: `prompts/` in repo. Developer loads templates; **does not edit medical content logic.**

```
prompts/
  01_structure_analysis.md
  02_summary.md
  03_keywords.md
  04_quiz_mcq.md
  05_anki_cards.md
  06_mindmap_mermaid.md
  07_sources.md
  system_medical_reviewer.md   # shared system prompt
```

Each file contains:
- `{{SPECIALTY}}`, `{{YEAR}}`, `{{TITLE}}`, `{{CONTENT}}` placeholders
- Output JSON schema
- Negative constraints (no fabricated drug doses, mark uncertain claims)

**Developer task:** Build `PromptLoader` that injects variables and validates JSON output against Pydantic models.

## 6.4 Pydantic output schemas (developer implements)

```python
# schemas/pack_outputs.py — structure only; prompts define content rules

class Section(BaseModel):
    heading: str
    bullets: list[str]
    clinical_pearl: str | None

class StructureAnalysis(BaseModel):
    title: str
    sections: list[Section]
    high_yield_topics: list[str]

class QuizQuestion(BaseModel):
    id: int
    stem: str
    options: dict[str, str]  # A,B,C,D
    correct: str
    explanation: str
    difficulty: Literal["easy", "medium", "hard"]

class AnkiCard(BaseModel):
    front: str
    back: str
    tags: list[str]
    card_type: Literal["basic", "cloze"]

# ... etc
```

## 6.5 Validation gates (reject pack if fail)

| Gate | Rule |
|------|------|
| G1 | Summary ≥ 500 words |
| G2 | Quiz exactly 20 questions, 4 options each |
| G3 | Anki ≥ 30 cards |
| G4 | Mind map Mermaid parses without error |
| G5 | No empty sections in structure |
| G6 | JSON schema validation pass |

On gate failure: retry stage once → if still fail, `pack_status=failed`, notify admin via admin bot.

## 6.6 Regeneration policy

- User-initiated regenerate: counts against quota.
- System failure retry: does **not** count (admin `/retry`).
- Max 2 auto-retries per stage.

---

# Part 7 — Payments & Subscriptions

## 7.1 v1 flow: manual confirmation (Admin bot)

Automated ZainCash webhook is **v1.1**. v1 uses screenshot + admin confirm.

## 7.2 Payment instructions template

Generated per `payment_request`:

```
الاشتراك: Pro — 12,000 IQD
رمز الطلب: MM-A1B2C3

ZainCash: 078XXXXXXXX
ملاحظة التحويل: MM-A1B2C3

بعد التحويل: /pay → Upload screenshot
```

## 7.3 Subscription lifecycle

```
pending_payment → (admin confirm) → active
active → (expires_at passed) → expired  [cron daily]
active → (user upgrade) → new subscription row, old cancelled
expired → (user pays) → new active subscription
```

## 7.4 Agent codes (optional v1)

Table extension (migration 002):

```sql
CREATE TABLE agent_codes (
  code            VARCHAR(32) PRIMARY KEY,
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
  uses_remaining  INTEGER NOT NULL,
  expires_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES admin_users(id)
);
```

User enters code in `/pay` → auto-confirm if valid → decrement uses.

---

# Part 8 — Milestones & Acceptance Criteria

## Milestone 1 — Foundation (Week 1–2)

**Deliverables:** DB migrations, API skeleton, student bot onboarding, health checks.

| ID | Acceptance criterion | Verification |
|----|---------------------|--------------|
| M1.1 | All tables from §3.2 exist via Alembic migration | `alembic upgrade head` clean on fresh DB |
| M1.2 | `/start` onboarding completes and persists user | DB row + consent in audit_logs |
| M1.3 | `/menu` shows correct state for new vs returning user | Manual TG test |
| M1.4 | Blocked user cannot use bot | `/block` then commands rejected |
| M1.5 | API `/health` returns component statuses | curl test |
| M1.6 | All API errors return JSON `{ error_code, message }` | Unit tests |

## Milestone 2 — Payments & Subscriptions (Week 3)

**Deliverables:** Admin bot, payment flow, subscription enforcement.

| ID | Acceptance criterion | Verification |
|----|---------------------|--------------|
| M2.1 | User can submit payment request + upload proof | E2E TG test |
| M2.2 | Admin `/confirm` activates subscription exactly once | Double-click confirm → 409, one sub only |
| M2.3 | `/newpack` rejected without active subscription | 403 message in Arabic |
| M2.4 | Quota enforced: Basic user blocked after 10 packs/month | DB set packs_used=10 → next pack rejected |
| M2.5 | `/stats` shows accurate counts | Compare with DB query |
| M2.6 | Expired subscription blocked at midnight Baghdad | Cron test with mocked time |

## Milestone 3 — Pack Pipeline (Week 4–5)

**Deliverables:** PDF upload, full generation pipeline, library.

| ID | Acceptance criterion | Verification |
|----|---------------------|--------------|
| M3.1 | PDF upload ≤20MB stored in S3 | File retrievable |
| M3.2 | Full pack generates all 7 required artifacts | Inspect S3 keys |
| M3.3 | Generation completes ≤8 min p95 for 30-page PDF | Load test log |
| M3.4 | Idempotency: same Idempotency-Key → same pack, no double charge | Parallel curl × 5 |
| M3.5 | Concurrent users: 10 parallel generations no crash | Load test |
| M3.6 | Failed pack shows error to user + admin notified | Kill worker mid-job |
| M3.7 | `/library` lists and re-sends artifacts | TG download works |
| M3.8 | Validation gates G1–G6 enforced | Inject bad LLM output in test |

## Milestone 4 — Delivery & Automation (Week 6)

**Deliverables:** Gmail delivery, daily quiz cron, settings.

| ID | Acceptance criterion | Verification |
|----|---------------------|--------------|
| M4.1 | Completed pack emailed to user email (if set) | Check inbox |
| M4.2 | Daily quiz sends at user-configured hour (Baghdad TZ) | Cron + TG message |
| M4.3 | User can disable daily quiz in `/settings` | No message next day |
| M4.4 | Quiz attempt stored with score | DB quiz_attempts row |
| M4.5 | Monthly pack counter resets on 1st | Cron job test |

## Milestone 5 — Hardening & Launch (Week 7–8)

**Deliverables:** Rate limits, monitoring, referral, production deploy.

| ID | Acceptance criterion | Verification |
|----|---------------------|--------------|
| M5.1 | Free-text medical questions never reach LLM | Send 20 test questions → all blocked |
| M5.2 | Rate limit: max 3 pack requests/hour/user | 4th rejected |
| M5.3 | All admin actions in audit_logs | Confirm payment → log row |
| M5.4 | Referral code generated unique per user | `/referral` works |
| M5.5 | Error alerting: 3+ pack failures in 1h → admin TG alert | Simulate failures |
| M5.6 | Backup: daily PG dump + S3 lifecycle policy | Ops doc |
| M5.7 | README: deploy, env, migrate, run workers | New dev can deploy in <2h |

---

# Part 9 — Non-Negotiables & Legal Guardrails

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | No free-form medical Q&A | FSM + classifier; no LLM outside pipeline |
| 2 | Disclaimer before first use | Block all features until consent |
| 3 | Every pack traceable | input_hash + audit + artifacts retained 90 days |
| 4 | Payment idempotency | Unique provider_ref; confirm once |
| 5 | Admin actions authenticated | telegram_id in admin_users |
| 6 | **Never answer medical questions in chat** | Template reply only — protects legally and API cost |
| 7 | No fabricated citations | Sources prompt marks `[VERIFY]` if uncertain |
| 8 | User data: email optional, deletable on request | `/delete_account` (v1.1) |
| 9 | Iraqi payment amounts in IQD integers only | No float currency |
| 10 | Content is "study review" not "clinical advice" | Footer on every PDF |

---

# Appendix A — Environment Variables

```bash
# App
APP_ENV=production
APP_SECRET_KEY=
API_BASE_URL=https://api.medmind.iq

# Database
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/medmind

# Redis
REDIS_URL=redis://localhost:6379/0

# Telegram
STUDENT_BOT_TOKEN=
ADMIN_BOT_TOKEN=
ADMIN_ALERT_CHAT_ID=          # group for failure alerts

# Storage
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=medmind-packs
S3_REGION=

# LLM
OPENAI_API_KEY=               # or
ANTHROPIC_API_KEY=
LLM_MODEL=claude-3-5-sonnet-20241022
LLM_MAX_RETRIES=3

# Email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=packs@medmind.iq

# Business
DEFAULT_TIMEZONE=Asia/Baghdad
MAX_PDF_SIZE_MB=20
MAX_PDF_PAGES=150
PACK_GENERATION_TIMEOUT_SEC=480
```

---

# Appendix B — File Storage Layout

```
s3://medmind-packs/
  inputs/{user_id}/{pack_id}/original.pdf
  packs/{user_id}/{pack_id}/
    summary.pdf
    summary.md
    mindmap.png
    mindmap.mmd
    keywords.txt
    keywords.json
    quiz.pdf
    quiz.json
    deck.apkg
    sources.md
  payments/{user_id}/{request_id}/proof.jpg
```

Pre-signed download URLs: expire in 15 minutes.

---

# Appendix C — Error Codes & Observability

## Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `SUBSCRIPTION_REQUIRED` | 403 | No active plan |
| `QUOTA_EXCEEDED` | 402 | Monthly pack limit hit |
| `PACK_IN_PROGRESS` | 409 | User already has running job |
| `INPUT_TOO_LARGE` | 413 | PDF over limit |
| `INPUT_INVALID` | 422 | Unreadable PDF / empty text |
| `GENERATION_FAILED` | 500 | Pipeline failed after retries |
| `PAYMENT_ALREADY_CONFIRMED` | 409 | Duplicate confirm |
| `USER_BLOCKED` | 403 | Admin blocked |

## Metrics (Prometheus or structured logs)

- `pack_generation_duration_seconds` (histogram)
- `pack_generation_total` (counter by status)
- `llm_calls_total` (counter by stage)
- `llm_tokens_total` (counter)
- `payments_confirmed_total`
- `blocked_medical_questions_total`

## Logging

Structured JSON logs. Include: `request_id`, `user_id`, `pack_id`, `job_id`. **Never log full PDF content or LLM prompts in production** — log hashes only.

---

# Developer Handoff Checklist

- [ ] Read Part 0 — confirm Milestone 0 passed before starting M1
- [ ] Clone repo, copy `.env.example` → `.env`
- [ ] Run migrations
- [ ] Register two Telegram bots (@BotFather): student + admin
- [ ] Implement in milestone order — do not skip M2 before M3
- [ ] Load prompts from `prompts/` — do not hardcode medical content
- [ ] Run acceptance tests per milestone before invoicing

---

**Next document (product owner):** `prompts/` — actual generation prompts for Summary, MCQ, Anki, MindMap (see separate deliverable).
