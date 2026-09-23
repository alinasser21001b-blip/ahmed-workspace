# Codebase location report

**Date:** 2026-09-23 · **Result: NOT FOUND** among the sources this cloud
session can reach. That does not show the codebase doesn't exist. See
[Likely explanation](#likely-explanation).

The question was whether the existing Obesity & Healthy Lifestyle Platform
codebase can be found. The one expected at `~/obesity-platform`, with
`apps/api`, `apps/dashboard`, `apps/mobile`, `packages/contracts`,
`packages/core`, migrations, Playwright E2E and `ARCHITECTURE.md` /
`BETA_SCOPE.md` / `DECISIONS.md` / `SECURITY_NOTES.md`.

## What was searched

Markers: the path or name `obesity-platform`, the files `BETA_SCOPE.md` and
`SECURITY_NOTES.md`, and the strings `@ohp/contracts`, `@ohp/core`,
`ohp-beta`, `partner_place`, `current_health_checkin`, `followup_case` and
`obesity`.

| Source | Scope | Result |
| --- | --- | --- |
| This container's filesystem | `find` over `/`, including `/root` (`~`) and `/home/user`, for `*obesity*`, `BETA_SCOPE.md`, `SECURITY_NOTES.md`, `ohp*` | Only the uploaded handoff `.docx`. No `~/obesity-platform` |
| `ahmed-workspace` | All 25 branches, full history (`git log --all -S`, `git grep` on every branch tip) | Nothing apart from the P0 docs written in this session. One related branch, below |
| `IQ-care` | All 7 branches (tips). Read only, nothing changed | No markers. It is the Baghdad care-access platform, not this product |
| `dawai` | All 3 branches (tips) | The word "obesity" appears only in pediatrics OSCE study content |
| `opero` | All 2 branches (tips) | The word "obesity" appears only in medical study notes (`notes/anki/`) |
| `adlytic` | All 57 branches (tips) | No markers |
| GitHub repositories visible to this session | `list_repos`: 5 repositories in total, and the list is complete | These are the five repositories above. There is no other repository |
| Claude Code cloud sessions | All 35 sessions on the account, 2026-03-29 to 2026-09-23 | None is about an obesity platform or `~/obesity-platform` |

**Related but not the codebase:**
`ahmed-workspace` branch `claude/bariatric-platform-readiness-d9rp2o`, latest
commit `2997faf` (2026-09-16). It holds `bariatric-care/`: a pre-approval
readiness report, risk register, stack evaluation and ADRs for the **old
bariatric clinic concept**, with no application code ("No application code
exists in this directory"). It was never merged to `main`. It is the concept
the handoff replaces (handoff §4), so it is useful background for the gap
audit.

## Limits of this search

- In the four repositories other than ahmed-workspace, only branch tips were
  searched, not full history. A codebase that was committed and later deleted
  from every branch would be missed.
- `list_repos` shows only repositories the Claude GitHub App is installed on.
  A repository on another GitHub account, or one the app isn't installed on,
  is invisible from here.
- Cowork sessions could not be listed from this session.
- Nothing on your own computer is reachable from this container.

## Likely explanation

`~/obesity-platform` is a home-directory path. Cloud sessions clone
repositories into `/home/user/<repo>`, not `~/`. That path, and the fact
that no cloud session matches, point to the codebase having been built in
**Claude Code on your own computer** (the CLI or the desktop app), or in a
Cowork session. If it was never pushed to GitHub, it exists only on that
machine.

## To resolve this

On the machine where it was built, run:

```bash
cd ~/obesity-platform && git remote -v && git branch -a && git log -3 --oneline && git status -sb
```

- **It has a remote:** send me the repository URL. If the Claude GitHub App
  isn't installed on it, install it; then I can attach it here.
- **It has no remote:** create an empty private GitHub repository, push the
  project to it (`git remote add origin … && git push -u origin --all`), and
  send me the name.

Once it's reachable, the next step is the Product Truth Gap Audit (Keep /
Modify / Delete / Missing) against that code. The documents in this folder
get merged into it; they are not a second project.
