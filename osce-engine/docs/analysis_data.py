"""
Single source of truth for both deliverables.

Both the Excel workbook and the PDF study are generated from this module, so a
number cannot say one thing in the spreadsheet and another in the report.
Every measured value carries its provenance in `EVIDENCE`.
"""

from datetime import date

META = {
    "title": "OSCE Knowledge-to-Station Engine",
    "subtitle": "Engineering Study, Competitive Analysis and V2 Implementation Report",
    "version": "2.0.0",
    "date": date(2026, 8, 29).isoformat(),
    "basis": "OSCE SaaS - Knowledge-to-Station Engine, Engineering Framework | Beta Architecture (18 pp.)",
    "author": "Engineering handoff",
}

# ---------------------------------------------------------------------------
# 1. Framework coverage: every numbered section of the source framework
# ---------------------------------------------------------------------------

# (section, requirement, status, implementation, evidence)
COVERAGE = [
    ("1", "Two independent paths: knowledge path and exam path",
     "Implemented",
     "src/ingestion + src/publish (knowledge); src/station + src/session (exam). No exam-path module imports an ingestion module.",
     "Module graph; ingestion never appears in the compileStation call tree"),
    ("2", "Nine-stage processing chain, upload through evaluation",
     "Implemented",
     "ingest() -> applyReview() -> planPublication() -> compileStation() -> createSession() -> evaluate()",
     "acceptance.test.ts test 10 walks the whole chain"),
    ("3", "Canonical data model, 14 logical entities",
     "Implemented + extended",
     "All 14 entities present as branded types. Added: KeyPoint weighting and pitfall flag, SelectionReason, ExtractionRun supersession.",
     "src/domain/types.ts; schema/001_init.sql"),
    ("3", "Counts computed from approved occurrences, never incremented",
     "Implemented",
     "Recount views v_examiner_case_counts / v_examiner_question_counts are the authority behind cached columns; MemoryStore.verifyCounts() asserts no drift.",
     "acceptance.test.ts test 4"),
    ("4.1", "Upload boundary: MIME, size, authorization, server-side key, idempotency",
     "Implemented",
     "ingest() enforces size and format before any parsing; contentHash() drives the partial UNIQUE index on knowledge_document.",
     "schema ux_document_content_hash; EngineError FILE_TOO_LARGE / UNSUPPORTED_FORMAT"),
    ("4.2", "Extraction stages with explicit failure states",
     "Implemented",
     "Parser registry, normalization, segmentation, typed candidate extraction, provenance attachment. Each stage has a distinct error code.",
     "src/ingestion/pipeline.ts; EngineErrorCode union"),
    ("4.2", "OCR_REQUIRED rather than fabricated candidates",
     "Implemented",
     "assessTextQuality() gates on letter ratio and mean token length; failure throws before any candidate is constructed.",
     "acceptance.test.ts test 6"),
    ("4.3", "parseDocument pseudocode, optional semantic extractor",
     "Implemented",
     "Grammar extractor is the system of record; CandidateExtractionProvider is the seam for an optional semantic one.",
     "src/ingestion/extractor.ts"),
    ("4.3", "Parse once, never re-parse during an exam",
     "Implemented",
     "No ingestion code is reachable from the session or evaluation paths.",
     "Import graph"),
    ("5", "Per-entity confidence rules (specialty/examiner/case/question/answer)",
     "Implemented",
     "Specialty: controlled alias map. Examiner: two-gate, exact-only auto-merge. Case: qualifier-conflict rule. Question: 9-step pipeline. Answer: never inferred.",
     "src/resolution/*"),
    ("5", "resolveExaminer -> MATCHED | NEW_CANDIDATE | AMBIGUOUS",
     "Implemented + strengthened",
     "Contract preserved. Added Fellegi-Sunter posterior with per-field log Bayes factors so AMBIGUOUS carries an explanation, plus an EM refiner.",
     "src/resolution/fellegi-sunter.ts"),
    ("5", "Never silently merge two similar examiner names",
     "Implemented",
     "Automatic match requires exact canonical name or registered alias. Every typo variant returns AMBIGUOUS regardless of score.",
     "acceptance.test.ts test 5b: 4 adversarial name pairs, 0 auto-merges"),
    ("5", "Question dedup: 9 steps including optional semantic similarity",
     "Implemented",
     "Steps 1-6 in QuestionDeduplicator; step 5 filled deterministically by concept-set comparison rather than a model.",
     "Cross-language match at lexical similarity 0.000"),
    ("6", "Six candidate states; only PUBLISHED is student-visible",
     "Implemented",
     "Explicit transition table. pathsToPublished() enumerates every route to PUBLISHED for exhaustive assertion.",
     "unit.test.ts SAFETY test"),
    ("6", "Idempotent publication transaction",
     "Implemented",
     "Deterministic occurrence fingerprint + UNIQUE index. Plan/apply split keeps the transaction short.",
     "acceptance.test.ts tests 4 and 10"),
    ("6", "Answer curation separate from historical evidence",
     "Implemented",
     "Uncurated source answers publish as candidates but never become an ExpectedAnswer; evaluationReady stays false.",
     "publisher.ts curatedAnswers gate"),
    ("7", "Station compiler with the five-term selection score",
     "Implemented",
     "All five terms with the framework's weights, configurable via StationPolicy.",
     "src/station/compiler.ts DEFAULT_POLICY"),
    ("7", "Deterministic compilation from a stored seed",
     "Implemented",
     "xoshiro128** seeded PRNG; the session row stores seed and policy version.",
     "acceptance.test.ts: identical seeds give byte-identical stations"),
    ("7", "Log the reason each question was selected",
     "Implemented + extended",
     "SelectionReason persisted per session question as a column, not a log line, so it is queryable.",
     "schema session_question.selection_reason"),
    ("8", "Four session phases; server-owned station",
     "Implemented",
     "Explicit phase machine; preparationEndsAt is an absolute timestamp so a refresh cannot extend it.",
     "src/session/session-service.ts"),
    ("8", "Refresh must not regenerate a different station",
     "Implemented",
     "Question order frozen at creation; the view is rebuilt from persisted rows, never recompiled.",
     "acceptance.test.ts reproducibility group"),
    ("9", "Grounded evaluation, seven steps",
     "Implemented",
     "All seven, with ownership checks ordered so a probe cannot distinguish another student's session from a nonexistent one.",
     "acceptance.test.ts test 8"),
    ("9", "Baseline deterministic scoring",
     "Implemented + extended",
     "Coverage rule preserved. Added key-point weighting, hedge discounting, broader-concept partial credit and pitfall penalties.",
     "src/evaluation/evaluator.ts"),
    ("11", "Key points never reach the client before submission",
     "Implemented",
     "The public view is a whitelist, not a redaction. A test asserts no key-point text appears in the serialized payload.",
     "acceptance.test.ts leak test"),
    ("10.1", "Seven named indexing priorities",
     "Implemented",
     "All seven present, plus a covering index for the compiler pool query and a partial index for the pending review queue.",
     "schema/001_init.sql"),
    ("10.2", "No parsing, dedup or heavy joins on the exam-start path",
     "Verified by measurement",
     "Station compilation p95 is 0.105 ms of an 800 ms budget - 0.01%.",
     "bench/latency.bench.ts"),
    ("10.3", "Async ingestion only when latency evidence justifies it",
     "Deferred, deliberately",
     "Ingesting a 10 KB file costs 32 ms p95. Nowhere near a Worker limit; adding a queue now would add failure modes for no measured gain.",
     "bench: ingest p95 32.10 ms"),
    ("11", "Eight risk controls",
     "Implemented",
     "Duplicate publish, wrong merge, in-memory state, secrets, raw file exposure, evaluation abuse, parser corruption, observability.",
     "See risk register"),
    ("11", "Minimum observability event set",
     "Implemented + extended",
     "Closed typed union so a misspelled event name is a compile error. Tag redaction is an allowlist.",
     "src/observability/events.ts"),
    ("12", "Modular monolith with named services",
     "Implemented",
     "Directory structure maps one-to-one onto the framework's recommended module tree.",
     "src/ layout"),
    ("12", "P0/P1/P2 improvements",
     "P0 and P1 complete; P2 seams in place",
     "P0: boundaries, indexes, idempotent fingerprints. P1: versioned extraction, selection-reason logging. P2: provider interfaces exist and are unused.",
     "See roadmap"),
    ("13", "Four service contracts",
     "Implemented",
     "OsceKnowledgeRepository (as KnowledgeSource), StationCompiler, AnswerEvaluationProvider, CandidateExtractionProvider.",
     "src/station/compiler.ts, src/evaluation/evaluator.ts, src/ingestion/extractor.ts"),
    ("14", "Ten acceptance tests",
     "Implemented as executable tests",
     "All ten, plus a fifth-and-a-half adversarial examiner-merge test and four reproducibility tests.",
     "test/acceptance.test.ts, 15 tests passing"),
    ("15", "Phase A-D roadmap",
     "Phases A-C complete; D scoped",
     "Baseline measurement, data-integrity hardening and performance hardening are done. Phase D needs a real labelled corpus.",
     "See roadmap"),
]

