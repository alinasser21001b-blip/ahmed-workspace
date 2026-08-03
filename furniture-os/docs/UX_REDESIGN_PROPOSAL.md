# Furniture OS — UX Research & Redesign Proposal
## Gate: Research → Directions → Journey → IA → Wireframes
### Status: AWAITING APPROVAL — No implementation until signed off

---

# 1. Research Report

## 1.1 Research question

How do the world’s best daily-use products make complex systems feel simple, so a furniture business owner can work for hours without feeling he is “using AI software”?

## 1.2 Method

Studied product philosophies (not skins) across:

| Cluster | Products |
|---|---|
| Work OS / speed | Linear, Notion, Raycast, Superhuman, Retool |
| Conversation | WhatsApp, Slack, Discord |
| AI interfaces | ChatGPT, Claude, Perplexity |
| Visual knowledge | Pinterest, Cosmos, Are.na, Apple/Google Photos, Fabric |
| Reading / memory | Readwise Reader |
| Extreme complexity | Palantir |

Sources: engineering blogs, case studies, UX analyses (Linear Method, Superhuman 100ms rule, Pinterest IA, progressive disclosure literature, Are.na/Cosmos critiques).

## 1.3 Core finding

**Great products do not show their engine room.**  
They show a familiar object of work (inbox, chat, pin, issue, photo) and let intelligence rearrange that object silently.

The failure mode of AI products is the opposite: they put the engine room in the navigation (Memory, Graph, Embeddings, Agents). That is demo software, not daily software.

---

# 2. Global Product Analysis

## 2.1 Why these products feel easy

| Product | Why it feels easy |
|---|---|
| **Linear** | Opinionated defaults; few concepts; intention → action in one step; reduces decision fatigue |
| **Notion** | One metaphor (pages/blocks); complexity grows only when user asks |
| **Raycast** | One door (command palette); zero permanent chrome |
| **Superhuman** | 100ms rule; keyboard grammar; every action has a place; speed as emotion |
| **WhatsApp** | One list + one thread; decades of muscle memory; almost no learning |
| **Slack** | Channels as rooms; unread as attention; search as safety net |
| **Discord** | Servers → channels → messages; spatial mental model |
| **ChatGPT / Claude** | Conversation as the only surface; tools/reasoning collapsed |
| **Perplexity** | Answer first, sources as secondary disclosure |
| **Pinterest** | Image is the unit; boards organize without schemas |
| **Cosmos** | Save + visual search; AI tags in background; anti-noise |
| **Are.na** | Blocks in channels; user-owned structure; no algorithmic chaos |
| **Photos (Apple/Google)** | Library first; people/places/memories inferred, not configured |
| **Readwise Reader** | Read → highlight → later; memory without “memory UI” |
| **Palantir / Retool** | Power behind constrained views; operators see missions/tasks, not raw graphs |

## 2.2 How information is organized

Common pattern: **Object → Collection → Detail**

- WhatsApp: Chat → Thread → Message/Media  
- Pinterest: Pin → Board/Feed → Pin detail  
- Linear: Issue → Project/Cycle → Issue detail  
- Photos: Photo → Library/Album → People/Places (inferred)

Never: Capability → Capability → Capability (Graph, DNA, Memory…).

## 2.3 How complexity is hidden

1. **Progressive disclosure** — Level 1 verdict / status; Level 2 evidence; Level 3 raw  
2. **Strong defaults** — Linear Method: one good way beats infinite config  
3. **Background intelligence** — Photos faces, Pinterest related pins, Cosmos tags  
4. **Collapsed AI process** — Claude/ChatGPT hide thinking; Perplexity hides retrieval steps  
5. **Command palette as escape hatch** — power without permanent UI (Raycast, Linear, Notion)

## 2.4 Why users don’t get lost

- Max **2–3 navigation anchors** for daily work  
- Clear **home** (Inbox / Chats / Library / Feed)  
- Always a way back (thread → list, pin → feed)  
- Consistent language (no mixed metaphors)  
- Unread / needs-you as attention compass

## 2.5 Attention distribution on screen

Successful daily apps allocate attention roughly:

| Zone | Role | % of attention |
|---|---|---|
| Primary work object | Chat / Pin / Issue | ~60–70% |
| Orientation | List / filters / title | ~15–20% |
| Action strip | Reply / save / approve | ~10–15% |
| Ambient intelligence | One summary line / whisper | ~5% |

Anti-pattern: equal weight to 7 AI panels.

## 2.6 Why users return daily

- The app sits on an **existing habit loop** (check WhatsApp, browse inspiration)  
- It reduces anxiety (“what’s waiting on me?”)  
- It creates **closure** (approve, reply, save)  
- Speed makes opening it feel cheap  
- Identity: “this is where my work lives”

## 2.7 Shared principles (engineering of UX)

1. **Familiar object first** — don’t invent a new noun if WhatsApp/Pinterest already own the habit  
2. **Opinionated structure** — fewer modes, clearer path  
3. **Progressive disclosure** — summary → evidence → raw  
4. **Invisible infrastructure** — AI/graph/search are plumbing  
5. **Attention budget** — one primary focus per screen  
6. **Perceived speed** — instant feedback, optimistic UI  
7. **Daily loop** — morning scan → decide → do → evening quiet  
8. **Two depths only for power** — mouse path for normal; palette/shortcuts later  
9. **Trust by citation** — show *why* only when needed (sample, message, pin)  
10. **Beauty serves scanning** — visuals for market; calm density for chat

---

# 3. Forget the Current Product

Treat the existing UI as discarded.

No reuse of:
- Current top tabs as “feature showcase”  
- Any AI capability pages  
- Dashboard cards as primary metaphor  
- Technical labels in navigation  

White page. New IA. New journey. New wireframes.

---

# 4. Ten Radically Different Directions

## D1 — WhatsApp-first Workspace
**Idea:** The entire product *is* an enriched WhatsApp. Market is a secondary tab.  
**Why:** Owner already lives in WhatsApp 8+ hours/day.  
**Pros:** Zero learning; highest daily retention; decisions in context.  
**Cons:** Weak for pure design browsing; risk of feeling “just WhatsApp”.  
**Best for:** Production-heavy owners.  
**Vs others:** Best habit fit; weaker as design studio.

## D2 — Pinterest-first Workspace
**Idea:** Home is infinite furniture feed; chats open from a pin/workshop.  
**Why:** Design taste drives classical furniture business.  
**Pros:** Delight, discovery, brand feel.  
**Cons:** Wrong morning priority (approvals wait); breaks production urgency.  
**Best for:** Design directors, less ops.  
**Vs others:** Beautiful but misaligned to daily pain.

## D3 — Infinite Canvas
**Idea:** Spatial board of workshops, orders, designs as nodes you pan/zoom.  
**Why:** “See the whole business.”  
**Pros:** Powerful overview; impressive demos.  
**Cons:** High cognitive load; slow for repetitive approvals; not mobile-friendly.  
**Best for:** Weekly planning, not hourly ops.  
**Vs others:** Demo candy; poor daily driver.

## D4 — Timeline-first
**Idea:** One vertical day/week timeline of all production + market events.  
**Why:** Time is the true axis of manufacturing.  
**Pros:** Delay visibility; narrative of the day.  
**Cons:** Hard to jump into one workshop; chat fidelity suffers.  
**Best for:** Supervisors reviewing history.  
**Vs others:** Good as a lens, bad as home.

## D5 — Search-first (Raycast-like)
**Idea:** Empty screen + command/search; everything is a query.  
**Why:** Power users love Cmd-K.  
**Pros:** Extreme speed for experts.  
**Cons:** Empty home feels cold; owner is not a keyboard-native PM.  
**Best for:** Power operators later.  
**Vs others:** Excellent secondary, weak primary for this user.

## D6 — AI Assistant-first (ChatGPT-like)
**Idea:** Talk to the business brain; UI generates views on demand.  
**Why:** “Ask anything.”  
**Pros:** Flexible; showcases AI.  
**Cons:** Exactly the anti-goal — AI becomes the product; chat-about-work ≠ work.  
**Best for:** Occasional analysis.  
**Vs others:** Rejected as home by product philosophy.

