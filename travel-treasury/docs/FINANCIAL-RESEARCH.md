# FINANCIAL RESEARCH — Iraqi-issued cards used for SAR cash withdrawal in Saudi Arabia

**Research date (UTC): 2026-08-31**
**Researcher: automated research session (Claude Code)**
**Status: COMPLETE for this session, with a material retrieval limitation recorded in §1.**

This document is the evidence base for the financial engine in this repository.
It is deliberately written so that a reader can tell, for every number, *where it
came from and how much it should be trusted*. Nothing in this document should be
treated as a confirmed bank tariff until the "Confidence" field says so.

---

## 1. RETRIEVAL LIMITATION — READ THIS FIRST

**Direct outbound HTTP access from the research environment was blocked by the
organisation's network egress policy.** Every attempt to retrieve a primary
source directly failed:

| Host attempted | Result |
|---|---|
| `cbi.iq` | `EGRESS_BLOCKED` |
| `neo.iq` | `EGRESS_BLOCKED` |
| `qi.iq` | `EGRESS_BLOCKED` |
| `www.nbi.iq` | `EGRESS_BLOCKED` |
| `www.sama.gov.sa` | `EGRESS_BLOCKED` |
| `usa.visa.com` | `EGRESS_BLOCKED` |
| `en.wikipedia.org` | `EGRESS_BLOCKED` |

A raw `curl` probe to each host returned HTTP code `000` (no connection). The
block is a blanket egress policy, not a per-site outage. This was verified
against the agent proxy status endpoint, which reports `enabled: true` with no
selective allowlist for these hosts.

**Consequence for the evidence standard.** The only research channel available
was a web search tool, which returns *indexed snippets* of pages — including
snippets of the official `neo.iq`, `nbi.iq` and `qi.iq` pages. That is
meaningfully weaker than opening the tariff document itself, because:

* the snippet is not the whole fee table, so surrounding conditions, exclusions
  and footnotes are invisible;
* the snippet carries **no publication or effective date**, so a fee could be
  years stale;
* the snippet cannot be re-read later to check it has not changed.

Therefore **no issuer fee in this document is classified `VERIFIED`.** The
highest classification awarded to an issuer fee here is `LIKELY`, meaning
"official-source wording seen through a search index, undated". This is not
excessive caution — a wrong fee here silently corrupts every effective-rate
calculation the application makes, and the application's entire purpose is to
avoid exactly that.

**The application is built to work correctly under this condition.** Fee rules
are data, carry their own confidence, and drive nothing that is presented as
verified. See §9.

---

## 2. EVIDENCE STANDARD AND CONFIDENCE DEFINITIONS

Every rule record below carries a confidence value. These are the definitions
used throughout the codebase (`RuleConfidence` in `packages/core`):

| Confidence | Meaning | May drive a "verified" figure in the UI? |
|---|---|---|
| `VERIFIED` | Retrieved directly from the institution's own site or tariff document, with a visible publication/effective date, and re-checkable. | Yes |
| `LIKELY` | Official-source wording, but retrieved indirectly (search index / cache) or lacking an effective date. | **No** — estimates only |
| `UNVERIFIED` | Secondary source only (news outlet, travel blog, aggregator, forum). Usable as a lead. | **No** — estimates only |
| `UNKNOWN` | No usable evidence found. | **No** — and never substituted with zero |

The rule that matters most: **`UNKNOWN` is never rendered as `0`.** A missing fee
propagates as "not determinable" through every calculation that depends on it,
and the UI says so. This is enforced in code and by test
(`packages/core/test/unknown-never-zero.test.ts`).

---

## 3. IRAQI REGULATORY CONTEXT — CENTRAL BANK OF IRAQ (CBI)

The task requires four things to be distinguished, and they genuinely are four
different things. Conflating them is the single most common way to get an Iraqi
travel-FX calculation wrong.

### 3.1 The four distinct concepts

1. **Official / reference exchange rate** — the administrative rate the CBI
   publishes and budgets against. It is *not* the rate at which an ATM
   withdrawal settles.
2. **Cash travel FX rules** — how much physical foreign cash a traveller may buy
   or carry. Governs banknotes, not cards.
3. **Card settlement rules** — regulatory caps and network routing rules that
   govern what a card may do abroad.
4. **Issuer-specific pricing** — the fee the individual bank charges. Sits on top
   of all of the above.

### 3.2 Records

---

**Record CBI-01 — Official USD/IQD budget reference rate**

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Product | n/a — sovereign reference rate |
| Rule | Official USD/IQD rate used for the 2026 federal budget |
| Value | **1,300 IQD per 1 USD** |
| Currency pair | USD/IQD |
| Source title | "Iraq Confirms 1,300 IQD Rate for 2026 Budget" (usfirstexchange.com); "Will the Iraqi Dinar Revalue in 2026? What CBI's 1,300 Rate Signals" (EBC Financial Group) |
| Source class | **Secondary** (financial media reporting a CBI communication) |
| Access date | 2026-08-31 |
| Publication / effective date | 2026 budget year; exact CBI letter date not established |
| Confidence | `UNVERIFIED` |
| Notes | Widely and consistently reported, but not read from `cbi.iq`. Used in the app **only** as a labelled reference rate, never as a settlement rate. |

