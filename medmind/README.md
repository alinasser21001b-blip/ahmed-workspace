# MedMind IQ

AI-powered study pack generator for medical students in Iraq.

## Stack

- **FastAPI** — internal API
- **PostgreSQL** — state
- **Redis + ARQ** — job queue
- **MinIO/S3** — file storage
- **Telegram** — student bot + admin bot
- **Claude/GPT** — content pipeline

## Quick start

### 1. Environment

```bash
cd medmind
cp .env.example .env
# Edit .env: add STUDENT_BOT_TOKEN, ADMIN_BOT_TOKEN, ANTHROPIC_API_KEY, ADMIN_TELEGRAM_IDS
```

### 2. Infrastructure

```bash
docker compose up -d postgres redis minio
```

### 3. Install & init DB

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/init_db.py
```

### 4. Run services (separate terminals)

```bash
uvicorn app.main:app --reload --port 8000
arq app.workers.settings.WorkerSettings
python -m app.bots.student_bot
python -m app.bots.admin_bot
```

Or all at once:

```bash
docker compose up --build
```

## Student bot commands

| Command | Description |
|---------|-------------|
| `/start` | Onboarding |
| `/newpack` | Create study pack |
| `/library` | Past packs |
| `/pay` | Subscribe |
| `/subscription` | Plan status |
| `/menu` | Main menu |

## Admin bot commands

| Command | Description |
|---------|-------------|
| `/pending` | Pending payments |
| `/stats` | Dashboard stats |
| `/user {telegram_id}` | User lookup |

## Study pack output

Each pack generates:

- Summary (PDF + MD)
- Mind map (PNG + Mermaid)
- Keywords (TXT + JSON)
- Quiz 20 MCQ (PDF + JSON)
- Anki deck (`.apkg`)
- Sources (MD)

## Docs

- [Technical Handoff Spec](../docs/medmind-iq/TECHNICAL_HANDOFF.md)
- Prompts: `prompts/` (editable by product owner)

## Non-negotiable

The bot **never** answers free-form medical questions — only generates study packs from user input.

## Milestone 0 reminder

Validate with 30–50 manual paying students **before** production launch.