## D7 — Operating System Desktop
**Idea:** App icons: Chats, Market, Orders, Calendar… windowed.  
**Why:** Feels like a company OS.  
**Pros:** Expandable long-term.  
**Cons:** Fragmentation; leaves “OS shell” empty of habit; Apple-style complexity.  
**Best for:** Multi-role companies later.  
**Vs others:** Premature platform thinking.

## D8 — Spatial Workspace (Discord-like rooms)
**Idea:** “Rooms” per factory region / stage (Painting room, Upholstery room).  
**Why:** Spatial memory.  
**Cons:** Forces remapping of social graph; workshops aren’t stages.  
**Best for:** Internal teams with roles.  
**Vs others:** Clever, wrong primary identity (people > rooms here).

## D9 — Visual Knowledge Space (Are.na / Cosmos)
**Idea:** Everything is a saved block in channels (suppliers, motifs, fabrics).  
**Why:** Knowledge compounds.  
**Pros:** Beautiful long-term archive.  
**Cons:** Manual curation burden; not where urgency lives.  
**Best for:** Design research days.  
**Vs others:** Perfect for Market subsystem; not for morning triage.

## D10 — Hybrid Workspace (Dual-surface, single soul)
**Idea:** Exactly two peer surfaces — **Production (chat)** and **Market (visual)** — with one shared quiet intelligence layer. No third home. Switch is a mode, not a product tour.  
**Why:** Matches the real split brain of the owner: *people I must answer* vs *designs I must watch*.  
**Pros:** Honest to workflow; each surface uses the world’s strongest habit UI; AI stays underground; scalable without nav sprawl.  
**Cons:** Requires ruthless restraint (no third “Insights” home); hybrid can become two mediocre apps if craft is weak.  
**Best for:** This exact user.  
**Vs others:** Highest workflow fit; not the flashiest single metaphor.

### Extra directions considered (compressed)
- **D11 Mission Control (Palantir-lite):** rejected for daily use — anxiety theater.  
- **D12 Spreadsheet Ops (Retool-like):** rejected — feels like ERP.  

---

# 5. Chosen Direction

## Winner: **D10 — Hybrid Workspace**
### Specifically: **WhatsApp-native Production Surface + Pinterest-native Market Surface**

### Why this — not the most dazzling

1. **Time budget:** Owner’s day is mostly conversations with workshops. Home must be chat.  
2. **Habit transfer:** WhatsApp muscle memory removes onboarding tax.  
3. **Second brain is visual:** Classical furniture decisions are visual — Market must be browse-first, not table-first.  
4. **Philosophy compliance:** Two surfaces only; AI never becomes a nav item.  
5. **Closure loops:** Approve/reply in chat; save/compare in market — both create daily “done” feeling.  
6. **Research alignment:** Linear/Superhuman say reduce choice; WhatsApp/Pinterest say reuse familiar objects; ChatGPT/Claude say hide process.

### What we explicitly reject as primary
- AI chat as home (D6)  
- Canvas/OS theater (D3/D7)  
- Market as only home (D2)  
- Capability dashboards  

### How Hybrid avoids becoming “two mediocre apps”
- Same brand shell, same type rhythm, same “quiet intelligence” pattern (one summary band, then familiar content).  
- Cross-links are contextual (from a sample in chat → “nearby designs” in market) never a third module named Similarity.

---

# 6. Full User Journey (Morning → Close)

## Persona
Egyptian classical furniture owner. Phone + laptop. Arabic primary. Dozens of workshops on WhatsApp. Watches Egypt/Turkey design movement.

## Journey map

### 06:45 — Open app
**Sees:** Production surface (chats). Soft line: “3 ينتظرون قرارك”.  
**Does not see:** Graphs, DNA, agent names, dashboards.  
**AI:** Ranked list by urgency; waiting time; one-line status per chat.

### 06:47 — Scan list
**Attention:** Names + last line + red/green urgency chips.  
**Filters (optional):** يحتاجك | متأخر | فيه وسائط.  
**Presses:** Ahmed Workshop.

