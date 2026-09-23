# Obesity & Healthy Lifestyle Platform

A free, patient-first obesity and healthy-lifestyle app, with structured
specialist follow-up and curated nearby partners.

> **Status: P0 (product truth freeze).** There is no code yet. P1 (Free
> Patient Core) starts once the P1 rows of the
> [blocking decisions](DECISIONS.md#blocking-decisions-in-build-order) have
> answers or accepted safe defaults.

## Read this first

| Document | What it answers |
| --- | --- |
| [Product definition](docs/PRODUCT.md) | What we are building, what the physician asked for versus what we inferred, the build order, and what is out of Beta |
| [Decisions](DECISIONS.md) | Every open question, who owns it, what it blocks, and the safe default that ships until it is answered |
| [Source handoff](docs/source/2026-09-product-truth-handoff.md) | The physician handoff as received. Kept as a record and not edited |

## Where P0 stands

| | Count | |
| --- | --- | --- |
| Open decisions from the handoff (§9) | 10 | D-01 – D-10 |
| Open decisions found in the P0 review | 7 | D-11 – D-17. These are clinical-safety and data-model questions the P1–P3 journeys run into but the handoff doesn't list |
| Blocking P1 or P2 | 10 | Six blocking P1 and four blocking P2. Six are for the physician alone and four involve the business |
| Decided | 12 | A-01 – A-10 from handoff §10. A-11: new codebase. A-12: the free core gives no weight targets |

The handoff mentions an earlier beta implementation. That implementation is
not the starting point for this codebase (A-11), and it has not been audited.
