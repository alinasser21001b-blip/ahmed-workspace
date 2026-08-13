# Product Architecture — Student Social Learning OS

> Status: **Approved.** This document is the product half of the architecture
> gate required before implementation (Constitution §89.A). §1.1 was added
> during Phase 4 and constrains every phase after it.

## 1. What this product is

A **social learning operating system** for a high-density student cohort.

It is deliberately *not* three products stapled together. The differentiator is
that social interaction, communication, content, and learning are the **same
graph** viewed from different angles. A reel is not "a video" — it is a node
attached to a Topic, which is attached to a Course, which the student is
enrolled in, which has Lectures, which generate Quizzes, whose results update
the student's Learning Graph, which decides what the feed shows next.

If a feature cannot be attached to that graph, it does not belong in V1.

### 1.1 Knowledge is the social object

The sentence that decides arguments about scope:

> **Knowledge is the social object.**

This is an *academic social learning network*, not a social network with
educational content on it. The social layer exists to move knowledge between
people. Every significant interaction should end up attached to an academic
context.

What that rules out, as constraints rather than preferences:

| Not built | Because |
| --- | --- |
| General-interest social content | The cohort is here for a degree; a feed that carries anything else competes with the thing it exists to serve |
| An entertainment-first feed | The feed answers "what is academically useful to me now?", not "what will keep this person scrolling?" |
| An influencer or viral-content model | Academic relevance outranks popularity. A correct answer from a quiet student beats a popular one |
| Engagement mechanics aimed at screen time | Time in the app is a cost to the student, not a metric |
| Short-form video as an entertainment surface | If video ships, it is **micro-learning** attached to a topic, a course and a lecture — never a scrolling feed of clips |

And what it requires:

- **Knowledge must stay discoverable.** A good explanation typed into a group
  chat is currently lost to everyone who was not reading at the time. Chat is
  communication; posts, questions, answers and resources are persistent
  knowledge. The two stay separate, and the architecture must eventually allow
  the second to be *promoted out of* the first — without messaging becoming a
  knowledge store, and without knowledge becoming a chat log.
- **Content must carry its intent.** Not "what's on your mind" but *ask a
  question*, *explain something*, *share a resource*, *share notes*, *present a
  case*, *start a discussion*, *poll*, *announce*. `content_items.kind` already
  models this; the creation UI must eventually ask for it, because a system
  that does not know what a piece of content *is* cannot rank, route or
  retrieve it usefully.
- **Groups are learning spaces**, not a member list with a chat attached. A
  group should be able to grow discussions, resources, questions, study
  sessions and its own academic context.
- **AI is part of the academic system**, not a chatbot beside it: tutor,
  examiner, librarian, curator — all reading the platform's own structured
  knowledge and community signals, and all through the same authorization layer
  as a human.

**The shape this imposes on the data model** — and the reason it is recorded
here rather than in a backlog — is that the domain is *not*
`Users → Posts → Comments`. It is:

```
Users → Academic Context → Knowledge → Interaction → Learning Signals
      → Recommendations → AI
```

A knowledge object must be connectable to a course, a topic, a community, an
author, its sources, related knowledge, and the learning activity it produced.
`content_items` (ADR-0002) is that spine, `content_links` is the
related-knowledge edge, and `learning_events` is the signal channel — all three
present since Phase 0 and deliberately unused until the phase that needs them.

None of this is built ahead of its phase. It is written down so that no phase
builds something that makes it harder.

## 2. The product loop

```
Open App → Discover academic content → Watch/Read/Discuss → Join group/chat
   → Learn → Practice → AI assistance → Track weakness → Return
```

Every domain below declares which step of the loop it serves. A domain that
serves no step is out of scope.

| Domain        | Loop step served                          |
| ------------- | ----------------------------------------- |
| Feed          | Discover                                  |
| Posts / Reels | Discover, Discuss                         |
| Communities   | Discover, Join                            |
| Groups        | Join, Learn (together)                    |
| Messaging     | Discuss, Join                             |
| Classrooms    | Learn                                     |
| Lectures      | Learn                                     |
| Quizzes       | Practice                                  |
| Flashcards    | Practice                                  |
| AI            | AI assistance (layer over all of the above) |
| Learning graph| Track weakness → Return                   |

## 3. Target cohort

V1 targets **one dense cohort**, not 100 scattered users:

```
University of Baghdad → College of Medicine → Stage 5 → ~100 students
```

Density is a product requirement, not an accident. Feed relevance, group
formation, and social proof all degrade badly at low density. The academic
hierarchy is therefore **data-driven** (§8 of the Constitution) so a second
cohort is a row insert, never a code change.

## 4. Domain map

Three interlocking graphs. They share primary keys; they are not separate
systems.

### 4.1 Social Graph
```
student ──follow──▶ student
student ──member──▶ group ──belongs──▶ community
student ──member──▶ conversation ──has──▶ message
student ──blocks/mutes──▶ student
```