---

**Record CBI-02 — Tiered operational USD/IQD structure**

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Rule | Reported operational tiering: CBI buys USD from Ministry of Finance at 1,300; sells to local banks at 1,310; banks supply public/traders/transfers at ~1,320 |
| Value | 1,300 / 1,310 / 1,320 IQD per USD |
| Currency pair | USD/IQD |
| Source class | **Secondary** (media analysis; an IMF characterisation of a conventional peg near 1,320 was also referenced) |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` |
| Notes | **Directly relevant to this product.** It shows there is no single "the" IQD rate. A USD-denominated card reloaded with dinars is loaded at *some* rate in this band, and which one materially changes the true IQD economic cost of a SAR withdrawal. This is precisely why the application refuses to compute an "economic IQD cost" for a USD card without a recorded `FundingEvent`. |

---

**Record CBI-03 — Traveller cash foreign-exchange allowance reduced**

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Rule | Monthly foreign-exchange allowance for citizens travelling abroad reduced from USD 3,000 to USD 2,000 |
| Value | **USD 2,000 / month** (down from 3,000) |
| Effective date | **2026-07-08** (reported) |
| Source title | "Central Bank of Iraq slashes traveler dollar cash limit to $2,000" (Iraqi News); "Iraq's Central Bank cuts traveler dollar allowance to $2,000" (Shafaq News); "CBI cuts traveler dollar allowance by one-third" (The New Region) |
| Source class | **Secondary** (three independent outlets, consistent) |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` (corroborated across outlets, so a strong lead) |
| Notes | This is a **cash** allowance — physical banknotes bought for travel. It is *not* a card limit and must not be applied to card withdrawals. Reported alongside a stated policy intent of pushing travellers toward electronic payment cards. Recorded here to keep the cash rule and the card rule visibly separate, as the task requires. |

---

**Record CBI-04 — Monthly limits on card usage abroad** *(operationally the most important CBI record for this product)*

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq (instructions republished by Iraqi commercial banks) |
| Rule | Monthly ceiling on card usage outside Iraq, aggregated across **all** international channels — ATM cash withdrawal, POS, and online |
| Values | Basic: **USD 5,000 / month** or equivalent, **per card**<br>Retirees: USD 10,000 / month (inclusive of basic)<br>Travel: USD 20,000 / month (inclusive of basic)<br>Merchants: USD 20,000 / month<br>Medical treatment abroad: USD 50,000 / month (inclusive of basic) |
| Source title | "Updated Monthly Limits for Card Usage Abroad" (bbacbank.com.iq — an Iraqi bank republishing CBI instructions); "Iraq's Central Bank restricts bank cards usage abroad" (Iraqi News); "Analysis of the Central Bank of Iraq's Instructions on Regulating the Use of Bank Cards" (Rawabet Center) |
| Source class | **Secondary**, but bank-published (a licensed bank restating a regulator instruction is a strong lead) |
| Access date | 2026-08-31 |
| Publication / effective date | Not established |
| Confidence | `UNVERIFIED` |
| Notes | Two properties matter for the engine: (a) the cap is stated as **per card**, so several cards raise total capacity; (b) limits **cannot be split and unused portions do not carry over** to the next month. This is a *regulatory* ceiling that sits above the issuer's own daily/per-transaction limits — a dimension the withdrawal planner must model separately, because a plan can be within every issuer limit and still be refused on the regulatory cap. |

---

**Record CBI-05 — Electronic Payment Services Regulation No. 2 of 2024**

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Rule | Regulation No. 2 of 2024 on electronic payment services; replaced the 2014 framework; reported as fully in effect during 2025, with government bodies phasing out cash acceptance through July 2026 |
| Source class | **Secondary** (sector commentary) |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` |
| Notes | Framework context, not a priceable rule. Recorded because it dates the current regulatory regime and explains the direction of the 2025–2026 changes above. |

---

**Record CBI-06 — Mastercard international usage directive** *(highest operational risk finding in this document)*

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Rule | Reported CBI instruction to local banks to **halt Mastercard use for international transactions**, moving foreign dealings to another scheme, from **2025-06-01** |
| Source title | "Iraq to suspend MasterCard use for foreign transactions June" (The New Region — attributed to an unnamed source); related: "Iraq's sanctioned banks to lose Mastercard access abroad by April's end" (Shafaq News) |
| Source class | **Secondary, single-sourced** for the general directive; the sanctioned-bank subset is separately reported |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` — **must be confirmed with the issuer before travel** |
| Notes | If this applies to the traveller's **Qi Mastercard from Rafidain**, that card may not function at a Saudi ATM at all. Corroborating context found in the same research: Mastercard reportedly blocked >100,000 Iraqi-issued debit cards (March 2025) and Visa ~70,000 (April 2025); one Iraqi bank (FIB) publicly reports its cards blocked for international payments since 2025-06-01. **The application therefore treats "will this card even work abroad?" as a first-class, per-card, evidence-backed field (`internationalStatus`) rather than an assumption.** |