# ---------------------------------------------------------------------------
# 2. Competitive comparison
# ---------------------------------------------------------------------------

COMPETITORS = [
    {
        "name": "This engine (V2)",
        "category": "Purpose-built OSCE knowledge engine",
        "kind": "In-house",
        "notes": "Historical examiner-case-question provenance as the core asset.",
    },
    {
        "name": "Speedwell eSystem",
        "category": "Institutional OSCE delivery",
        "kind": "Commercial",
        "notes": "Examiner tablet marking, offline app, multi-day circuits, mandatory feedback fields, incomplete-marksheet blocking.",
    },
    {
        "name": "ExamSoft",
        "category": "Institutional assessment + item banking",
        "kind": "Commercial",
        "notes": "Item banking with category tagging, OSCE case inventories, controlled delivery, psychometric reporting.",
    },
    {
        "name": "TAO (OAT)",
        "category": "Open-source assessment platform",
        "kind": "Open source",
        "notes": "Only QTI-native open-source authoring, item banking and test assembly; certified in all four QTI categories; LTI integration.",
    },
    {
        "name": "Moodle Quiz engine",
        "category": "LMS assessment subsystem",
        "kind": "Open source",
        "notes": "question_attempt as an append-only step history; question bank versioning; usage-by-activity abstraction.",
    },
    {
        "name": "Geeky Medics / OSCEstop",
        "category": "OSCE revision content",
        "kind": "Commercial / free",
        "notes": "1300+ authored stations, checklists, mark schemes, circuit builder, AI virtual patients and AI examiner feedback.",
    },
    {
        "name": "UWorld / AMBOSS",
        "category": "Medical question bank",
        "kind": "Commercial",
        "notes": "Large authored MCQ banks with explanations, performance analytics and IRT-informed difficulty.",
    },
    {
        "name": "Docling / Unstructured.io",
        "category": "Document ingestion",
        "kind": "Open source",
        "notes": "Docling: IBM Research layout models, ~97.9% complex-table accuracy, CPU-efficient. Unstructured: 30+ formats, RAG chunking.",
    },
    {
        "name": "Splink (MoJ)",
        "category": "Entity resolution",
        "kind": "Open source",
        "notes": "Fellegi-Sunter with EM parameter estimation; 1M records in under two minutes on DuckDB; 100M+ on Spark.",
    },
    {
        "name": "ETS c-rater / m-rater",
        "category": "Automated short-answer scoring",
        "kind": "Commercial / research",
        "notes": "Concept-based scoring against rubric-derived model answers; the reference implementation of key-point ASAG.",
    },
    {
        "name": "LLM-judge ASAG (2024-2026)",
        "category": "Automated short-answer scoring",
        "kind": "Research / commercial",
        "notes": "GPT-class models with rubric prompting; strong on paraphrase, non-deterministic even at near-zero temperature.",
    },
]

