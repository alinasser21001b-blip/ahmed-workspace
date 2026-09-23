# Obesity & Healthy Lifestyle Platform: P0 product-definition patch

> **This folder is not the codebase.** It holds P0 product-definition documents
> drafted from the physician handoff. The platform's actual codebase was built
> in an earlier session at `~/obesity-platform`, and it has not yet been
> located from this workspace. See the
> [codebase location report](CODEBASE-LOCATION-REPORT.md) and
> [DECISIONS A-11](DECISIONS.md#a-11-codebase-continuity).
>
> **Do not add application code here.** When the codebase is found, these
> documents are compared with it (Keep / Modify / Delete / Missing) and merged
> into it. Then this folder is removed.

## Contents

| Document | What it answers |
| --- | --- |
| [Codebase location report](CODEBASE-LOCATION-REPORT.md) | Where the existing codebase was searched for, and what is needed to find it |
| [Product definition](docs/PRODUCT.md) | What we are building, what the physician asked for versus what we inferred, the build order, and what is out of Beta |
| [Decisions](DECISIONS.md) | Every open question, whether it is a true blocker, configurable, or content, and the conservative default in force until it is answered |
| [Source handoff](docs/source/2026-09-product-truth-handoff.md) | The physician handoff as received. Kept as a record and not edited |

## Where P0 stands

| | |
| --- | --- |
| True blockers | **1:** A-11, codebase continuity |
| Open physician/business decisions | 17 (D-01 – D-17): 13 configurable, 4 content. None stops P1 |
| Provisional guardrails | A-12: the free core gives no weight targets or rate-of-loss advice (awaiting physician approval) |
| Decided | A-01 – A-10, from handoff §10 |

Order: locate the codebase → Product Truth Gap Audit against it → merge these
documents → P1.