---

**Record CBI-07 — Official SAR/IQD reference rate**

| Field | Value |
|---|---|
| Institution | Central Bank of Iraq |
| Rule | Publication of an official SAR/IQD reference rate |
| Value | **UNKNOWN — not established** |
| Confidence | `UNKNOWN` |
| Notes | The CBI rate page could not be retrieved (§1). No evidence was found that the CBI publishes a headline SAR/IQD rate comparable to its USD/IQD rate. **Not substituted with a cross-rate.** The application will show "no reference rate on file" until the user enters one with a source. See CBI-08 for the market cross-rate, which is a different thing and labelled as such. |

---

**Record CBI-08 — Market cross-rate SAR/IQD (context only, NOT a CBI rate)**

| Field | Value |
|---|---|
| Institution | Commercial FX aggregators (Wise, exchangerates.org.uk, fx-rate.net) |
| Rule | Mid-market SAR→IQD cross-rate |
| Value | ≈ **348.30 IQD per 1 SAR** (mid-market, as of 2026-07-28) |
| Source class | **Secondary** — mid-market aggregator, explicitly *not* an official or transactable rate |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` |
| Notes | Stored, if at all, as `rateType: MID_MARKET`, never as `OFFICIAL`. A mid-market cross-rate is not obtainable by a consumer, contains no fees, and is not what an ATM settles at. Its only legitimate use in this product is as a comparison baseline shown *beside* — never instead of — the user's own settled rate. |

---

## 4. NEO IRAQ (Neo Pay Iraq / INC)

**Critical structural finding: NEO issues both IQD-denominated and USD-denominated
cards, and they are not interchangeable.** The task warned against creating one
generic "NEO rate"; the research confirms the warning is well founded.

| Product | Base currency | Notes |
|---|---|---|
| **NEO 964** | **IQD** | The dinar product. |
| **NEO Classic** | **USD** | |
| **NEO Platinum** | **USD** | |
| **NEO Virtual** | **USD** | Rechargeable; transfers between NEO cards. |

Source: `neo.iq` product pages via search index — "available card currencies
include dollar for all cards except the 964 Dinar card, and dinar for the 964
Dinar card". Confidence `LIKELY`.

**Why this matters more than the fee percentages.** A SAR withdrawal on NEO 964
reduces an IQD balance, so the IQD cost is directly observable. The identical
withdrawal on NEO Classic/Platinum reduces a **USD** balance — the IQD cost is
*not* observable and cannot be derived without knowing the rate at which those
dollars were funded. This single fact drives the three-tier cost model in §9.2.

### Records

**Record NEO-01 — International FX fee, regional split**

| Field | Value |
|---|---|
| Institution | NEO Iraq |
| Product | NEO cards (international Visa transactions) |
| Rule | Foreign-exchange fee on international Visa transactions |
| Value | **2.0 % within the Visa CEMEA region**; **2.5 % outside CEMEA** |
| Currency | percentage of transaction |
| Source | `neo.iq/en/our-products/cards-features` (official page, via search index) |
| Source class | Official page, **indirectly retrieved** |
| Access date | 2026-08-31 |
| Effective date | **Not established** |
| Confidence | `LIKELY` |
| Notes | **Saudi Arabia is inside Visa CEMEA** (Central & Eastern Europe, Middle East & Africa), as is Iraq. Therefore the **2.0 %** tier is the one that applies to this trip, not 2.5 %. Region resolution is implemented as data (`region: CEMEA`) on the fee rule, not hardcoded, so the distinction survives a trip to a non-CEMEA country. |

**Record NEO-02 — International ATM fee, NEO 964 (IQD card)**

| Field | Value |
|---|---|
| Rule | International (Visa) ATM transaction fee, 964 dinar card |
| Value | **3,000 – 4,000 IQD** (range as published; exact trigger for each end of the range not established) |
| Currency | IQD |
| Source | `neo.iq` product/features pages via search index |
| Confidence | `LIKELY` (value), `UNKNOWN` (which end applies when) |
| Notes | Modelled as a fixed fee with `min = 3000 IQD`, `max = 4000 IQD` and an explicit `ambiguous: true` flag. The engine propagates this as a **range**, and the UI shows "3,000–4,000 IQD (range — exact trigger unconfirmed)" rather than silently picking one. |

**Record NEO-03 — ATM cash withdrawal ceiling**

| Field | Value |
|---|---|
| Rule | ATM cash withdrawal ceiling |
| Value | **650 USD** |
| Source | `neo.iq/en/our-products/cards-features` via search index |
| Confidence | `LIKELY` |
| Notes | Period (per transaction / per day) **not established** — recorded as `UNKNOWN` period. At ≈348 IQD/SAR and ≈1,310 IQD/USD this is roughly **2,400–2,500 SAR**, i.e. **below the common Saudi ATM per-transaction maximum of SAR 5,000**. Operationally this means a NEO card is likely to need multiple withdrawals to reach a large SAR target — which the withdrawal planner must and does account for. |

**Record NEO-04 — Card ceiling**

| Field | Value |
|---|---|
| Rule | Card ceiling |
| Value | **20,000,000 IQD** |
| Source | `neo.iq` via search index |
| Confidence | `LIKELY` |
| Notes | Which product this applies to is **not established** — most plausibly the IQD (964) product, since the figure is dinar-denominated. Recorded against the 964 product with `productAttribution: UNCERTAIN`. |

**Record NEO-05 — Local transaction fees**

| Field | Value |
|---|---|
| Value | **0** (local transactions) |
| Confidence | `LIKELY` |
| Notes | Not relevant to this trip; recorded for completeness. This is the **one** case where a zero is a researched value rather than a missing one, and it is stored as an explicit zero with a source, not as an absent rule. |

**Record NEO-06 — International POS / online fee**

| Field | Value |
|---|---|
| Value | **0.60 USD – 2.5 %** (structure not established) |
| Confidence | `UNVERIFIED` |
| Notes | The published form mixes a flat USD amount and a percentage without stating how they combine. Not used for ATM withdrawals. Recorded so it is not mistaken for the ATM rule. |

**Record NEO-07 — NEO-to-NEO card transfer fee**

| Field | Value |
|---|---|
| Value | **1 USD** per transfer between NEO Virtual/Classic/Platinum cards |
| Confidence | `LIKELY` |
| Notes | Relevant only if the traveller shuffles balances mid-trip; if so it is a real cost and belongs in the funding basis of the receiving card. |

**NEO — remaining UNKNOWNs**
`UNKNOWN`: per-transaction ATM limit; daily ATM limit; whether the 650 USD ceiling
is daily or per-transaction; the international ATM fee for the **USD** products
(NEO-02 is stated for the 964 dinar card only — **the USD-card ATM fee was not
found and must not be assumed equal to the dinar card's**); annual fee; effective
dates for every figure above.

---

## 5. NATIONAL BANK OF IRAQ (NBI)

A tariff document exists at `https://www.nbi.iq/-/media/files/fees-and-commsion-en.ashx`
("List of Fees and Commissions"). **It could not be opened** (§1); only indexed
fragments were readable.