### 06:48 — Inside conversation
**Top band (intelligence, collapsible):**  
“بانتظار موافقة على قماش التنجيد · منذ 3 ساعات” + actions موافقة / رفض / لاحقاً.  
**Below:** Full WhatsApp-faithful thread (text, images, voice).  
**AI appears:** Only as summary + decision strip + optional media caption under images.  
**AI disappears:** Inside the scrolling chat — feels native.

### 06:50 — Decides
Taps موافقة. Strip updates. Optional composer reply “كمّل”.  
**Feeling:** Closure. Same as clearing WhatsApp, faster.

### 07:10 — Three more chats
Same pattern. No page switches beyond list ↔ thread.

### 11:20 — Quiet window — opens Market
**Sees:** Visual masonry of Egypt/Turkey designs. Whisper of the week (one paragraph).  
**Does:** Scroll, save, open a pin.  
**Pin detail:** Image dominant; source/date; why it matters; “related”; optional “قرب من شغل عندك”.  
**AI:** Ranking, dedupe, relatedness — invisible.

### 16:40 — Returns to Production
New samples. Same chat habit.  
**AI:** Remembers prior fabric rejection → quiet note under decision (“سبق أن رفضت نوعاً مشابهاً”) — still not a Memory page.

### 21:00 — Close
List mostly calm. Optional tiny “يومك: 5 قرارات · 2 عينات”. No report center.

### Journey principles
| Moment | Show | Hide |
|---|---|---|
| Open | Who needs me | System health |
| In chat | Summary + original thread | Pipelines |
| Decide | 1–3 actions | Settings |
| Browse market | Images | Taxonomies |
| Cross | “تصاميم قريبة” | “Similarity engine” |

---

# 7. Information Architecture

```text
App Shell
├── Surface A: الإنتاج (default)
│   ├── Chat List
│   │   ├── Attention filters (يحتاجك / متأخر / وسائط / الكل)
│   │   └── Conversation rows (person, preview, urgency, waiting)
│   └── Conversation
│       ├── Intelligence band (summary, decisions, progress hint)
│       ├── Native thread (messages, media, voice)
│       ├── Contextual related designs (optional, bottom)
│       └── Composer
└── Surface B: السوق
    ├── Discovery header (whisper + light filters مصر/تركيا)
    ├── Masonry feed (pins)
    └── Pin detail (overlay/page)
        ├── Image
        ├── Source / date / why it matters
        ├── Related pins
        └── Save

Global (non-nav, later)
└── Command palette (بحث / انتقال) — power only, not a home
└── Settings / Import WhatsApp — buried, not daily

FORBIDDEN as top-level
✗ Knowledge Graph ✗ Memory ✗ Similarity ✗ Design DNA
✗ Agents ✗ Ontology ✗ Embeddings ✗ Dashboards
```

**Object model (user-facing nouns only):**
- محادثة / رسالة / مرفق  
- قرار  
- تصميم (pin)  
- محفوظات  

Everything else is underground.

---

# 8. Low-Fidelity Wireframes

## 8.1 Production — Chat list (home)

```text
┌─────────────────────────────────────────────┐
│  Calyptus          [ الإنتاج ]  [ السوق ]   │
├──────────────────────┬──────────────────────┤
│ الإنتاج              │                      │
│ ─────────────────    │                      │
│ 3 ينتظرون قرارك      │     (thread pane     │
│                      │      empty state:    │
│ [يحتاجك][متأخر][الكل] │      اختر محادثة)    │
│ 🔍 ابحث...           │                      │
│                      │                      │
│ ● أحمد ورشة    3س   │                      │
│   بانتظار موافقة قماش│                      │
│   [يحتاجك]           │                      │
│                      │                      │
│ ○ محمد نجّار   1س   │                      │
│   تأكيد مقاسات #241  │                      │
│                      │                      │
│ ○ علي تنجيد   اليوم │                      │
│   دخل التنجيد        │                      │
└──────────────────────┴──────────────────────┘
```

## 8.2 Production — Conversation