# capability, then per-competitor rating: Full / Partial / None / N/A, plus a note
CAPABILITY_MATRIX = [
    ("Historical examiner attribution as a first-class entity",
     ["Full", "Partial", "Partial", "None", "None", "None", "None", "N/A", "N/A", "N/A", "N/A"],
     "Peers model examiners as markers, not as the historical identity a question belongs to. This is the differentiating asset."),
    ("Provenance from student answer back to source file span",
     ["Full", "Partial", "Partial", "Partial", "Partial", "None", "None", "Partial", "N/A", "None", "None"],
     "Delivery platforms trace to an item; this traces to the page, line and character offset of the upload that evidenced it."),
    ("Ingests unstructured historical recall material",
     ["Full", "None", "None", "None", "None", "None", "None", "Full", "N/A", "N/A", "Partial"],
     "Commercial OSCE platforms assume authored content. Document parsers ingest but do not resolve identity."),
    ("Human review gate before student visibility",
     ["Full", "Full", "Full", "Full", "Full", "Full", "Full", "None", "N/A", "N/A", "None"],
     "Parity with institutional platforms; ahead of pure ingestion tooling."),
    ("Probabilistic entity resolution with explainable weights",
     ["Full", "None", "None", "None", "None", "None", "None", "None", "Full", "N/A", "None"],
     "Splink is the reference; this implements the same Fellegi-Sunter model plus a deterministic authority gate."),
    ("Zero-tolerance guarantee on wrong identity merges",
     ["Full", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "Partial", "N/A", "None"],
     "Splink is purely probabilistic, so its false-merge rate is nonzero by construction. The authority gate makes ours structural."),
    ("Cross-language semantic answer matching",
     ["Full", "None", "None", "None", "None", "Partial", "None", "N/A", "N/A", "Partial", "Full"],
     "Achieved here without a model, via concept identifiers. LLM judges do this too, non-deterministically."),
    ("Deterministic, reproducible grading",
     ["Full", "Full", "Full", "Full", "Full", "None", "Full", "N/A", "N/A", "Full", "None"],
     "Checklist-based platforms are deterministic because they only score checkboxes. This is deterministic on free text."),
    ("Free-text answer grading",
     ["Full", "Partial", "Partial", "Partial", "Partial", "Partial", "None", "N/A", "N/A", "Full", "Full"],
     "Peer platforms grade free text manually or with an LLM. This grades it deterministically against approved key points."),
    ("Negation-aware scoring",
     ["Full", "None", "None", "None", "None", "None", "None", "N/A", "N/A", "Partial", "Partial"],
     "'No evidence of DVT' must not score as covering DVT. Rare outside clinical NLP research."),
    ("Explains every mark to the student",
     ["Full", "Partial", "Partial", "Partial", "Partial", "Partial", "Partial", "N/A", "N/A", "Full", "None"],
     "Names the matched key point, the surface form, and the match mechanism."),
    ("Reproducible exam assembly from a stored seed",
     ["Full", "None", "Partial", "Partial", "Partial", "None", "None", "N/A", "N/A", "N/A", "N/A"],
     "Most platforms store the assembled form; this stores the seed that generates it, which is smaller and replayable."),
    ("Online item difficulty calibration",
     ["Full", "Partial", "Full", "Full", "Partial", "None", "Full", "N/A", "N/A", "N/A", "N/A"],
     "Elo/Rasch online updates; commercial banks use batch IRT, which needs far more responses before it is usable."),
    ("QTI / LTI standards interoperability",
     ["None", "Partial", "Full", "Full", "Partial", "None", "None", "N/A", "N/A", "N/A", "N/A"],
     "The clearest gap. TAO is certified in all four QTI categories; this engine exports nothing standard yet."),
    ("Runs at the edge with no server fleet",
     ["Full", "None", "None", "None", "None", "Partial", "Partial", "None", "None", "None", "None"],
     "Zero-dependency TypeScript on Workers/D1/R2; peers are JVM, PHP or Python server deployments."),
    ("Zero per-evaluation marginal cost",
     ["Full", "Full", "Full", "Full", "Full", "Partial", "Full", "Partial", "Full", "None", "None"],
     "No inference call on any path."),
    ("Institutional circuit / multi-station logistics",
     ["None", "Full", "Full", "Partial", "None", "Full", "None", "N/A", "N/A", "N/A", "N/A"],
     "Out of scope: this is a single-student practice engine, not an exam-day delivery system."),
    ("Examiner tablet marking and offline capture",
     ["None", "Full", "Full", "Partial", "None", "None", "None", "N/A", "N/A", "N/A", "N/A"],
     "Out of scope for the same reason."),
    ("Scanned-document OCR",
     ["None", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "Full", "N/A", "N/A", "N/A"],
     "Detected and refused rather than handled. An OCR adapter is a registry entry, not a redesign."),
    ("Handles paraphrase outside a curated vocabulary",
     ["Partial", "None", "None", "None", "None", "Partial", "None", "N/A", "N/A", "Partial", "Full"],
     "The honest limitation. Recall is bounded by vocabulary coverage; misses are reported, not silent."),
]

# ---------------------------------------------------------------------------
# 3. Deterministic vs LLM decision record
# ---------------------------------------------------------------------------