**Record NBI-01 — ATM withdrawal outside the national network**

| Field | Value |
|---|---|
| Institution | National Bank of Iraq |
| Rule | Cash withdrawal fee, ATMs outside the national network |
| Value | **10,000 IQD** per withdrawal |
| Currency | IQD |
| Source | NBI "List of Fees and Commissions" (official tariff document, via search index) |
| Source class | Official document, **indirectly retrieved** |
| Access date | 2026-08-31 |
| Effective date | **Not established** |
| Confidence | `LIKELY` |
| Notes | **Ambiguity that must be resolved before this number is trusted:** "outside the national network" may mean *domestic ATMs of other Iraqi banks* rather than *foreign ATMs*. These are different products at different prices, and the snippet does not disambiguate. Stored with `scopeAmbiguity: 'DOMESTIC_OTHER_BANK_VS_INTERNATIONAL'` and surfaced in the UI as needing confirmation. Applying it to a Saudi withdrawal without confirmation is exactly the kind of silent error this system exists to prevent. |

**Record NBI-02 — Card servicing fees**

| Field | Value |
|---|---|
| Values | Lost/destroyed card replacement **10,000 IQD**; card renewal **15,000 IQD** |
| Confidence | `LIKELY` |
| Notes | Not withdrawal costs. Recorded so they are not mistaken for transaction fees if they appear on a statement mid-trip — a real reconciliation trap. |

**Record NBI-03 — NBI ATM daily withdrawal capability**

