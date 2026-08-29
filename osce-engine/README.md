# @osce/engine

A deterministic OSCE Knowledge-to-Station engine: uploaded historical recall
material becomes traceable structured knowledge, human-approved publication,
examiner-specific station compilation, and grounded answer evaluation.

**No LLM is required on any path.** Semantic behaviour — matching "DVT" to
"deep vein thrombosis", or an Arabic answer to an English answer key — comes
from a controlled vocabulary and rule systems that a medical reviewer can read,
audit and edit. An optional semantic provider can be added behind the existing
interfaces, but nothing depends on it.

Zero runtime dependencies. Runs on Cloudflare Workers, Node, Deno and Bun.

---

## Why deterministic

The framework this implements ends with a definition: *"Professional means
measurable and auditable. The system is professional when every station question
can explain where it came from, why it was selected, whether it is approved for
evaluation, and which session owned the final student interaction."*

An LLM in the extraction or grading path breaks all four of those.

| Property | Deterministic engine | LLM in the path |
|---|---|---|
| Same input, same output | Guaranteed | Not guaranteed, even at temperature 0 |
| Explain a mark to a student | "You wrote 'DVT', which is a listed form of the key point 'deep vein thrombosis'" | "The model judged it covered" |
| Fix a wrong result | Edit a vocabulary row; effect is immediate and bounded | Change a prompt; effect is unbounded and unverifiable |
| Fabricate content that is not in the source | Structurally impossible — a candidate with no source span cannot be constructed | A known failure mode |
| Cost per evaluation | ~0.3 ms CPU | A network round trip and a per-call charge |
| Enumerate the blind spots | Yes — they are the vocabulary's gaps, and they are reported | No |

The honest cost: **recall is bounded by vocabulary coverage.** A paraphrase that
uses no listed surface form and names no known concept is missed. Every such
term is reported in `unmatchedTerms`, which turns the ceiling into a reviewer
work queue instead of a silent failure. That trade is deliberate — in an exam
system, a missed mark that a student can appeal is recoverable; a fabricated
question attributed to a real examiner is not.

---

## Architecture

Modular monolith, as the framework's Section 12 recommends. Every module is pure
where it can be, and I/O lives behind ports.

```
src/
├── domain/        Branded IDs, error taxonomy, FNV-1a fingerprints, ULIDs
├── text/          Normalization, tokenization, similarity, phonetics,
│                  SimHash/MinHash, controlled vocabulary, NegEx negation
├── ingestion/     Parser registry → segmenter → candidate extractor
├── resolution/    Fellegi-Sunter linkage, examiner/case resolvers, dedup
├── review/        Candidate state machine (the safety boundary)
├── publish/       Idempotent publication planning
├── station/       Seeded PRNG, station compiler
├── session/       Server-owned exam sessions
├── evaluation/    Grounded key-point evaluator
├── psychometrics/ Elo item calibration, Wilson bounds, discrimination
├── observability/ Typed events, redaction, latency, KPI targets
└── adapters/      In-memory store; SQL schema in schema/001_init.sql
```

### The five decisions that matter

**1. Two-gate examiner resolution.** The framework tolerates zero incorrect
examiner auto-merges. No purely probabilistic system can promise that. So
resolution has two gates: Fellegi-Sunter supplies a posterior probability with a
per-field breakdown, but an *automatic* match requires an exact canonical name
or a registered alias. Everything else — every typo, every near-miss — becomes
`AMBIGUOUS` and goes to a human. The probability is used for ranking the review
queue and explaining the suggestion, never for taking an irreversible action.

**2. A controlled vocabulary instead of embeddings.** Surface forms map to
concept identifiers; two texts are semantically equal when they name the same
concepts. This is UMLS's mechanism at one corpus's scale. It matches
`"What are the complications of deep vein thrombosis?"` to
`"ما هي مضاعفات الجلطة الوريدية العميقة؟"` with **zero character overlap**, and
it can name the concepts it matched on.

**3. Negation with trigger provenance.** A key point can legitimately contain a
negation word — *"antibiotics cure appendicitis without surgery"* is one
assertion, and the "without" belongs to the claim. Plain NegEx reads that span as
negated, which silently converts an asserted pitfall into an unpenalised one.
The detector records which token triggered each negation, so a matcher can
ignore triggers originating inside the span it is testing.

**4. Seeded, reproducible station compilation.** Every station is a pure
function of `(seed, policy version, knowledge snapshot)` using xoshiro128**.
When a student disputes a station, you re-run the compiler with the stored seed
and get exactly the same questions in exactly the same order.

**5. Derived counts, never incremented.** "Asked 5 times" is recomputed from
approved occurrence rows. Publication is idempotent through a deterministic
fingerprint plus a `UNIQUE` index, so a replay is a no-op rather than an
inflated count.

---

## Verified behaviour

```
npm run verify     # typecheck + tests + benchmark
```

- **93 tests, 0 failures.** Typechecks clean under `strict`,
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- All ten of the framework's Section 14 acceptance tests are implemented as
  executable tests, not prose.