### 4.2 Content Graph
```
post | reel | resource | lecture | quiz | discussion
        └──▶ topic ──▶ subject ──▶ course ──▶ stage ──▶ program ──▶ college ──▶ university
```
Every content object carries an **academic context** (course/subject/topic) and
a **visibility scope**. Content without academic context is allowed but ranks
lower and is not reachable by academic search.

### 4.3 Learning Graph
```
student ──enrolled──▶ course
student ──activity──▶ topic  (learning_events: viewed, attempted, answered)
student ──performance──▶ topic (learning_progress: mastery signal, weakness)
weakness ──▶ recommendation ──▶ next learning action
```

### 4.4 The joins that make it one system

These are the edges that justify the product's existence and must exist in the
schema from day one, even before the features that consume them ship:

| Edge | Table / column | Enables |
| --- | --- | --- |
| content → topic | `content_topics` | "Everything about nephrotic syndrome" |
| reel → lecture | `content_links` | Reel → related lecture → quiz |
| lecture → quiz | `quizzes.lecture_id` | Learn → practice in one tap |
| quiz answer → topic | `quiz_questions.topic_id` | Question-level weakness detection |
| group → course | `groups.course_id` | Group chat that knows what it studies |
| AI answer → source | `ai_sources` | Grounded citations |
| any activity → learning event | `learning_events` | Recommendations, north-star metric |

## 5. Actors

| Actor | V1 capability | Deferred |
| --- | --- | --- |
| **Student** | Full: profile, social, groups, chat, classrooms, learning, AI | — |
| **Instructor** | Create classroom, upload material, create lecture/quiz, host live | Grading, attendance analytics |
| **Admin** | Users, communities, moderation, reports, hierarchy, announcements | Billing, org management |
| **Institution** | *Schema reserved* (`institutions`, verification level) | Full org self-service |

Roles are **global** (`users.role`) plus **contextual** (`group_members.role`,
`classroom_members.role`, `community_members.role`). Never conflate the two:
being an instructor globally does not grant write access to another
instructor's classroom.

## 6. Product principles → enforcement

Principles are worthless unless something fails when they are violated. Each
principle below names the mechanism that enforces it.

| Principle | Enforcement mechanism |
| --- | --- |
| Academic-first | `content_topics` + academic context columns; feed ranking weights academic relevance |
| Social learning | Groups/conversations attached to courses, not standalone |
| AI-native | AI is a gateway module over existing domains, never a separate content silo |
| Source-grounded AI | `ai_sources` rows required for course-scoped answers; validator rejects citations not in retrieved set |
| Privacy-first | A single `packages/core/policy` authorization layer used by **API, search, files, and AI alike** |
| Modular architecture | Modular monolith; module boundary lint rule; no cross-module repository imports |
| Production-minded | Migrations, typed contracts, tests, CI, structured logs from commit #1 |
| MVP discipline | Roadmap phases; `DO NOT BUILD YET` list is enforced in review |

### 5.1 The single-authorization rule

The most important architectural rule in this product:

> **There is exactly one authorization implementation. The UI, the REST API,
> search, file access, and the AI retrieval pipeline all call it.**

`canViewContent(actor, resource)` lives in `packages/core` as a pure function
over an `AuthorizationContext`. The AI gateway does not get a "trusted" path.
This is what makes §29 (AI permissions) provable instead of aspirational, and it
is directly unit-tested.

## 7. Reputation & verification

Reputation is **contribution-based**, not follower-based (§37). The signal set
in schema from day one: helpful answers, accepted answers, useful resources,
quiz authorship, group contribution. Follower count is stored but explicitly
excluded from `contribution_score`.

Verification levels: `unverified → student → instructor → official`, plus an
orthogonal `admin` role. Badges render from `verification_level`.

## 8. What V1 deliberately excludes

Per Constitution §86, and reserved-but-not-built in schema: payments, ads,
marketplace, monetization, ML recommendation, custom video infrastructure,
custom cryptography, microservices, Kubernetes, enterprise org management,
full grading/LMS replacement, follower economy.

Added by §1.1, and excluded permanently rather than deferred: an
entertainment-first feed, a virality or influencer model, engagement mechanics
whose purpose is screen time, and short-form video as anything other than
micro-learning attached to an academic context.

## 9. North-star metric

**Weekly Active Learners** = distinct students with ≥1 *meaningful learning
action* in a 7-day window.

A meaningful learning action is an emitted `learning_event` of kind:
`lecture_section_completed`, `quiz_completed`, `academic_discussion_participated`,
`study_session_completed`, `flashcards_reviewed`, `ai_learning_interaction`.

Explicitly **not** counted: screen time, feed scroll depth, reel watch time.
The metric is computed from `learning_events`, which is why that table is Phase
0 infrastructure rather than a Phase 11 afterthought.