| Field | Value |
|---|---|
| Value | Up to **10,000,000 IQD** daily (NBI's own ATMs) |
| Confidence | `UNVERIFIED` |
| Notes | This is a **domestic ATM capability**, not an international card limit. Must not be used as the Saudi daily limit. |

**Record NBI-04 — Account minimums (context)**

| Field | Value |
|---|---|
| Values | IQD current account: minimum balance 500,000 IQD, annual fee 3,000 IQD if below; USD account: minimum 500 USD, annual fee 2 USD if below |
| Confidence | `UNVERIFIED` |
| Notes | Confirms NBI operates both IQD and USD accounts — so an NBI card's base currency must be established per card, not assumed. |

**Record NBI-05 — Foreign transaction commission**

| Field | Value |
|---|---|
| Value | **UNKNOWN** |
| Confidence | `UNKNOWN` |
| Notes | The percentage foreign-transaction commission — the number that would dominate the cost of a Saudi withdrawal — **was not found**. It is not zero; it is unknown. Any NBI cost estimate the application produces is therefore incomplete by construction, and the UI states this rather than producing a confident total. |

**Record NBI-06 — Credit-card cash advance vs debit international ATM**

| Field | Value |
|---|---|
| Value | **UNKNOWN** for both |
| Confidence | `UNKNOWN` |
| Notes | NBI is reported to offer credit cards with limits of USD 500–5,000. The task correctly insists these are different products: a **credit-card cash advance** typically carries a separate advance fee and interest accruing from day one with no grace period, while a **debit/prepaid international ATM withdrawal** does not. The data model keeps `cardType` (`DEBIT`/`CREDIT`/`PREPAID`/`CORPORATE`/`UNKNOWN`) as a required field and refuses to apply a cash-advance rule to a debit card or vice versa. |

---

## 6. RAFIDAIN BANK / QI CARD

**Record QI-01 — Product identification**

| Field | Value |
|---|---|
| Institution | Qi Card (International Smart Card) / Rafidain Bank |
| Products found | "Qi Mastercard from Rafidain Bank"; "Qi Visa Card"; "Qi Travel Card"; government/ministry salary card programmes |
| Confidence | `LIKELY` (product existence), `UNKNOWN` (which product the traveller actually holds) |
| Notes | **The traveller must identify the exact product.** Rafidain/Qi issue several distinct instruments — salary/debit, prepaid, travel, and corporate — and the research gives no basis for assuming common pricing across them. The task explicitly warned against this assumption and the research supports the warning. The card setup screen therefore requires the product to be named and records `UNKNOWN` rather than defaulting. |

**Record QI-02 — International ATM acceptance**

| Field | Value |
|---|---|
| Rule | "Accepted at local and international ATMs" |
| Source | `qi.iq` via search index |
| Confidence | `LIKELY` (as marketing copy) |
| Notes | Must be read against **CBI-06**. Marketing copy stating international acceptance does not survive a regulatory directive suspending Mastercard international use. Treated as *claimed* capability, not confirmed capability. |

**Record QI-03 — "Guaranteed exchange rate"**

| Field | Value |
|---|---|
| Rule | Qi markets "paying at a guaranteed exchange rate" for purchases outside Iraq |
| Value | **The rate itself is UNKNOWN** |
| Confidence | `UNKNOWN` |
| Notes | A *guaranteed* rate is not a *disclosed* rate. No numeric rate, no margin over any reference, and no publication mechanism was found. The marketing claim also refers to **purchases** (POS/online); whether it extends to **ATM cash withdrawal** is not established. The application will not synthesise a rate from this claim — if the traveller uses this card, the effective rate becomes knowable only empirically, from the first settled withdrawal. This is a case where the product's design (measure, don't assume) is the only correct answer. |

**Record QI-04 — Domestic withdrawal fee**

| Field | Value |
|---|---|
| Value | **3,000 IQD per 1,000,000 IQD** withdrawn (= **0.3 %**) — domestic |
| Confidence | `UNVERIFIED` |
| Notes | **Domestic only.** Recorded to prevent it being reused as an international rate, which would be a plausible-looking and completely unfounded assumption. |

**Record QI-05 — Issuance / delivery**

| Field | Value |
|---|---|
| Value | Card issued free, delivered at zero fee |
| Confidence | `UNVERIFIED` |
| Notes | Not a transaction cost. |

**Record QI-06 — International ATM fee, FX fee, limits**

| Field | Value |
|---|---|
| Value | **UNKNOWN** |
| Confidence | `UNKNOWN` |
| Notes | No published international ATM fee, foreign-transaction fee, exchange-rate policy, daily limit or per-transaction limit was found for any Rafidain/Qi product. Additional context found: Rafidain has been reported to require passport presentation for international transactions. **For a company card this is the highest-uncertainty instrument in the portfolio**, and the application must present it that way. |

---

## 7. VISA / MASTERCARD CROSS-BORDER BEHAVIOUR

The engine must model these as distinct, sequential effects. They are not
alternatives — several can apply to a single withdrawal.

### 7.1 The four rates that are not the same rate

The task states this and the research supports it:

1. **ATM / DCC offered rate** — set by the ATM operator's DCC provider if the
   traveller accepts conversion at the machine.
2. **Network rate** — Visa/Mastercard's own conversion rate applied when the
   transaction crosses currencies in the network.
3. **Issuer rate** — the rate the Iraqi bank actually books to the account, which
   may differ from the network rate and may embed an undisclosed margin.
4. **Effective all-in customer cost** — total native-currency reduction divided by
   SAR actually received. **Only this last one is economically real, and only
   this one the application treats as truth** — because only this one is
   measured from the traveller's own before/after balances and posted fees.

**Record VMC-01 — DCC cardholder-choice requirement**

| Field | Value |
|---|---|
| Institution | Visa; Mastercard |
| Rule | The cardholder must be **offered the choice** to accept or decline currency conversion; the ATM/merchant must not choose for them. The choice must be presented **before PIN entry**. The screen/receipt must display the amount in both currencies, the exchange rate applied, and any markup or commission. Providers must not use font size, colour or procedure to steer the choice. |
| Source | Visa "What is Dynamic Currency Conversion?" (`usa.visa.com/travel-with-visa/dynamic-currency-conversion.html`); Mastercard DCC Compliance Guide (`mastercard.com/.../DCC-Guide-2025-Merchant-Version.pdf`, and 2021/2020 editions) |
| Source class | Official scheme documentation (**indirectly retrieved**) |
| Access date | 2026-08-31 |
| Confidence | `LIKELY` |
| Notes | Visa's stated guidance is to **decline** the conversion offer if the required disclosures are absent. Practical rule for this trip: **always choose SAR** at a Saudi ATM. The withdrawal capture screen records the DCC decision as a required tri-state (`YES`/`NO`/`UNKNOWN`) precisely because it is the largest single controllable cost lever and, unlike issuer fees, it is fully observable at the machine. |