DETERMINISM_MATRIX = [
    ("Reproducibility",
     "Same input gives the same output on every runtime and deploy.",
     "Not guaranteed even at temperature 0; sampling and model updates both break it.",
     "Decisive for an exam system. A student re-running a station must see the same station."),
    ("Explainability of a mark",
     "'You wrote DVT, a listed form of the key point deep vein thrombosis.'",
     "'The model judged the point covered.'",
     "Decisive. Disputed marks are inevitable and must be answerable."),
    ("Fabrication risk",
     "Structurally impossible: a candidate without a source span cannot be constructed.",
     "A known and well-documented failure mode.",
     "Decisive. The framework requires zero fabricated candidates from a scanned PDF."),
    ("Fixing a wrong result",
     "Edit one vocabulary row; the effect is immediate, bounded and testable.",
     "Change a prompt; the effect is unbounded and can regress unrelated cases.",
     "Strongly favours deterministic for a system a non-engineer owns."),
    ("Latency",
     "0.36 ms p95 measured for evaluation.",
     "Typically 300-2000 ms per call plus retries.",
     "Decisive against the framework's 300 ms budget."),
    ("Marginal cost",
     "Zero.",
     "Per-call charge on every student answer.",
     "Material at student-population scale."),
    ("Handling paraphrase",
     "Bounded by vocabulary coverage; misses are reported in unmatchedTerms.",
     "Strong; this is the genuine LLM advantage.",
     "The one dimension where the LLM wins outright."),
    ("Enumerating blind spots",
     "Yes - they are the vocabulary's gaps, and they are logged.",
     "No.",
     "Favours deterministic for a system that must improve measurably."),
    ("Offline / air-gapped operation",
     "Full.",
     "Requires network egress to a provider.",
     "Relevant for institutional deployment constraints."),
    ("Cold-start quality with no curated data",
     "Weak - the vocabulary must be seeded.",
     "Strong immediately.",
     "Favours LLM at day zero; the gap closes as the vocabulary grows."),
]

# ---------------------------------------------------------------------------
# 4. Acceptance tests
# ---------------------------------------------------------------------------

ACCEPTANCE = [
    ("1", "Random Pediatrics station", "Examiner belongs to specialty; case linked to examiner",
     "PASS", "200 randomized compilations; every examiner, case and question re-verified against the published link set"),
    ("2", "Manual examiner", "Selected examiner never changes",
     "PASS", "100 compilations hold the examiner fixed; a cross-specialty selection raises EXAMINER_SPECIALTY_MISMATCH rather than substituting"),
    ("3", "Pending candidate", "Never visible to student repository",
     "PASS", "An unlinked question is absent from the pool and from 50 randomized stations"),
    ("4", "Duplicate re-publish", "Observation count does not inflate",
     "PASS", "Three inserts of an identical fingerprint yield count 1; a different offset is correctly a distinct occurrence"),
    ("5", "Ambiguous examiner", "Publication blocked until resolved",
     "PASS", "planPublication raises AMBIGUOUS_EXAMINER when a segment has no resolved identity"),
    ("5b", "Adversarial name pairs", "No silent merge of similar examiner names",
     "PASS", "4 adversarial probes including Hassan/Hussein: 0 auto-merges; exact canonical and registered alias still match"),
    ("6", "Scanned PDF", "OCR_REQUIRED; zero fabricated candidates",
     "PASS", "CID-encoded garbage raises OCR_REQUIRED before any candidate is constructed"),
    ("7", "Evaluation-ready partial answer", "PARTIAL with only approved missing points",
     "PASS", "Every reported covered and missing id is checked to be a member of the approved key"),
    ("8", "Invalid session question", "Evaluation rejected",
     "PASS", "Foreign question, wrong student, inactive phase and double submission all rejected with distinct codes"),
    ("9", "Evaluator failure", "Student can self-score and finish",
     "PASS", "Questions without an approved key report evaluationReady false and complete under SELF scoring"),
    ("10", "New daily upload", "Published knowledge appears with no redeploy",
     "PASS", "Full ingest-review-publish walk; replay produces zero new occurrences and recognises every fingerprint"),
]

# ---------------------------------------------------------------------------
# 5. KPIs and measured performance
# ---------------------------------------------------------------------------

KPIS = [
    ("Station creation p95", "< 800 ms", "0.105 ms (engine CPU)", "PASS",
     "0.01% of budget consumed by compute; remainder available for D1 round trips"),
    ("Evaluation API p95 (deterministic)", "< 300 ms", "0.356 ms (engine CPU)", "PASS",
     "0.12% of budget"),
    ("Next question client transition p95", "< 150 ms", "0 ms engine cost", "PASS",
     "Order is precompiled and persisted; no engine work occurs on transition"),
    ("Upload acknowledgement p95", "< 1.5 s", "32.1 ms for a 10 KB file", "PASS",
     "2.1% of budget; supports synchronous ingestion without a queue"),
    ("Admin candidate list p95", "< 800 ms", "Not measured (I/O bound)", "By design",
     "Keyset-paginated index ix_candidate_review_queue; requires a live D1 to measure"),
    ("Extraction candidate precision after review", ">= 90%", "Not yet measurable", "Blocked",
     "Requires a labelled corpus of real OSCE files. Instrumentation is in place"),
    ("Incorrect examiner auto-merge", "0 tolerated", "0", "PASS",
     "Structural: automatic match requires exact canonical or alias. Verified against 4 adversarial pairs"),
    ("Station creation failure rate", "< 0.5%", "0 in 350 compilations", "PASS",
     "All failures are typed and deliberate (no published examiner, insufficient questions)"),
    ("Duplicate publish incidents", "0", "0", "PASS",
     "UNIQUE (fingerprint) plus plan-level deduplication"),
    ("Dynamic publication delay after reviewer action", "< 5 s", "Not measured (I/O bound)", "By design",
     "Plan/apply split keeps the transaction to a single round trip"),
    ("Browser console core errors", "0", "N/A", "Out of scope",
     "This deliverable is the engine, not the client"),
]

BENCHMARKS = [
    ("Station compilation (random, 5 questions)", "7,200 questions / 19,800 occurrences", 0.046, 0.105, 0.176, 2000),
    ("Answer evaluation (6 key points, mixed languages)", "5 representative answers", 0.209, 0.356, 0.581, 5000),
    ("Question dedup lookup", "5,000-question corpus", 0.130, 1.437, 1.992, 2000),
    ("Examiner resolution (realistic names)", "3,000 examiners, 970 blocking buckets", 2.057, 6.977, 8.270, 3000),
    ("Examiner resolution (degenerate blocking)", "3,000 examiners, 4 buckets", 17.539, 20.252, 24.774, 300),
    ("Ingestion of a 10 KB recall file", "40 examiner blocks, 120 questions", 21.990, 32.103, 34.689, 200),
]

