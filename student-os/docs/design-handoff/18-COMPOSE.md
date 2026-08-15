# Compose

**Route** `app/compose.tsx`, `presentation: 'modal'`
**Purpose** Publish structured academic knowledge — not a status update.
**Primary user question** "Who will see this, and what kind of knowledge is it?"
**Dominant action** Publish.
**Secondary actions** attach image, close.

**Source repo files** `app/compose.tsx`, `packages/contracts/src/social/content.contract.ts`, `packages/contracts/src/social/files.contract.ts`, `packages/core/src/knowledge/classification.ts`, `content.policy.ts`.
**Required data** body or at least one image; `visibility`.
**Optional data** `knowledgeType` (from `allowedKnowledgeTypes('post')`), `difficulty`, `topicIds`, media.
**Unsupported data** drafts, scheduling, co-authoring, polls, rich text, link previews, mentions autocomplete.

## Hierarchy — the audience is the loudest decision

Title "New post" + close → body field → language note → **"Who can see this"** → "What kind of knowledge is this" (optional) → "Difficulty" → validation → footer [Image] [Publish].

**Audience is first and is the only pre-selected control**, defaulting to `privacySettings.defaultPostVisibility`. A default nobody noticed is how a private note reaches a cohort.

Classification sits on the same screen, **not behind a settings sheet**. It starts unset and is labelled optional. Two reasons: the taxonomy is what makes this product's content searchable and filterable, so hiding it guarantees it goes unused; and guessing a label the author never agreed to is worse than an honest gap. Tapping a selected chip clears it.

**Language is detected, never asked** — `classification.ts` derives it from the body. The note says so.

## Validation — the real rules

| Rule | Source | Message |
| --- | --- | --- |
| body or image required | `content.contract.ts` | Publish stays disabled; no error text until interaction |
| body max length | contract | counter appears at 90% of the limit, challenged past it |
| image ≤ 8 MB | `MAX_IMAGE_BYTES` | "That image is too large to upload. Try one under 8 MB. Your text is kept." |
| image type ∈ jpeg/png/webp/gif | `imageMimeSchema` | "That file type is not supported. JPEG, PNG, WebP or GIF." |
| max 4 images | `MAX_MEDIA_PER_POST` | the attach control disables at 4 with "4 of 4 images" |
| upload needs a connection | — | "Publishing needs a connection." |

MIME is validated by magic bytes server-side; the client's claim is never trusted. A client-side pre-check is a courtesy, not the gate.

## Behaviour

· **Scrolling** one container; the footer is pinned and adds the bottom inset. · **Keyboard** the body field is focused on mount; the footer rises with the keyboard and stays reachable; chip sections scroll under it. At the largest text size the footer still occupies its own row — never overlapping Publish. · **Loading** the classification options come from `allowedKnowledgeTypes`; while they load, the sections render disabled rather than absent, so the layout does not jump. · **Empty** the initial state: Publish disabled, no errors. · **Error** inline ValidationMessage attached to its cause — never a toast. · **Offline** attention banner, "Your text is kept here" (scoped to *here*, because there is no draft persistence), Publish inert. · **Restricted** a viewer who cannot post to the selected audience has that chip disabled with a reason line, rather than a 403 after tapping Publish. · **Dismissal** close or sheet gesture; **no confirmation dialog and no draft** — and because the text is genuinely lost, close is 44 px and placed away from Publish. · **RTL** chips wrap from the reading edge; the body field follows the typed script, so an Arabic-first author gets an RTL field and a Latin paste stays isolated. · **Mixed script** tested with the Turn 5 body: English clinical prose + an Arabic clause + `KDIGO 2021` + `Nelson 21e p.2523`, all isolated. · **360 px** chip rows wrap to three; the footer stays pinned. · **Accessibility** each chip group is a `radiogroup` labelled by its section title; the optional label is part of the group's accessibility label; errors are polite live regions; the character counter is announced only at the threshold, not on every keystroke.

**Tested content set** short text · long text · Arabic only · mixed Arabic/English · one image · four images · all three classification pickers · every validation error · keyboard visible · largest text step · 360 px.

**Status** SUPPORTED_NOW.
**Blockers** drafts DEFERRED_PRODUCT_DECISION; topic tagging on compose is SUPPORTED_CONTRACT_NOT_UI (`topicIds` accepted, no picker designed — a picker needs topic search, which is P0-blocked).
