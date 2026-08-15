# Design → code map

Real paths. "Implement in the mobile app" is not an instruction.

Root: `student-os/apps/mobile/` unless stated. Contracts: `student-os/packages/contracts/src/`. Core: `student-os/packages/core/src/`.

## Per surface

### Home
- **Current** `app/(tabs)/index.tsx`, `src/components/PostCard.tsx`, `KnowledgeBadges.tsx`, `surfaces.tsx`
- **Target** rewrite `app/(tabs)/index.tsx`; **retire `KnowledgeBadges.tsx`** (the badge stack is gone); replace `PostCard` with `src/components/knowledge/ContentGrammar.tsx`
- **New components** `ContentGrammar`, `ProvenanceLine`, `MetadataLine`, `SectionHeader`, `TopBar`, `InkBand`
- **Reuse** `Text.tsx`, `states.tsx`
- **State** feed query hook; new selector for the resume-band suppression rule
- **API** feed endpoint; `content.contract.ts`, `knowledge.contract.ts`
- **Core** `ranking/feed-ranking.ts`
- **Keys** `feed.classified`, `feed.underChallenge`, `feed.resume`, `feed.resumeWhere` — **all new**
- **Conflict** `PostCard` is used by post detail and profile; migrate all three call sites together or keep both until the third lands

### Learn / Topic
- **Current** `app/(tabs)/learn.tsx`, `app/topic/[id].tsx`
- **New components** `EvidenceFraction`, `TopicRow`, `RelationshipPrimitive`, `AcademicRow`, `LowEvidenceGroup`
- **State** topic-progress hook; **must invalidate on return from Practice**
- **API** topic detail, per-type knowledge counts, progress; `knowledge.contract.ts`
- **Core** `learning/weakness.ts` (`rankWeakTopics`, `MIN_QUESTIONS_FOR_CONFIDENCE`)
- **Keys** `learn.builtFrom`, `learn.suggestDifficulty`, `learn.notEnoughEvidence`, `learn.smallSample`, `learn.privateToYou`, `learn.readyToPractise`, `topic.howItConnects`, `topic.knowledgeHere`, `topic.unseen`, `topic.answeredHere`, `topic.derivedNote`, `relation.partOf`, `relation.types`, `relation.seenWith`, `relation.appearsIn` — **all new**
- **Conflict** existing Learn strings say "Saved knowledge" / "Learning actions this week"; both counters are retired

### Practice
- **Current** `app/practice/[topicId].tsx`
- **Target** same file + `src/components/practice/` for `PracticeHeader`, `PracticeStem`, `AnswerOption`, `FeedbackPanel`, `ExplanationBlock`
- **Route** **add to `app/_layout.tsx`: `<Stack.Screen name="practice/[topicId]" options={{ presentation: 'fullScreenModal' }} />`** — currently unregistered
- **State** new `src/state/practice.ts`: attempt machine per `13`, persisted `attemptId` for resume
- **API** session GET, answer POST; `learning/practice.contract.ts`
- **Core** `learning/grading.ts` (server-side authority — the client must never grade)
- **Keys** `practice.chooseOne`, `practice.chooseAll`, `practice.check`, `practice.checkMulti`, `practice.true`, `practice.false`, `practice.youChose`, `practice.correct`, `practice.whyRight`, `practice.why`, `practice.source`, `practice.whatChanged`, `practice.answeredOnTopic`, `practice.stillSmallSample`, `practice.noTopicAttached`, `practice.submitFailed`, `practice.openTopic`, `practice.next`, `practice.finish`, `practice.complete`, `practice.backToTopic`, `practice.counter` — **all new**
- **Conflict** none; this surface is the least built

### Classroom / lecture / group
- **Current** `app/classrooms/[id].tsx`, `classrooms/index.tsx`, `classrooms/new.tsx`, `app/lecture/[id].tsx`, `app/group/[id].tsx`, `group/new.tsx`
- **New components** `ClassroomActivityRow`, `MemberAvatarRow`, `RoleLabel`, `JoinCodeField`
- **API** `learning/classroom.contract.ts`
- **Core** `policy/classroom.policy.ts`, `policy/membership.policy.ts`
- **Keys** `classroom.youAreStudent`, `classroom.youAreTeacher`, `classroom.membersOnly`, `classroom.notMemberExplain`, `classroom.joinCodePrompt`, `classroom.mostRecent`, `classroom.lectures`, `group.studyGroup`, `community.official` — **new**
- **Conflict** `classrooms.notMember` exists but its copy is generic; replace, don't reuse

### Messages
- **Current** `app/(tabs)/chat.tsx`, `app/chat/[id].tsx`, `src/state/outbox.ts`, `src/state/realtime.tsx`
- **New components** `ConversationRow`, `MessageBubble`, `UnreadDivider`, `Composer`, `ConnectionLine`
- **Core** `messaging/message-state.ts` — use `advance()`, never assign state directly; `retryDelayMs`, `shouldRetry`, `unreadCount`
- **API** `social/messaging.contract.ts`
- **Keys** `chat.queued`, `chat.sending`, `chat.sent`, `chat.delivered`, `chat.read`, `chat.failed`, `chat.retry`, `chat.unread`, `chat.reconnecting`, `chat.readOnlyReason`, `chat.deleted` — `chat.readOnly` exists, the rest **new**
- **Conflict** three of six message states are currently unrepresented in the UI