**Record VMC-02 — DCC cost magnitude**

| Field | Value |
|---|---|
| Value | Commonly reported **3–7 %**, with travel sources citing **5–10 %** markups on ATM DCC |
| Source class | **Secondary** (travel/finance commentary) |
| Confidence | `UNVERIFIED` |
| Notes | Not used as a computed fee. Used only to justify the UI warning and to explain a large discrepancy after the fact. The application never estimates a DCC cost — if DCC was accepted, the cost appears in the observed balance delta and is measured, not modelled. |

**Record VMC-03 — Authorisation vs settlement**

| Field | Value |
|---|---|
| Rule | An authorisation places a temporary hold that reduces available balance; the final posted amount is established at clearing/settlement and may differ. Hold expiry is set by the **issuer** and cannot be extended by the acquirer. Authorisation reversal cancels an approved authorisation before settlement and releases the hold. |
| Source | Visa Acceptance "Authorization Reversal"; payments industry documentation |
| Confidence | `LIKELY` |
| Notes | This is the direct justification for the `PENDING` → `POSTED` state split, for storing pending and posted amounts in **separate immutable columns**, and for treating an "after" balance read minutes after a withdrawal as `AVAILABLE`-type evidence rather than final truth. |

**Record VMC-04 — Partial authorisation / partial dispense**

| Field | Value |
|---|---|
| Rule | Where a transaction is partially approved, clearing should be submitted only for the partially approved amount, which is the maximum of issuer liability; otherwise an authorisation reversal should be initiated |
| Source | Visa Partial Authorization Service documentation |
| Confidence | `LIKELY` |
| Notes | Supports the `PARTIAL_DISPENSE` state. The engine's rule follows directly: **effective cost is computed against cash actually dispensed, never against cash requested.** |

**Record VMC-05 — ATM operator surcharge is a separate charge**

| Field | Value |
|---|---|
| Rule | An ATM operator/acquirer surcharge is levied by the ATM owner and is distinct from the issuer's fees |
| Confidence | `LIKELY` |
| Notes | Modelled as a separate fee component with its own provenance (`ATM_RECEIPT`), because it is observable at the machine while issuer fees are not. It may be included in the single debit or posted separately — both cases are representable. |

---

## 8. SAUDI ARABIA ATM CONTEXT

**Record SA-01 — Local currency**

SAR. The Saudi riyal has 2 decimal places (halalas). Withdrawal in **SAR** is
always the correct DCC choice for a foreign-issued card (VMC-01).

**Record SA-02 — ATM access fees for foreign-issued cards**

| Field | Value |
|---|---|
| Rule | Most Saudi bank ATMs reportedly do not charge an access fee to foreign cardholders; at least one bank's ATMs reportedly charge **SAR 21** per transaction |
| Source class | **Secondary** (travel/ATM-fee guides) |
| Access date | 2026-08-31 |
| Confidence | `UNVERIFIED` |
| Notes | Not used as a default. The withdrawal form asks the traveller to read the surcharge **off the ATM screen/receipt**, which is both more reliable and directly attributable. |

**Record SA-03 — Per-transaction withdrawal maximum**

| Field | Value |
|---|---|
| Value | Commonly **SAR 5,000** per transaction |
| Source class | **Secondary** |
| Confidence | `UNVERIFIED` |
| Notes | Feeds the planner as a **soft, editable, clearly-labelled** default constraint (`atmPerTransactionMaxSar`), not a hard rule. Interacts with NEO-03: a NEO USD card ceiling of 650 USD (≈2,400–2,500 SAR) binds tighter than the ATM's own 5,000 SAR maximum. |

**Record SA-04 — Applicability of SAMA tariffs to Iraqi-issued cards**

| Field | Value |
|---|---|
| Value | **NOT APPLICABLE / UNKNOWN** |
| Confidence | `UNKNOWN` |
| Notes | The task's warning is followed exactly. `sama.gov.sa` could not be retrieved, and **no SAMA tariff intended for Saudi-issued cards has been applied to any Iraqi-issued card in this system.** A domestic Saudi interchange or tariff rule governs the relationship between SAMA-licensed institutions and their own cardholders; an Iraqi-issued card at a Saudi ATM is a cross-border network transaction governed by the scheme rules and the Iraqi issuer's tariff. Assuming otherwise would be a category error. No SAMA-derived fee is seeded. |

---

## 9. HOW THIS RESEARCH SHAPES THE SYSTEM

This section is the bridge from evidence to code. It exists so that a future
reader can see that the design is a *consequence* of the research, not a
decoration on top of it.

### 9.1 Almost nothing is verified — so verification must be earned at runtime