# ---------------------------------------------------------------------------
# 6. Risk register
# ---------------------------------------------------------------------------

RISKS = [
    ("R1", "Duplicate publish inflates observation counts", "Data integrity", "High", "Low",
     "Deterministic fingerprint + UNIQUE index + plan-level dedup + derived recount views",
     "Closed", "acceptance test 4"),
    ("R2", "Wrong examiner merge corrupts the historical asset", "Data integrity", "Critical", "Low",
     "Two-gate resolution; automatic match requires exact canonical or registered alias",
     "Closed", "acceptance test 5b"),
    ("R3", "Correctness-critical in-memory state lost on Worker restart", "Reliability", "High", "Low",
     "No engine module holds mutable cross-request state; indexes are built per batch and passed in",
     "Closed", "ExaminerResolver.buildIndex is static and returns the index"),
    ("R4", "Approved key points leak to the client before submission", "Security", "Critical", "Low",
     "Public view is a whitelist; a test asserts no key-point text appears in the payload",
     "Closed", "acceptance leak test"),
    ("R5", "Evaluation abuse via forged question identifiers", "Security", "High", "Low",
     "Evaluation addressed by sessionQuestionId only; ownership checked before anything is revealed",
     "Closed", "acceptance test 8"),
    ("R6", "Silent parser corruption after an extractor change", "Data integrity", "High", "Medium",
     "Versioned extraction runs; reprocessing supersedes rather than mutates and refuses an unchanged version",
     "Closed", "reprocess() EXTRACTOR_VERSION_CONFLICT"),
    ("R7", "Vocabulary coverage limits evaluation recall", "Content quality", "Medium", "High",
     "unmatchedTerms reported on every evaluation; confidence score falls as unrecognised terms rise",
     "Managed", "The accepted cost of determinism; converted into a reviewer work queue"),
    ("R8", "Examiner blocking degrades as the corpus grows", "Performance", "Medium", "Medium",
     "Measured, not assumed: 970 buckets at 3,000 examiners with a 910-record maximum",
     "Accepted, monitored", "Fix is a compound blocking key; one function in phonetic.ts"),
    ("R9", "Thresholds tuned on a small labelled set", "Content quality", "Medium", "High",
     "calibrateThreshold ships with the engine; thresholds are configuration, not constants",
     "Managed", "Re-run per corpus; margin 0.198 on the reference set"),
    ("R10", "No QTI/LTI export limits institutional adoption", "Interoperability", "Medium", "Medium",
     "Domain model is a superset of QTI's item model; export is additive",
     "Open", "Roadmap item P2"),
    ("R11", "Arabic normalization folds a clinically meaningful distinction", "Content quality", "High", "Low",
     "Aggressive folding applies only to comparison keys; stored text uses the conservative level",
     "Closed", "normalizeForDisplay / normalizeForMatching separation, idempotence tested"),
    ("R12", "Scanned uploads cannot be processed at all", "Coverage", "Medium", "High",
     "Detected and refused with OCR_REQUIRED rather than silently mis-parsed",
     "Open", "OCR adapter is a parser-registry entry"),
]

# ---------------------------------------------------------------------------
# 7. Roadmap
# ---------------------------------------------------------------------------

ROADMAP = [
    ("Phase A", "Baseline measurement", "Complete",
     "Latency profiled, entity map generated, one document traced end to end, in-memory state audited, structured logging added",
     "bench/latency.bench.ts; acceptance test 10"),
    ("Phase B", "Data integrity hardening", "Complete",
     "Unique constraints and stable fingerprints, centralized resolution policy, derived counts, versioned extraction runs",
     "schema/001_init.sql; src/resolution; src/publish"),
    ("Phase C", "Performance hardening", "Complete",
     "All Section 10.1 indexes plus covering and partial indexes; no parsing on the exam path; order compiled once; keyset pagination",
     "Measured: 0.01% of the station-creation budget"),
    ("Phase D.1", "Labelled corpus benchmark", "Next",
     "Label 300-500 real recall segments; measure extraction precision and recall per field; publish the confusion table",
     "Unblocks the >=90% precision KPI"),
    ("Phase D.2", "Threshold recalibration on real data", "Next",
     "Run calibrateThreshold against reviewer merge decisions; pin the operating point in policy",
     "Replaces reference-set thresholds with corpus-fitted ones"),
    ("Phase D.3", "Fellegi-Sunter EM fitting", "Next",
     "Replace informed m/u priors with EM estimates once labelled pairs exist; refineWithEm already ships",
     "Narrows the AMBIGUOUS band, reducing reviewer load without weakening the authority gate"),
    ("Phase D.4", "Vocabulary expansion loop", "Continuous",
     "Aggregate unmatchedTerms weekly; add recurring terms; track evaluation recall as the metric",
     "The mechanism that lifts the determinism ceiling over time"),
    ("Phase E.1", "OCR parser adapter", "Backlog",
     "Register an OCR-backed pdf parser; scanned uploads become ingestible instead of refused",
     "Registry entry, not a redesign"),
    ("Phase E.2", "QTI 3.0 export", "Backlog",
     "Export published questions and answer keys as QTI items for institutional interoperability",
     "Closes the clearest gap against TAO and ExamSoft"),
    ("Phase E.3", "Compound blocking key", "Backlog, triggered",
     "Switch to a given+family compound key when the largest blocking bucket exceeds ~2,000 records",
     "Trigger condition is measurable from ExaminerIndex.stats"),
    ("Phase E.4", "Optional semantic adapter", "Backlog, conditional",
     "Add a semantic provider behind the existing interfaces for the residue the vocabulary misses - never on the critical path",
     "Only after Phase D.1 quantifies what the residue actually is"),
]

