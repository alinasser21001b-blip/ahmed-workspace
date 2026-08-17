# Content truth audit

Rule applied: TEST_FIXTURE or DEVELOPER_COPY visible in a normal student
build = P0 pollution.

| Visible content | Class | Verdict |
|---|---|---|
| Feed posts, comments, messages, lecture names | TEST_FIXTURE (by design of a fixture pilot) | Acceptable *as data*, but: author “Preview Student” = scaffolding identity → P0 rename; EN/AR mix violates the Arabic-first claim → P0 rebalance (RC-02). |
| “Student OS Preview — sample data · بيانات تجريبية” banner | DEVELOPER_COPY (intentional disclosure) | Keep the disclosure for a fixture pilot; shrink per RC-01/05; never inside Practice. |
| “Give feedback” + feedback form | PILOT INSTRUMENT | Keep for pilot; collects no PII (verified earlier). |
| `/motion-samples` page text (durations, replay, “prototype”) | DEVELOPER_COPY | **P0 — reachable in the student build. Remove.** |
| “Topics and classrooms are not searchable yet.” | REAL_SYSTEM_DATA (honest limitation) | Keep; wording is student-facing, fine. |
| “Live delivery is unavailable…” | REAL_SYSTEM_DATA | Keep fact; redesign posture (RC-05). |
| Notifications blocked copy in Settings | REAL_SYSTEM_DATA | Same. |
| Empty-state copy (all screens) | EMPTY_STATE_COPY | Clean, student-voiced. |
| Date/context line “Second year · College of Medicine” | REAL_SYSTEM_DATA (localised) | Clean after the earlier fixture localisation. |
| Sign-in placeholder `name@uob.edu.iq` | EMPTY_STATE_COPY | Clean. |

No lorem, no TODO/FIXME strings, no debug toggles found in rendered screens.