Not one issuer fee reached `VERIFIED`. A system that shipped these numbers as
authoritative defaults would produce confident, wrong effective rates. The
system therefore:

* ships every researched rule as **seed data carrying its own confidence,
  source, access date and ambiguity flags** (`fee_rules` table, seeded from
  `packages/core/src/research/seed-rules.ts`);
* **never** lets a `LIKELY`/`UNVERIFIED`/`UNKNOWN` rule produce a number labelled
  verified — such rules can only yield `ESTIMATED` figures;
* derives its trustworthy numbers from **the traveller's own measured
  withdrawals** (before/after balances, posted debits, posted fees, cash
  counted), which are `OBSERVED` → `POSTED` → `RECONCILED`;
* drives the Best Card engine from `RECONCILED`/`VERIFIED` transactions only,
  and says "insufficient settled transactions" otherwise.

The empirical path is not a fallback here. Given the evidence available, **it is
the primary path**, and the tariff data is the fallback.

### 9.2 Three costs, never mixed (the NEO 964 vs NEO Classic problem)

Because NEO issues both IQD and USD cards (§4), and because there is no single
IQD/USD rate (CBI-02), the engine computes three separate figures and refuses to
collapse them:

| Figure | Definition | Availability |
|---|---|---|
| **Native cost** | Actual reduction in the card's own currency | Always, once observed |
| **Reference IQD cost** | Native cost × a *labelled* reference rate | Only with a stored reference rate; always shown as reference |
| **Economic IQD cost** | Native cost × the card's **actual funding rate** | **Only** when a `FundingEvent` establishes what was really paid in IQD to load those units |

For an IQD card, native cost *is* IQD cost and all three coincide trivially. For
a USD card with no funding record, the economic IQD cost is **not computed** and
the UI reads "Not enough evidence". Test:
`packages/core/test/usd-card-no-funding.test.ts`.

### 9.3 "Can this card even be used abroad?" is a data field

CBI-06 makes international usability genuinely uncertain for a Mastercard
product. Each card therefore carries `internationalStatus`
(`CONFIRMED_WORKING` / `CLAIMED_BY_ISSUER` / `RESTRICTED_BY_REGULATION` /
`UNKNOWN`) with its own evidence, and the planner will not allocate SAR to a card
that is not at least `CLAIMED_BY_ISSUER`, flagging the reason.

### 9.4 Regulatory ceiling is modelled separately from issuer limits

CBI-04 gives a per-card monthly cap across all international channels that is
independent of any issuer daily limit. The planner evaluates issuer
per-transaction limit, issuer daily limit, **and** the regulatory monthly cap,
and reports which constraint binds. A plan can satisfy every bank limit and still
be regulatorily impossible; the planner says which.

### 9.5 Ambiguity is preserved, not resolved

NEO-02 is a range (3,000–4,000 IQD). NBI-01 has an unresolved scope. NEO-03 has
an unknown period. The rule records carry `min`/`max` and explicit ambiguity
flags, and estimates derived from them are presented as ranges with the
ambiguity named. The engine has no code path that picks a midpoint.

---

## 10. WHAT MUST BE CONFIRMED DIRECTLY WITH THE ISSUERS

Ordered by financial impact. Every item is an `UNKNOWN` or a flagged ambiguity
above, and each maps to a row in the in-app **Financial Sources** registry.

1. **Rafidain/Qi — does the Mastercard work at a Saudi ATM at all?** (CBI-06, QI-02)
   If not, the company card plan collapses and must be rebuilt around other cards.
2. **Rafidain/Qi — international ATM fee, FX fee/rate mechanism, and limits.** (QI-03, QI-06)
   Entirely unknown; the "guaranteed rate" is undisclosed.
3. **NBI — foreign transaction commission percentage.** (NBI-05) The single
   missing number most likely to dominate NBI withdrawal cost.
4. **NBI — does the 10,000 IQD "outside the national network" fee apply to
   foreign ATMs, or only to other Iraqi banks' ATMs?** (NBI-01)
5. **NEO — international ATM fee for the USD products** (Classic/Platinum);
   NEO-02's 3,000–4,000 IQD is stated for the **964 dinar** card only. (NEO-02)
6. **NEO — is the 650 USD ATM ceiling per transaction or per day?** (NEO-03)
   Determines how many trips to the machine a given SAR target needs.
7. **NEO — what triggers 3,000 vs 4,000 IQD?** (NEO-02)
8. **All issuers — effective dates of every published tariff.** Without these,
   historical transactions cannot be guaranteed to be priced with the tariff that
   was actually in force. The schema is effective-dated and ready for them.
9. **Card products and base currencies confirmed per physical card**, including
   whether any is a credit card (cash-advance pricing) rather than debit/prepaid. (NBI-06, QI-01)
10. **CBI — the traveller's applicable monthly card-abroad category** (basic
    5,000 vs travel 20,000 USD) and whether it is per card or per person. (CBI-04)

---

## 11. REFERENCE-RATE FETCHING — DECISION

The task asks whether a safe official reference-rate source exists and to avoid
fragile scraping. **Decision: no automated rate fetching is implemented.**