# ---------------------------------------------------------------------------
# 8. Evidence index
# ---------------------------------------------------------------------------

EVIDENCE = [
    ("Test suite", "93 tests, 0 failures", "node --test, Node 22.22.2", "npm test"),
    ("Type safety", "Clean under strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes", "TypeScript 5.6", "npm run typecheck"),
    ("Acceptance", "15 tests covering all 10 framework invariants plus reproducibility", "test/acceptance.test.ts", "npm run test:acceptance"),
    ("Latency", "6 operations profiled at p50/p95/p99", "bench/latency.bench.ts", "npm run bench"),
    ("Hash correctness", "FNV-1a 64 verified against 4 published vectors", "unit.test.ts", "npm test"),
    ("Metric separation", "same-question 0.826-0.946 vs different-question 0.128-0.627", "unit.test.ts", "npm test"),
    ("Threshold calibration", "precision 1.0, recall 1.0, margin 0.198 on the reference set", "calibrateThreshold", "npm test"),
    ("Cross-language matching", "English/Arabic question matched at lexical similarity 0.000 via concept set", "question-dedup", "manual probe"),
    ("Merge safety", "0 auto-merges across 4 adversarial name pairs", "acceptance test 5b", "npm run test:acceptance"),
]

CODE_STATS = [
    ("Domain model", 4, "Branded IDs, error taxonomy, FNV-1a fingerprints, ULIDs"),
    ("Text and NLP", 7, "Normalization, tokenizer, similarity, phonetics, SimHash/MinHash, lexicon, negation"),
    ("Ingestion", 5, "Parser registry, segmenter, extractor, pipeline, index"),
    ("Resolution", 5, "Fellegi-Sunter, examiner, case, question dedup, index"),
    ("Review and publish", 2, "State machine, publication planner"),
    ("Station and session", 3, "Seeded PRNG, compiler, session service"),
    ("Evaluation", 1, "Deterministic grounded evaluator"),
    ("Psychometrics", 1, "Elo, Wilson, point-biserial, diagnostics"),
    ("Observability", 1, "Typed events, redaction, latency, KPI targets"),
    ("Adapters and schema", 2, "In-memory store, D1/SQLite DDL"),
    ("Tests and benchmark", 4, "Acceptance, unit, helpers, latency benchmark"),
]

SOURCES = [
    ("Speedwell eSystem - OSCE exam software", "https://www.speedwellsoftware.com/exam-software/osce-exams/"),
    ("Speedwell - OSCE marking and feedback", "https://www.speedwellsoftware.com/enhance-osces-marking-and-feedback/"),
    ("TAO - open-source QTI-native assessment platform", "https://www.taotesting.com/products/"),
    ("TAO - QTI compliance in all four categories", "https://www.taotesting.com/news/oat-announces-qti-compliance-for-its-tao-open-source-assessment-platform/"),
    ("Moodle - overview of the question engine", "https://docs.moodle.org/dev/Overview_of_the_Moodle_question_engine"),
    ("Moodle - Questions API", "https://moodledev.io/docs/5.0/apis/subsystems/question"),
    ("1EdTech - QTI v3.0 overview", "https://www.imsglobal.org/spec/qti/v3p0/oview"),
    ("1EdTech - xAPI and Caliper comparison", "https://www.imsglobal.org/initial-xapicaliper-comparison"),
    ("Geeky Medics - OSCE station bank", "https://geekymedics.com/osce-stations/"),
    ("OSCEstop - OSCE revision", "https://oscestop.education/"),
    ("Splink - probabilistic vs deterministic linkage", "https://moj-analytical-services.github.io/splink/topic_guides/theory/probabilistic_vs_deterministic.html"),
    ("Splink - fuzzy matching at scale", "https://www.robinlinacre.com/introducing_splink/"),
    ("Heuristic negation detection for clinical text (NegEx/ConText lineage)", "https://pmc.ncbi.nlm.nih.gov/articles/PMC7910278/"),
    ("DEEPEN - dependency-aware extension of NegEx", "https://www.sciencedirect.com/science/article/pii/S153204641500043X"),
    ("Elo rating in adaptive educational systems", "https://www.sciencedirect.com/science/article/abs/pii/S036013151630080X"),
    ("On-the-fly IRT parameter estimation in adaptive learning", "https://link.springer.com/article/10.3758/s13428-022-01953-x"),
    ("Automatic short answer grading in the LLM era", "https://dl.acm.org/doi/full/10.1145/3706468.3706481"),
    ("Quality-conditioned agreement in automated short answer scoring", "https://arxiv.org/pdf/2605.07647"),
    ("Docling - advanced layout analysis models", "https://arxiv.org/pdf/2509.11720"),
    ("Cloudflare Workers - platform limits", "https://developers.cloudflare.com/workers/platform/limits"),
    ("Anki - spaced repetition algorithm (FSRS)", "https://faqs.ankiweb.net/what-spaced-repetition-algorithm"),
]

# ---------------------------------------------------------------------------
# 9. Code review of the shipped implementation
#
# Added after the handoff package was supplied. Findings are against the code
# in osce-engineer-handoff-final-2026-08-29, read but never modified.
# ---------------------------------------------------------------------------

SHIPPED_META = {
    "package": "osce-engineer-handoff-final-2026-08-29",
    "stack": "Next 16 / React 19 on vinext + Cloudflare Workers, D1, R2, Drizzle migrations, Zod, pdfjs-dist",
    "files_reviewed": 52,
    "core_modules": "lib/evaluation.ts, lib/knowledge/{extractor,normalization,domain,db}.ts, app/api/**, drizzle/0001-0004",
    "state": "Validated locally; Cloudflare cutover deliberately halted by the owner. Production remains the ChatGPT-hosted site.",
}