### Search
- **Current** `app/search.tsx`
- **New components** `SearchResultRow` (4 shapes), `SearchSectionHeader`
- **Core** `text/arabic.ts` `normalizeArabic` — must stay in step with `sos_normalize_arabic` (migration 0009)
- **Keys** `search.people`, `search.studyGroups`, `search.knowledge`, `search.communities`, `search.topics` (deferred), `search.classrooms` (deferred), `search.noResults`, `search.tryShorter`, `search.needsConnection` — **new**
- **Conflict** result-type headings do not currently distinguish groups from communities

### Profile
- **Current** `app/profile/[handle].tsx`
- **New components** `ProfileIdentity`, `InterestList`, `RelationshipAction`
- **API** `users/users.contract.ts`; `apps/api/src/modules/social/*` for follow/block
- **Core** `policy/interaction.policy.ts`
- **Keys** **`social.follow`, `social.following`, `social.unfollow`, `social.blocked`, `social.unblock`, `profile.contributionScore`, `profile.unavailable`**
- **Conflict — the known bug:** the follow control renders from `groups.join` / `groups.leave`. Fix with the new keys; do not rename the group keys, which are still correct for groups

### Compose
- **Current** `app/compose.tsx`
- **New components** `ChipPicker`, `ValidationMessage`, `MediaAttachRow`
- **API** `social/content.contract.ts`, `social/files.contract.ts`
- **Core** `knowledge/classification.ts` (`allowedKnowledgeTypes`, language detection), `policy/content.policy.ts`
- **Keys** `compose.whoCanSee`, `compose.whatKind`, `compose.optional`, `compose.clearHint`, `compose.languageDetected`, `compose.difficulty`, `compose.imageTooLarge`, `compose.imageUnsupported`, `compose.needsConnection`, `compose.imagesCount` — **new**

### Auth / onboarding
- **Current** `app/(auth)/sign-in.tsx`, `sign-up.tsx`, `app/(onboarding)/index.tsx`, `app/index.tsx`, `src/state/session.tsx`
- **New components** `FormField`, `StepProgress`
- **API** `auth/auth.contract.ts`, `users.contract.ts` (`completeOnboarding`, `handleAvailability`)
- **Keys** `auth.credentialsMismatch`, `auth.suspended`, `auth.needsConnection`, `auth.rateLimited`, `auth.sessionEnded`, `auth.closedToCollege`, `onboarding.handleRules`, `onboarding.handleAvailable`, `onboarding.interestsAffect`, `onboarding.step` — partly exist via `messageKeyFor`; **audit before adding**

### Notifications — blocked
- **Target** `app/notifications.tsx` (new) + route registration; `src/components/NotificationRow.tsx`
- **Core** `events/domain-events.ts` `NOTIFICATION_RULES`
- **Backend** producer, outbox drain, list/read routes — none exist

### Compliance
- **Target** `app/settings/index.tsx` **(exists)**, `app/settings/blocked.tsx` **(exists)**, `app/settings/delete-account.tsx` **(exists)**, `src/components/ReportSheet.tsx` **(exists — the modal IS the V1 contract; do not build a route)**, `src/components/ActionSheet.tsx` **(exists)**; `settings/privacy.tsx` — still new
- **API** privacy, block, report **and deletion all exist**. `DELETE /v1/me/account`, `POST /v1/reports`, `GET/POST /v1/moderation/reports`. **No backend work in this pass**
- **Deletion** implement the seven lifecycle states from `24` on the two existing routes — warning above the fields, submit-as-processing, success replacing the control, two distinct failure messages, retry by re-press, support link on the generic branch only
- **Outstanding** the two deletion copy strings and the state-7 support link (`24`); delete the dead `settings.deleteAccount.confirmTitle` key from both locales (do not render it); remove `variant="micro"` from `settings/index.tsx` and `settings/delete-account.tsx`; the privacy route

### Auth
- **Target** `app/(auth)/forgot-password.tsx` **(exists)**, `app/(auth)/reset-password.tsx` **(exists)**, `app/(auth)/sign-in.tsx` **(exists — carries the `auth.forgotPassword.link` entry)**
- **Spec** `20-AUTH-ONBOARDING.md` §Forgot password, §Reset password — first specification for both; conform the shipped screens to it
- **API** `POST /v1/auth/{forgot-password,reset-password}`, migration 0016, `platform/mailer.ts` — all exist, none changes
- **Outstanding** sent-state focus move and live region; deep-link token pre-fill (`scheme: studentos`) alongside the typed path; the three standardised "reset link or code" strings in both locales

## Theme

- **File** `src/theme/tokens.ts` — apply `05-TOKENS.md` §Required changes
- **Highest-risk change** `colors.learning` → `colors.provenance`, and re-point every call site to `colors.text` where it meant a learning action
- **Delete** `typography.micro` (**retired — final UI must not use it**; re-point the two settings call sites to 13/20 metadata in the same change), `radius.xl`, and `shadow.card` usage on content
- **Fonts** `expo-font` at root, ten static faces per `tokens.json` → `fontsToBundle`
- **Do not** add `tokens.json` as a runtime import

## Missing-translation summary

Roughly **95 new keys** across the surfaces above, each needed in `en` and `ar`. Arabic strings carrying a count must resolve through `selectPlural` (six categories) — a concatenated count is a bug. Audit `src/i18n/en.ts` and `ar.ts` before adding, since some auth keys already exist.