```text
┌──────────────────────┬──────────────────────────────────┐
│ (list)               │ أحمد ورشة · تنجيد                │
│                      │──────────────────────────────────│
│                      │ ┌ intelligence band (collapsible)┐│
│                      │ │ ملخص: عينة قماش بانتظارك      ││
│                      │ │ منذ 3 ساعات · أولوية عالية    ││
│                      │ │ [موافقة] [رفض] [لاحقاً]       ││
│                      │ │ تلميح هادئ: سبق رفضت مخمل لامع││
│                      │ └────────────────────────────────┘│
│                      │                                  │
│                      │  [اليوم]                         │
│                      │  ┌─ هم ─┐                        │
│                      │  │ صورة │ 📷 قماش بيج · مخمل    │
│                      │  └──────┘                        │
│                      │           ┌─ أنت ─┐              │
│                      │           │ ابعت بديل │          │
│                      │           └────────┘              │
│                      │                                  │
│                      │ ── تصاميم قريبة (اختياري) ──    │
│                      │ [img][img][img] → السوق         │
│                      │──────────────────────────────────│
│                      │ [تلميحات رد]  [ اكتب رسالة... ]│
└──────────────────────┴──────────────────────────────────┘
```

## 8.3 Market — Feed

```text
┌─────────────────────────────────────────────────────────┐
│  Calyptus          [ الإنتاج ]  [ السوق ]                │
├─────────────────────────────────────────────────────────┤
│ السوق                                                   │
│ همسة الأسبوع: الذهبي والبيج يصعدان في غرف النوم...     │
│ [مصر] [تركيا] [الكل]     🔍 تاج فرنسي...                │
│                                                         │
│  ┌────┐  ┌──────┐  ┌────┐  ┌──────┐                     │
│  │img │  │ img  │  │img │  │ img  │                     │
│  │    │  │      │  │    │  │      │                     │
│  └────┘  └──────┘  └────┘  └──────┘                     │
│  دمياط    إسطنبول   بورصة   دمياط                        │
│  لماذا؟   لماذا؟   لماذا؟  لماذا؟                       │
│                                                         │
│  (infinite scroll — no charts, no KPI strip)            │
└─────────────────────────────────────────────────────────┘
```

## 8.4 Market — Pin detail

```text
┌───────────────────────────┬─────────────────────────────┐
│                           │ غرفة نوم تركي منحنية        │
│                           │ مصدر: مصنع بورصة · قبل يومين│
│        IMAGE              │                             │
│       DOMINANT            │ لماذا تهمك:                 │
│                           │ نمط التاج بدأ يظهر في دمياط │
│                           │                             │
│                           │ قريبة من هذا:               │
│                           │ [ ] [ ] [ ]                 │
│                           │                             │
│                           │ قرب من شغلك: عند أحمد...   │
│                           │ [حفظ]              [إغلاق] │
└───────────────────────────┴─────────────────────────────┘
```

## 8.5 Mobile Production (stack)

```text
List full-screen → tap → Thread full-screen with back.
Intelligence band sticky under header.
Composer fixed bottom.
```

---

# 9. Why This Final Design

1. **Respects the real job-to-be-done:** clear decisions buried in chats; stay current on design movement.  
2. **Borrows habit UIs, not feature UIs:** WhatsApp + Pinterest beat inventing a third metaphor.  
3. **Hides the brain:** Graph/DNA/Memory/Similarity never compete for attention.  
4. **Attention architecture matches research:** one primary object per screen; intelligence as a thin band.  
5. **Daily loop:** morning triage → decisions → optional market browse → evening calm.  
6. **Progressive disclosure:** summary → thread evidence → related designs only if useful.  
7. **Two surfaces only:** prevents product sprawl that turned the previous build into an AI gallery.  
8. **Trust:** every smart claim can be traced to a message, sample, or pin — without a “citations lab”.  
9. **Extensible later:** command palette, timeline lens, canvas — as *modes*, never as new homes.  
10. **Aligned to stated philosophy:** Workspace, not dashboard/CRM/ERP/AI showcase.

---

# 10. Approval Gate

Please review and approve (or request revisions on) this package:

1. Research report  
2. Global product analysis  
3. Ten-direction comparison  
4. Full user journey  
5. Information architecture  
6. Low-fi wireframes  
7. Final design rationale  

**Chosen direction pending your sign-off:** Hybrid Workspace — Production (WhatsApp-native) + Market (Pinterest-native), AI underground.

No UI implementation starts until you approve.