# What the shipped code already does well. Stated first because it is true and
# because a review that only lists faults is not a review.
SHIPPED_STRENGTHS = [
    ("Deterministic by default already",
     "DeterministicExtractionProvider and DeterministicAnswerEvaluationProvider are rule-based, with the AI "
     "adapters left as unimplemented interfaces. The no-AI goal was already the shipped position, not a "
     "retrofit."),
    ("Ownership enforced in SQL, not in application code",
     "The evaluate route resolves the question through a single join across exam_sessions, "
     "exam_session_questions, published_questions and examiner_questions, matching both examiner and case. "
     "A forged question id cannot resolve. This is better than an application-layer check and matches the "
     "framework's session-ownership requirement exactly."),
    ("OCR_REQUIRED is real, not aspirational",
     "extractText throws OCR_REQUIRED when a PDF yields no page text, before any candidate is constructed. "
     "The framework's zero-fabricated-candidates test genuinely passes."),
    ("A non-obvious Workers problem solved properly",
     "pdfjs-dist reads DOMMatrix at module evaluation time, which Workers do not provide. The handoff includes "
     "a minimal affine-transform polyfill rather than abandoning PDF support or pulling in a canvas shim. "
     "This is the single most competent piece of engineering in the package."),
    ("Schema-level integrity where it was thought about",
     "UNIQUE(session_id, question_order) freezes question order; UNIQUE(document_id, extractor_version) "
     "versions extraction runs; UNIQUE(session_id, session_question_id) is present on answers. Index coverage "
     "matches most of the framework's section 10.1 list."),
    ("Answer approval gates automatic scoring",
     "The evaluate route refuses to score unless answer_approved is set and a reference answer exists, "
     "returning AI_EVALUATION_UNAVAILABLE so the client falls back to self-scoring. The curation boundary "
     "holds."),
    ("Runtime schema validation on extraction output",
     "Zod parses every candidate before it is persisted, so a malformed extraction fails loudly rather than "
     "writing partial rows."),
]

# (id, severity, area, finding, why it matters, fix)
SHIPPED_FINDINGS = [
    ("F1", "Critical", "Evaluation",
     "Key-point matching is a raw substring test: answer.includes(point). No negation handling, no synonyms, "
     "no abbreviations, no cross-language, no typo tolerance, no word boundaries.",
     "Measured against a reviewer on ten representative answers, this agrees 1 time in 10. Three of the nine "
     "disagreements award marks for answers a reviewer would penalise, including 'there is no evidence of "
     "deep vein thrombosis', which scores as fully CORRECT.",
     "Replace with the V2 evaluator. Same interface, same synchronous call, no new dependency."),
    ("F2", "Critical", "Assessment integrity",
     "Answers are written with INSERT OR REPLACE against a UNIQUE(session_id, session_question_id) key, and "
     "no route checks whether an answer already exists.",
     "A student can submit, read the returned score and covered/missing points, then resubmit an improved "
     "answer to the same question - unlimited attempts with full feedback between them. The results table "
     "records only the last attempt, so the record shows a clean first-time pass.",
     "Change to INSERT and return ALREADY_ANSWERED on conflict, or add an attempt column and score only the "
     "first. One statement."),
    ("F3", "High", "Data integrity",
     "question_occurrences has no fingerprint column and no UNIQUE constraint, and observation_count is a "
     "stored column on examiner_cases / examiner_questions.",
     "The framework's acceptance test 4 - re-publishing a document must not inflate observation counts - is "
     "not enforced anywhere in the schema. If counts are incremented rather than recomputed, a reprocess "
     "silently doubles every 'asked N times' figure, which is the number the whole product is built on.",
     "Add a deterministic fingerprint column with a UNIQUE index, and recompute counts from occurrences "
     "rather than incrementing. Migration 0005 plus the publisher change."),
    ("F4", "High", "Security",
     "exam_sessions has no student_id column, and no route associates a session with a user.",
     "Session ownership cannot be verified. Any party holding a session id can submit answers to it and read "
     "the scores back. Ids are UUIDv4 so this is capability-URL security, which is defensible for an "
     "anonymous practice tool - but it must be a decision, not an accident, and it blocks per-student "
     "history, progress tracking and any future paid tier.",
     "Add student_id to exam_sessions and filter on it in every session query."),
    ("F5", "Medium", "Security",
     "requireAdmin compares the admin token with !==, a non-constant-time comparison.",
     "Leaks token content through timing. Remote timing attacks over HTTP are noisy and this is not the most "
     "likely attack path, but the fix is four lines and there is no reason to leave it.",
     "Compare with a constant-time equality over the encoded bytes."),
    ("F6", "Medium", "Evaluation",
     "normalizeQuestion hardcodes a single abbreviation expansion in code: /\\bns\\b/ -> 'nephrotic syndrome'.",
     "This is the vocabulary idea, implemented for exactly one term and located in source rather than data. "
     "Every additional abbreviation needs a code change and a redeploy, which means in practice none get "
     "added.",
     "Move to the data-driven concept vocabulary; a medical reviewer then edits terms without an engineer."),
    ("F7", "Medium", "Extraction",
     "Question detection fires on any bulleted or numbered line, or any line ending in '?'. Answer lines are "
     "not recognised as a distinct kind, and the candidate schema's answer field is never populated.",
     "A source file listing answers as bullets under each question turns every answer into a question "
     "candidate. The reviewer must reject them by hand, and extraction precision measured against the "
     "framework's 90% KPI is depressed by an artefact of the parser rather than by the material.",
     "Add an ANSWER line rule ahead of the bullet rule, and attach answers to the preceding question."),
    ("F8", "Medium", "Extraction",
     "Category inference uses unanchored regexes on raw text: /investigation|order/i, /complication/i, "
     "/admit|severity/i.",
     "Same class of defect as F1. 'in order to' matches the INVESTIGATION rule. Category feeds station "
     "composition, so a mis-categorised question skews the diversity of every station it appears in.",
     "Match on tokenised whole words, as the V2 extractor does."),
    ("F9", "Medium", "Extraction",
     "examiner, caseTitle and year are mutable variables carried forward across the whole document, and "
     "specialty is resolved once for the entire file.",
     "A question appearing before the first examiner line is attributed to undefined; a question after a "
     "section break inherits the previous examiner. In a multi-specialty or multi-examiner file this "
     "mis-attributes questions to the wrong examiner, which is the exact corruption the framework's core "
     "invariant exists to prevent.",
     "Segment the document first, then extract within each segment, as the V2 segmenter does."),
    ("F10", "Low", "Data model",
     "exam_session_answers.confidence is declared TEXT and written with String(result.confidence).",
     "The column cannot be aggregated or compared numerically without a cast, so evaluator-confidence "
     "reporting - one of the framework's suggested quality metrics - is unavailable without a migration.",
     "Declare REAL and store the number."),
    ("F11", "Low", "Consistency",
     "exam_sessions.status defaults to 'ACTIVE', but the ExamStatus type in lib/osce-engine.ts is "
     "CREATED | PREPARATION | QUESTIONING | COMPLETED. 'ACTIVE' is not a member of the type.",
     "The type and the database disagree about the state vocabulary, so the framework's four-phase session "
     "machine is not actually represented in storage. Preparation timing is not enforced server-side either: "
     "routes check only status = 'ACTIVE'.",
     "Align the column with the type and check preparation_ends_at before accepting answers."),
    ("F12", "Low", "Assessment integrity",
     "The self-score route accepts both correctness and score from the client with no cross-check.",
     "A client can post correctness CORRECT with score 0, or INCORRECT with score 1. Self-scored results are "
     "student-declared by design, but internally inconsistent rows make the results table hard to trust for "
     "any later analysis.",
     "Derive score from correctness server-side, or reject rows where they disagree."),
]

