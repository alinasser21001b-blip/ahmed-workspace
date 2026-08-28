# OSCE Examination Simulator

Educational OSCE station simulator for final-year medical students.

This is **examination preparation**, not a clinical decision support tool. It does not provide patient-care recommendations. Medical content is bound to a curated knowledge base (seed fixtures until real recall files are uploaded).

## Run

```bash
cd osce
npm install
npm run dev
```

Open http://localhost:3000

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## What this is

Specialty → examiner (random or chosen) → a case historically associated with that examiner → timed preparation → one question at a time → reveal expected answer from the knowledge base → self-mark / heuristic evaluation → results.

The unique asset is **historical examiner knowledge**, not an LLM. Sample fixtures are clearly marked `SAMPLE / DEVELOPMENT DATA` and are not historical truth.

## Knowledge upload

`/admin` accepts TXT, Markdown, DOCX, and best-effort PDF. Uncertain extractions go to a review queue and are not silently published.
