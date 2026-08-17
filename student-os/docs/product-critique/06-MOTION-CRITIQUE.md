# Motion critique

Judged against the approved five-sample language (calm, causal, three frozen
durations) with `motion-design` and `fixing-motion-performance` as advisory
lenses — where they conflict with the freeze (personality easing, overshoot,
staging drama), the freeze wins.

## Classification of every shipped motion
| Motion | Verdict | Note |
|---|---|---|
| Practice selection (fill+check, 120 ms) | KEEP | The approved sample, correctly generalized. |
| Practice verdict stagger (180/60) | KEEP | Causality reads; numbers never tween. |
| Practice next-question settle | KEEP | Progression-not-navigation, correct. |
| Report modal lift+fade | KEEP | 16 px, dim 45 %, exit faster — as approved. |
| Message send (draft→bubble→Sent) | KEEP | Confirms without simulating delivery. |
| Screen-entry `Enter` fades (all screens) | REDUCE | Correct but *only-on-load*: in normal use the app is static. 6 px rise at 180 ms is nearly subliminal under the banner reflow. Keep, but it cannot be the whole language. |
| Tab selection feedback | MISSING | Platform default only; the brief required it. |
| Learn → Topic survivor continuity | MISSING | Approved sample 1 — the strongest — never left the prototype. Rows plain-navigate. |
| Back-navigation continuity | MISSING (acceptable) | Deferred consciously; note it. |
| Search results settle | KEEP | One reveal per result set; no stagger — right call. |

## Performance & safety
Compositor-only (opacity/transform), native driver, no layout thrash, no
stuck animations under interruption (228/228), reduced-motion collapses to
0 ms and end-states hold. No findings.

## The one hard critique
The language was approved from samples that demonstrate *interaction* motion;
the app shipped mostly *arrival* motion. Sample 1's spatial continuity is the
piece that would make navigation feel designed, and it is absent. Until it and
tab feedback exist, Motion scores 6: technically clean, expressively thin.