# The measured head-to-head, from docs/compare_evaluators.ts
EVALUATOR_COMPARISON = [
    ("Exact wording, all four points", "wound infection, bleeding, deep vein thrombosis, adhesions",
     "CORRECT", "CORRECT", "CORRECT", "Both agree"),
    ("Standard abbreviation", "... DVT ...",
     "CORRECT", "PARTIAL", "CORRECT", "Shipped under-marks: DVT is not a substring of the key point"),
    ("Negated mention", "... but there is no evidence of deep vein thrombosis",
     "PARTIAL", "CORRECT", "PARTIAL", "Shipped over-marks: credits a point the student explicitly excluded"),
    ("Arabic answer, English key", "التهاب الجرح، نزف، جلطة وريدية عميقة، التصاقات",
     "CORRECT", "INCORRECT", "CORRECT", "Shipped scores a fully correct bilingual answer as zero"),
    ("Spelling errors", "wond infecton, bleding, ...",
     "CORRECT", "PARTIAL", "CORRECT", "Shipped under-marks two of four points for typos"),
    ("British spelling variant", "... haemorrhage ...",
     "CORRECT", "PARTIAL", "CORRECT", "Shipped under-marks: haemorrhage is not a substring of bleeding"),
    ("Singular vs plural key", "... adhesion",
     "CORRECT", "PARTIAL", "CORRECT", "Shipped under-marks on inflection alone"),
    ("Substring false positive", "the patient has intestinal obstruction seen on ultrasound",
     "PARTIAL", "CORRECT", "PARTIAL", "Shipped over-marks: 'inTESTinal' contains the key point 'test'"),
    ("Hedged mention", "possibly deep vein thrombosis",
     "PARTIAL", "CORRECT", "PARTIAL", "Shipped over-marks: hedge treated as assertion"),
    ("Broader but true answer", "thrombosis",
     "PARTIAL", "INCORRECT", "PARTIAL", "Shipped gives zero for a true but less specific answer"),
]

EVALUATOR_SCORE = {"shipped": 1, "v2": 10, "total": 10}

# Migration path from the shipped code to the V2 engine.
MIGRATION_STEPS = [
    ("M1", "Swap the evaluator", "1 file, ~20 lines", "None",
     "DeterministicEvaluator implements the same shape as AnswerEvaluationProvider. Key points become "
     "objects rather than strings, which the existing key_points_json column already accommodates.",
     "Fixes F1. Reviewer agreement moves from 1/10 to 10/10 on the measured set."),
    ("M2", "Block resubmission", "1 statement", "None",
     "Change INSERT OR REPLACE to INSERT and return ALREADY_ANSWERED on the unique-constraint violation.",
     "Fixes F2. Closes the unlimited-attempts-with-feedback hole."),
    ("M3", "Add occurrence fingerprints", "1 migration + publisher change", "Additive migration 0005",
     "Add fingerprint TEXT with a UNIQUE index; backfill by recomputing from existing rows; recompute counts "
     "from occurrences rather than incrementing.",
     "Fixes F3. Makes the framework's idempotency acceptance test structurally true."),
    ("M4", "Add student ownership", "1 migration + route filters", "Additive migration 0006",
     "Add student_id to exam_sessions, populate from the session cookie, filter every session query on it.",
     "Fixes F4. Also unlocks per-student history."),
    ("M5", "Replace the extractor", "1 file", "None",
     "The V2 segmenter and extractor produce the same candidate shape, with answer lines recognised and "
     "per-segment examiner attribution.",
     "Fixes F7, F8 and F9 together. This is the change that most affects the extraction-precision KPI."),
    ("M6", "Move the vocabulary to data", "1 table or 1 JSON asset", "Optional migration",
     "Replace the hardcoded 'ns' expansion with the concept vocabulary, editable by a reviewer.",
     "Fixes F6 and lifts the evaluator's recall ceiling over time without engineering work."),
    ("M7", "Tidy the small ones", "~30 lines total", "Additive migration 0007",
     "Constant-time token comparison, confidence as REAL, session status vocabulary aligned with the type, "
     "server-derived self-score.",
     "Fixes F5, F10, F11, F12."),
]

