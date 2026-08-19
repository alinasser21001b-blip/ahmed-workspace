# Dawai Design System

**Product:** دوائي / Dawai — Arabic-first medication availability & reservation for Iraq  
**Canonical sources:** Blueprint §25, `platform/packages/design`, Night Mint patient delivery  
**Scope of this document:** patient persona (calm). Pharmacy (*fast*) and owner (*certain*) share role names with different values.

---

## 1. Product sentence

**Dawai tells you which nearby pharmacy has your medicine, and holds it for you — so you stop making eleven phone calls.**

It is a **clinical record with a fulfilment loop attached**. The reservation is the daily reason to open the app; the medication history is the durable asset.

### Three gates (every element must pass at least one)

1. Does this reduce pharmacist work?
2. Does this reduce patient anxiety?
3. Does this improve medication safety?

If all three are no — delete it.

### Clinical safety (Tier 0)

- No diagnosis. No dose calculation. No automatic substitute suggestion.
- Never claim a government seal — say “from a pharmacy verified on Dawai”.
- A failed interaction check is never a green light (`UNAVAILABLE` ≠ “no interactions”).
- `SEV_ALERT` has no dismiss affordance — it clears by fixing its cause.
- One attention bar at a time: `SEV_ALERT > ACTION_REQUIRED > IN_PROGRESS > SUGGESTION > IDLE`.
- Clinical records are append-only.
- Inventory is passive — Dawai is not an ERP.

---

## 2. System model

Three layers:

| Layer | What it holds |
| --- | --- |
| **Foundations** | Raw scales — space, type sizes, radius, motion durations |
| **Semantic tokens** | Roles with meaning — `surface`, `accent`, `alert`… never raw hex in UI |
| **Component primitives** | Buttons, fields, PillBar, CodePanel, pharmacy cards — compose tokens only |

**Rule:** a component names a role and receives a value. No component writes a hex.

---

## 3. Color — patient “Night Mint” (ليل النعناع)

Dark-first. Deep green ground; mint is the **only** action signal.

| Role | Value | Use |
| --- | --- | --- |
| `surface` | `#0D1A15` | App ground |
| `surfaceRaised` | `#142720` | Cards / sheets |
| `surfaceSunken` | `#1B2B22` | Offline / cached strip |
| `line` | `#1E3A2D` | Borders, chip fills |
| `ink` | `#F3F7F2` | Primary text |
| `inkMuted` | `#9FC6B6` | Secondary body |
| `inkSubtle` | `#8FA89C` | Meta / captions |
| `accent` | `#2ECF9A` | Primary action |
| `onAccent` | `#0B241B` | Text on accent |
| `warning` | `#E8B34B` | Caution |
| `onWarning` | `#2A2314` | Text on warning ground |
| `alert` | `#FF9C8A` | Safety / severe |
| `onAlert` | `#7A150F` | Text on alert ground |
| `success` / `onSuccess` | = accent / onAccent | Prefer accent for “offer arrived”; do not invent a second green |

### Special surfaces

| Surface | Values | Purpose |
| --- | --- | --- |
| **Code panel** | `#F7F4EE` / ink `#16211D` / muted `#63726B` | Reservation code — light card on dark ground, reads like print |
| **Info strip** | `#0F2A1E` / ink `#F3F7F2` | “طلبك محفوظ” preserved-request band |

### Contrast floors (measured, not asserted)

- Body text ≥ **4.5:1**
- Large text / UI boundaries ≥ **3:1**

---

## 4. Typography (Arabic-first)

| Role | Size | LH | Weight | Clinical content |
| --- | --- | --- | --- | --- |
| `code` | 76pt | 1.15 | 600 | yes — reservation codes |
| `display` | 34pt | 1.25 | 700 | **barred** |
| `poster` | 28pt | 1.45 | 800 | **barred** |
| `title` | 24pt | 1.40 | 800 | yes |
| `headline` | 17pt | 1.50 | 600 | yes |
| `body` | 16pt | 1.65 | 400 | yes |
| `caption` | 13pt | 1.60 | 500 | **barred** |

### Non-negotiable

- **`letter-spacing: 0` always** for Arabic (connected script). Exception: tabular verification codes only (`tracking.tabularCode = 2`).
- Nothing clinical below **16pt**.
- Stack: `IBM Plex Sans Arabic`, `Noto Sans Arabic`, system-ui.
- Latin / drug names / prices: `IBM Plex Sans` / `IBM Plex Mono` (tabular digits).
- Isolate Latin, dosages, phones, and currency with `<bdi>` (or equivalent).
- **One numeral system per surface** — never mix Arabic-Indic and Western in one comparison.