- The review state machine's safety property is proved by exhaustive graph
  search: `pathsToPublished()` enumerates every route from `PENDING` to
  `PUBLISHED`, and a test asserts each contains a reviewer action.

### Measured latency

Engine CPU only — no I/O. Corpus: 200 examiners × 3 cases × 12 questions
(7,200 questions, 19,800 occurrences), Node 22.

| Operation | p50 | p95 | Budget | Consumed |
|---|---|---|---|---|
| Station compilation | 0.046 ms | 0.105 ms | 800 ms | 0.01% |
| Answer evaluation | 0.209 ms | 0.356 ms | 300 ms | 0.12% |
| Question dedup vs 5,000 | 0.130 ms | 1.437 ms | — | — |
| Examiner resolution vs 3,000 | 2.06 ms | 6.98 ms | — | — |
| Ingest a 10 KB recall file | 21.99 ms | 32.10 ms | 1500 ms | 2.1% |

The two exam-path budgets are consumed to roughly one part in ten thousand and
one part in a thousand respectively. **The engine is not what will make these
endpoints slow** — database round trips are, which is where the schema's
covering indexes matter more than any of this arithmetic.

### A known limitation, measured rather than assumed

Examiner blocking degrades when many names share a phonetic skeleton. On a
realistic Iraqi/Arabic name distribution the index yields 970 buckets with mean
16 and **max 910** — that largest bucket is every examiner whose given name
sounds like "Ahmed". Resolution still returns in ~7 ms p95, and it is an admin
path, not the exam path, so this is acceptable today. It will not stay
acceptable at 10× the examiner count.

The benchmark deliberately includes a degenerate corpus where blocking collapses
to 4 buckets, to measure the failure rather than discover it later:
resolution rises to ~20 ms p95. The fix when it is needed is a compound
given+family blocking key rather than the per-token key; that is a
one-function change in `phonetic.ts`.

---

## Using it

```ts
import {
  ingest, ParserRegistry, contentHash,
  applyReview, planPublication,
  compileStation, makeCompilerSeed,
  createSession, DeterministicEvaluator,
  makeIdFactory, systemClock,
} from '@osce/engine';

// 1. Ingest — parse, segment, extract, validate provenance
const result = ingest(
  { document, bytes, specialtyId },
  { parsers: new ParserRegistry(), ids: makeIdFactory(), clock: systemClock },
);

// 2. Review — every candidate needs a human decision
const approved = result.candidates.map((c) =>
  applyReview(c, { action: 'APPROVE', reviewerId: 'reviewer-1', at: Date.now() }),
);

// 3. Publish — idempotent, counts derived from occurrences
const plan = planPublication({ /* ... */ }, deps);

// 4. Compile a station — reproducible from its seed
const station = compileStation(
  {
    specialtyId,
    examinerMode: 'RANDOM',
    preparationSeconds: 90,
    desiredQuestionCount: 5,
    seed: makeCompilerSeed({ studentId, specialtyId, requestedAt: Date.now(), nonce }),
    currentYear: 2025,
  },
  knowledgeSource,
);

// 5. Evaluate — comparison against an approved key, never question answering
const evaluation = new DeterministicEvaluator().evaluate({
  question, referenceAnswer, keyPoints, studentAnswer,
});
```

## Extending the vocabulary

The vocabulary is data, not code. `unmatchedTerms` in every evaluation result
names the terms students used that the engine did not recognise; aggregate them
and add the recurring ones:

```ts
import { Lexicon } from '@osce/engine';

const lexicon = new Lexicon([
  ...SEED_CONCEPTS,
  {
    id: 'C:PNEUMOPERITONEUM',
    preferred: 'pneumoperitoneum',
    forms: ['pneumoperitoneum', 'free air', 'free gas under diaphragm', 'هواء حر'],
  },
]);
new DeterministicEvaluator({ lexicon });
```

No retraining, no redeploy of a model, and the effect is bounded to the terms
listed.

## Calibrating thresholds

Every threshold in the engine is configurable and none should be trusted on
faith. `calibrateThreshold` takes reviewer-labelled merge decisions and reports
the operating point that maximises F0.5 — precision-weighted, because a false
merge destroys two historical records while a missed merge only leaves a
duplicate in the queue.

```ts
const calibration = calibrateThreshold(labelledPairs, { idf, beta: 0.5 });
// { threshold: 0.63, precision: 1, recall: 1, margin: 0.198 }
```

Re-run it whenever the corpus, the tokenizer or the vocabulary changes.

## Database

`schema/001_init.sql` targets Cloudflare D1 and any SQLite 3.35+. It carries
every index from the framework's Section 10.1, a `UNIQUE (fingerprint)`
constraint that makes idempotency structural, and recount views
(`v_examiner_case_counts`, `v_examiner_question_counts`) that are the authority
behind the cached count columns — compare the two on a schedule and you have a
drift alarm.
