# Classroom, lecture, group

## Classroom

**Route** `app/classrooms/[id].tsx` (list: `classrooms/index.tsx`, create: `classrooms/new.tsx` modal)
**Purpose** Show the academic activity of one course block — its lecture sequence, its people, and the way in.
**Primary user question** "What academic activity is happening here, who is involved, and what can I do next?" — not "who belongs to this group?"
**Dominant action** member view: the ink band opening the most recent lecture. Non-member view: "Join classroom".
**Secondary actions** member list ("See all"), lecture rows, join-by-code (staff only).

**Source repo files** `app/classrooms/[id].tsx`, `app/classrooms/index.tsx`, `packages/contracts/src/learning/classroom.contract.ts`, `packages/core/src/policy/classroom.policy.ts`, `membership.policy.ts`.
**Required data** classroom identity (title, course code, owner), `memberCount`, `lectureCount`, `viewer.{canRead, canJoin, canTeach, role}`, lectures (`LectureSummary`: index, title, material count, duration, publishedAt) when `canRead`.
**Optional data** description, member summaries, join code (**staff only — the server sends null to everyone else**).
**Unsupported data** attendance, who viewed a lecture, teacher analytics, grades, live session status, "practise this lecture", per-student progress visible to staff.

## Two shapes, chosen by the server

`viewer.canRead === false` means the roster and lectures are **never fetched**. The non-member view is therefore a genuinely different screen with less in it — not a blurred or locked version of the member view. Getting this wrong leaks the lecture list.

| | Member | Non-member |
| --- | --- | --- |
| Identity, description, counts | yes | yes |
| Role label | "You are a student here" (structure) | none |
| Members | avatar row + See all | none |
| Lectures | numbered list | none |
| Dominant action | open most recent lecture | Join classroom |
| Explanation | — | "Lectures, materials and the member list are only sent to members." |
| Join code field | staff only | only where the room accepts codes |

## Why lectures are the screen

A classroom's academic content *is* its lecture sequence. Numbered rows with material counts answer "what is happening here" in a way a member list never does. Roles are a single structure-coloured label; counts are metadata text, not pills — Turn 3 retired count-pills and this is where that pays.

**The member avatar row is a wrapping row, not a horizontal scroller** (no nested scrolling), capped at 6 avatars plus a dashed +N.

## Behaviour

- **Scrolling** one container; the ink band sits above the tab bar, scrolling with content.
- **Keyboard** the join-code field raises the keyboard; the field scrolls into view above it.
- **Loading** skeleton with the real header; the lecture list as three row blocks.
- **Empty** member view, no lectures → "No lectures posted yet" + action "See members". Non-member view is never empty.
- **Error** ErrorState + Retry.
- **Offline** cached member view; Join inert with a banner.
- **Restricted** `canRead: false` is the non-member view, not an error state. A 403 on a room outside the viewer's scope is RestrictedState with back.
- **Deleted** "This classroom is no longer available" + back.
- **RTL** lecture numbers Arabic-Indic (`٩ · أمراض الكبيبات`); chevrons flip; the join code stays LTR with leading alignment in both languages, because a code shown right-to-left is a code the student did not type.
- **Mixed script** Arabic classroom title with a Latin course code isolated.
- **Dynamic Type** titles wrap to three lines; lecture rows grow from 66 px.
- **360 px** the third lecture row may fall below the fold.
- **Accessibility** the role label is announced with the title. Each lecture row is one label: "Lecture 9, Glomerular disease, 6 materials, 50 minutes, posted yesterday". The avatar row is one element: "24 members".

**Status** SUPPORTED_NOW.
**Blockers** attendance, analytics, live status, lecture↔topic and lecture↔practice linkage — all BLOCKED_BY_PRODUCT_CAPABILITY.

## Lecture + materials

**Route** `app/lecture/[id].tsx`. Title with its index, duration, published date, then materials as an AcademicRow group (file name, type, size). Materials use the signed-URL `FileRef`; treat `expiresAt` as real and refetch rather than caching the URL.

No topic linkage exists, so **no practice affordance appears here**. **Status** SUPPORTED_CONTRACT_NOT_UI.

## Group — and how it differs from a Classroom

**Route** `app/group/[id].tsx` (create: `group/new.tsx` modal)

| | Classroom | Group |
| --- | --- | --- |
| Formed by | teaching staff | students |
| Content | lecture sequence + materials | posts |
| Roles | teacher / student, from `verificationLevel` and room policy | owner / moderator / member |
| Joining | membership policy, sometimes a code | join or request, per policy |
| Noun in UI | "Classroom" | "Study group" |
| Screen shape | numbered lectures | a post list |

The distinction is invisible today until you are inside one. Fix: **distinct nouns everywhere**, including search headings, and a course code on every classroom row. Communities are a third thing — official, topic-scoped, carrying an "Official" label.

**Status** SUPPORTED_NOW; the search-side differentiation is specified in `16`.