---

## 5. Space, radius, touch

**4pt rhythm only:** 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

| Radius | Value |
| --- | --- |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 22 |
| `pill` | 999 |

| Tap target | Value |
| --- | --- |
| `min` | 44pt |
| `patientPrimary` | 48pt |
| `pharmacyPrimary` | 56pt |

Frame: gutter 16 · safeTop/safeBottom 24.

Elevation roles (names only): `flat` · `raised` · `overlay` · `sheet` · `alert`.

---

## 6. Density by persona

| Experience | Rule |
| --- | --- |
| **Patient** | One decision per screen. Generous whitespace. Large targets. Calm. |
| **Pharmacy** | Many decisions visible. Primary actions in the bottom third. Fast. |
| **Owner** | Tabular. Comparison first. Density is the point. Certain. |

---

## 7. Motion (intent)

| Token | Duration | Teaches |
| --- | --- | --- |
| `screenPush` | 350ms | Hierarchy |
| `sheetPresent` | 300ms | Temporary layer |
| `doseConfirmed` | 250ms | Recorded |
| `skeletonToReal` | 150ms | Wait over |
| `responderArrive` / `offerArrival` | 200ms | Someone answered |
| `dwPulse` / `dwTick` / `dwSweep` | 1.6–4.5s | Still asking / live search |
| `undoDwell` | 4000ms | You still have time |

Under `prefers-reduced-motion`: cross-fade instead of morph; no shake or pulse ornament.

---

## 8. RTL & copy

- Layout is **RTL-first**. Use logical properties (`inline-start/end`, `block-start/end`).
- Arabic copy is Iraqi dialect and load-bearing — do not silently shorten clinical/offline strings.
- Reserved phrases (examples): `بانتظار الاتصال` for queued request; reliability bands are not decorative adjectives.

---

## 9. Five-state screen contract

Every screen declares:

| State | Must show |
| --- | --- |
| **loading** | Skeleton matching real content shape |
| **empty** | Explanation + at most one teaching action (or quiet success with none) |
| **offline** | Whether content is read-only and how stale |
| **error** | What failed, whether in-progress work survived, exactly one recovery action |
| **ready** | The one job of the screen |

---

## 10. Component vocabulary (patient)

| Primitive | Job |
| --- | --- |
| **PillBar** | Single attention rail; priority-ordered severity |
| **SearchField** | Medicine / pharmacy find — 48pt primary |
| **PharmacyCard** | Name, distance/ETA honesty, verification, hold reliability |
| **OfferRow** | Price, freshness of confirmation, match type |
| **CodePanel** | Large reservation code on light print surface |
| **PrimaryButton** | One primary action per screen |
| **StatusChip** | Request / hold lifecycle without colour-alone meaning |

---

## 11. CSS variables (implementation)

```css
:root {
  color-scheme: dark;
  --surface: #0d1a15;
  --surface-raised: #142720;
  --surface-sunken: #1b2b22;
  --line: #1e3a2d;
  --ink: #f3f7f2;
  --ink-muted: #9fc6b6;
  --ink-subtle: #8fa89c;
  --accent: #2ecf9a;
  --on-accent: #0b241b;
  --warning: #e8b34b;
  --alert: #ff9c8a;
  --on-alert: #7a150f;
  --code-panel: #f7f4ee;
  --code-ink: #16211d;
  --code-muted: #63726b;
  --info-strip: #0f2a1e;
  --radius-md: 12px;
  --tap-patient: 48px;
  --font-ar: "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif;
  --font-latin: "IBM Plex Sans", system-ui, sans-serif;
  --font-tabular: "IBM Plex Mono", ui-monospace, monospace;
  letter-spacing: 0;
}
```

---

## 12. Anti-patterns

- Purple/indigo marketing gradients, glow stacks, emoji decoration
- Letter-spacing on Arabic text
- Clinical copy in `caption` or `display`
- Colour as the only status signal
- Inventing spacing outside the 4pt scale
- Editable inventory quantities
- “Government-certified” pharmacy claims
- Dismissible severe clinical alerts

---

## 13. Related artifacts in this workspace

| Path | Role |
| --- | --- |
| [`dawai/index.html`](dawai/index.html) | Runnable patient prototype built from this system |
| Cursor canvas `dawai-app.canvas.tsx` | Interactive patient journey beside chat |

Upstream references (adlytic): `docs/design/DESIGN_TOKENS.md`, `platform/packages/design`, Blueprint §25.
