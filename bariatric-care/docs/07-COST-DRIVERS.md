# 07 — Technical Cost Drivers (PART 11)

What drives cost, and which variables actually matter. No client pricing here.

Magnitudes are order-of-magnitude bands for planning, at the stated scale, as of writing.
Verify against live provider pricing before committing — I am not a reliable source for
current prices.

**Scale assumed:** 200–500 new patients/month, an active panel growing toward a few
thousand, one clinic, a handful of staff.

---

## 1. The cost structure in one sentence

**Everything except messaging is nearly free at this scale; messaging can cost more than
everything else combined.**

Hosting, database, storage, push, monitoring and CI for a system this size land in the
tens of dollars per month. A per-message channel at a few thousand messages per month lands
in the same range or well above it, and it scales linearly with patient count while
everything else does not.

That is the entire cost story, and it is why Q2 in
[`06-OPEN-DECISIONS.md`](./06-OPEN-DECISIONS.md) is the decision with the largest
financial tail.

---

## 2. Recurring — infrastructure

| Driver | Scales with | Magnitude at pilot | Notes |
| --- | --- | --- | --- |
| Application hosting | Deployables, not users | $10–40/mo | One API container + one worker. A single small VPS also works |
| Managed PostgreSQL | Storage + connections | $10–50/mo | The main state. Clinical text and numbers are small; this stays cheap for years |
| Object storage | GB stored | $1–10/mo | Lab PDFs and photos. Small unless patients upload images heavily |
| Storage egress | GB served | Low, watch it | Can surprise if documents are served repeatedly without caching |
| Staging environment | Fixed | $10–25/mo | Non-negotiable (§80). Can be smaller than production |
| Backups | GB + retention | $1–10/mo | Cheap. The cost is in *testing* restores, which is time |
| Domain + TLS | Fixed | ~$15/yr | TLS free via the platform or Let's Encrypt |
| CI minutes | Commits × suite duration | $0–20/mo | Free tier usually sufficient; E2E suites consume the most |

**Subtotal: roughly $30–150/month** for development plus a modest production, depending on
provider and whether staging is always-on.

---

## 3. Recurring — messaging and notifications · **the variable that matters**

| Driver | Scales with | Cost character | Notes |
| --- | --- | --- | --- |
| **Push (APNs / FCM)** | — | **Free** | Only engineering cost. Unreliable on some Android OEMs |
| **SMS / OTP in Iraq** | Messages sent | **Per message, high** | Varies by carrier and route; international A2P to Iraq is not cheap. **The dominant cost risk** |
| **WhatsApp Business API** | Conversations, not messages | Per conversation | Often cheaper than SMS per useful interaction; requires business verification |
| **Email** | Messages | Very low | Free tiers cover this scale. Low value for this user base |

**Worked illustration.** 400 new patients/month, each needing one OTP at signup, plus two
reminders per active patient per week across a panel of 2,000:

- OTP only: ~400 messages/month — modest.
- OTP + SMS reminders: ~16,400 messages/month — **two orders of magnitude higher**, and
  growing linearly with the panel forever.

This is why the recommendation in Q1 is to keep OTP off the signup critical path
(clinic-assisted enrolment) and why reminder channel choice is a strategic decision rather
than a technical one.

---

## 4. Recurring — observability and tooling

| Driver | Scales with | Magnitude | Notes |
| --- | --- | --- | --- |
| Error tracking | Events/month | $0–30/mo | Free tiers usually sufficient. **Must be PHI-scrubbed** (§94) |
| Log retention | Volume × days | $0–30/mo | Retention is a privacy decision, not only a cost one |
| Uptime monitoring | Checks | $0–10/mo | Free tiers sufficient |
| Product analytics | Events | $0–?? | **Only if privacy-reviewed.** Self-hosted is the safer default here |

A real constraint, not just a cost: a hosted log platform that captures raw request bodies
would reintroduce exactly the PHI the application's redaction removes. Verify what the
destination captures, not only what the app emits.

---

## 5. Recurring — AI (Phase 3)

| Driver | Scales with | Notes |
| --- | --- | --- |
| LLM tokens | Requests × context size | Zero in MVP. AI is Phase 3 |
| Summarisation of patient history | Patients × frequency × history length | Grows with data volume per patient — the one AI cost that compounds |

The larger issue is not cost. Sending patient data to an external model is a privacy and
legal decision (§47) that must be made deliberately, with a reviewed data-processing
posture, before it is made incidentally by an engineer adding a feature.

---

## 6. One-off and annual

| Driver | Cost character | Notes |
| --- | --- | --- |
| Apple Developer Program | ~$99/year | Required. Long enrolment lead time for organisations |
| Google Play Console | ~$25 one-time | — |
| Penetration test | **Significant one-off** | The largest single one-off. Non-negotiable before real patients |
| Legal / privacy review | **Significant one-off** + periodic | Local counsel. Non-negotiable |
| iOS release engineer | One-off, ~5–10 days | Certificates, signing, submission, device testing |
| Retained part-time engineer | **Ongoing** | Likely the largest recurring line item overall, and the one I would protect |
| Arabic UX / copy review | One-off, 2–3 days | Recommended |
| Real test devices | One-off | Two or three deliberately cheap, old Android phones. Genuinely worth it |

---

## 7. Hidden cost drivers

Things that cost real money or time and do not appear on any invoice:

- **Ali's time.** By far the largest cost in the project, and the scarcest resource.
- **Clinical content authoring.** Weeks of expert time, on the critical path, unavoidable.
- **Staff training and change management.** Recurring, underestimated, and the difference
  between adoption and abandonment.
- **The support burden after launch.** Patients will call the clinic about the app. That
  is a real, permanent operational cost the clinic absorbs.
- **App Store review cycles.** Each rejection is days of calendar time.
- **Expo/React Native SDK upgrades.** Periodic, mandatory, non-trivial.
- **Dependency maintenance and security patching.** Small and continuous.

---

## 8. What I would optimise, and what I would not

**Optimise hard:**
- Per-message costs. The only line that scales linearly with patients forever.
- Storage egress, by caching documents correctly rather than re-serving them.
- CI duration, because slow pipelines get bypassed, and a bypassed pipeline is the
  expensive failure.

**Do not optimise:**
- Database tier. Going cheap on the store of record is a false economy; correctness and
  recoverability matter more than $20/month.
- Staging. Removing it puts patients in the test environment.
- The security review or the legal review. These are the cheapest insurance in the
  project relative to what they prevent.
- The retained engineer. See [`00-READINESS-REPORT.md`](./00-READINESS-REPORT.md) answer 10.

**The genuine cost lever** is scope, not infrastructure. Every feature deferred from MVP
saves more than every infrastructure optimisation combined.