Reasons, in order:

1. `cbi.iq` is unreachable from this environment (§1), so an integration could
   not be built or tested here, and shipping an untested network path into a
   financial application is worse than shipping none.
2. No evidence was found of a documented, stable public CBI rate **API**. The
   alternative would be scraping an HTML page — precisely what the task forbids
   doing silently.
3. No CBI SAR/IQD rate was established at all (CBI-07), so the pair the traveller
   most needs is the one an integration would be least able to supply.

Instead the application provides **manually entered reference rates**, each
requiring `source`, `rateType`, `effectiveDate` and `fetchedAt`, displayed
alongside — never in place of — the traveller's own settled rate. The
`ReferenceRateProvider` interface exists and is documented so a verified official
feed can be added later without touching the calculation engine. **All
transaction calculations work with no network FX feed whatsoever**, because they
are computed from the traveller's own observations.

---

## 12. SOURCE REGISTRY

| # | Institution | Source | Class | Accessed | Retrieval |
|---|---|---|---|---|---|
| S1 | Central Bank of Iraq | `cbi.iq` | Primary | 2026-08-31 | **BLOCKED** |
| S2 | NEO Iraq | `neo.iq/en/our-products/cards-features`, `/our-products`, `/faqs`, `/terms-&-conditions`, `/our-products/1`, `/4`, `/5` | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S3 | National Bank of Iraq | `nbi.iq/-/media/files/fees-and-commsion-en.ashx` (List of Fees and Commissions) | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S4 | National Bank of Iraq | `nbi.iq/en/personal/cards`, `/ways-to-bank/atm`, `/accounts/*` | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S5 | Qi Card / Rafidain | `qi.iq/en/cross-borders`, `/Qi-MasterCard-from-Rafidain-Bank`, `/visa-card`, `/travel-card`, `/cards` | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S6 | Visa | `usa.visa.com/travel-with-visa/dynamic-currency-conversion.html`; Visa Partial Authorization Service PDF; Visa Acceptance "Authorization Reversal" | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S7 | Mastercard | `mastercard.com/.../DCC-Guide-2025-Merchant-Version.pdf`; DCC Guide 2021; DCC Compliance Guide 2020 | Primary | 2026-08-31 | **BLOCKED** — snippets only |
| S8 | SAMA | `sama.gov.sa` | Primary | 2026-08-31 | **BLOCKED** |
| S9 | BBAC Bank Iraq | "Updated Monthly Limits for Card Usage Abroad" | Secondary (bank restating regulator) | 2026-08-31 | Snippet |
| S10 | Shafaq News | Traveller allowance cut; sanctioned banks lose Mastercard access | Secondary | 2026-08-31 | Snippet |
| S11 | Iraqi News | Traveller allowance cut; card usage restrictions abroad | Secondary | 2026-08-31 | Snippet |
| S12 | The New Region | Mastercard international suspension; allowance cut; Rafidain passport requirement | Secondary (single-sourced) | 2026-08-31 | Snippet |
| S13 | Iraq Business News | Central Bank eases rules on cash dollar withdrawals (2026-07-14) | Secondary | 2026-08-31 | Snippet |
| S14 | 964media | Cash dollar withdrawal rules; Iraq currency exchange rate series | Secondary | 2026-08-31 | Snippet |
| S15 | Rawabet Center | Analysis of CBI instructions on bank card usage | Secondary | 2026-08-31 | Snippet |
| S16 | Wise / exchangerates.org.uk / fx-rate.net | IQD–SAR mid-market cross-rate | Secondary (mid-market) | 2026-08-31 | Snippet |
| S17 | Travel/ATM guides (atmfeesaver, explore-saudi, houseofsaud, Revolut) | Saudi ATM fees, limits, DCC practice | Secondary | 2026-08-31 | Snippet |
| S18 | FIB (First Iraqi Bank) | "Update on our international card usage" — cards blocked internationally since 2025-06-01 | Primary (other issuer, corroborating context) | 2026-08-31 | Snippet |
| S19 | EBC Financial Group / US First Exchange | CBI 1,300 IQD budget rate for 2026 | Secondary | 2026-08-31 | Snippet |

Every row is reproduced in the application's **Financial Sources** admin page and
linked to the rules derived from it, so a future tariff change can be audited
against what was believed on 2026-08-31.

---

## 13. SUMMARY

* **Verified issuer fees: none.** Retrieval of primary sources was blocked; the
  best available classification for official fee text is `LIKELY`.
* **The most important findings are structural, not numeric:** NEO issues both
  IQD and USD cards; there is no single IQD/USD rate; a CBI directive may prevent
  Mastercard working abroad at all; a regulatory monthly cap on card use abroad
  exists independently of issuer limits; and Saudi Arabia falls inside Visa
  CEMEA, so NEO's 2 % tier applies rather than 2.5 %.
* **The system is designed for exactly this evidence state.** It measures rather
  than assumes, labels every number with provenance and confidence, keeps
  `UNKNOWN` distinct from zero, and refuses to present an effective rate it
  cannot substantiate.

