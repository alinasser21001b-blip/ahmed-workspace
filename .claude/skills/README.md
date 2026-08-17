# Installed skills

Repo-local skills, checked into git so every clone and every session (including ephemeral remote
containers) loads the same set without a network fetch. `skills-lock.json` at the repository root
pins each skill's source repository, path and content hash.

## Roster

### Coordinator (repo-local, authored here)

| Skill | Purpose |
| --- | --- |
| `ui-ux-skills-animated` | Registers the `use the UI/UX skills animated` trigger phrase and runs the whole UI/UX + motion stack as one pipeline, bounded by the frozen Student OS design. |

### Motion design — [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill)

| Skill | Purpose |
| --- | --- |
| `motion-design` | Motion direction, easing, timing, choreography, entrance/exit, loading/success/error motion, reduced motion. Implementation-agnostic; consult before code. |

### Interface / UI polish / accessibility suite — [jakubkrehel/skills](https://github.com/jakubkrehel/skills) (`interfaces` v1.3.0)

| Skill | Purpose |
| --- | --- |
| `better-interface` | Coordinator for the `better-*` family; one ranked verdict across domains. |
| `better-ui` | UI polish, micro-interactions, enter/exit, motion restraint, icons. |
| `better-typography` | Fonts, type scale, spacing, wrapping, punctuation, text accessibility. |
| `better-colors` | Palette structure, token naming, contrast. |
| `better-accessibility` | Focus and keyboard, ARIA and semantics, forms, screen readers, hit areas, motion and zoom. |
| `better-layout` | Grouping and alignment, spacing, adaptivity, RTL direction. |
| `better-writing` | UX writing and interface copy. |
| `interface-review` | Change-scoped interface review (uncommitted work, branch, PR). Carries `disable-model-invocation: true` — invoke it explicitly. |

### Claude design / motion engineering suite — [master5d/claude-design-skills](https://github.com/master5d/claude-design-skills) (`design-skills`)

| Skill | Purpose |
| --- | --- |
| `emil-design-eng` | Animation polish and motion review (Emil Kowalski's principles). |
| `baseline-ui` | Catches generic / AI-looking UI regressions; animation and typography constraints. |
| `fixing-motion-performance` | Compositor-only animation, layout-thrash prevention, scroll performance. |
| `fixing-accessibility` | ARIA, keyboard nav, focus traps, WCAG audit. |
| `interface-design` | Intent and hierarchy. **Not** for redesigning the frozen Student OS design. |
| `fixing-metadata` | Open Graph, canonical URLs, structured data, favicons. Applies to the static site, not the mobile app. |

## How these were installed

Project scope, real files rather than symlinks, so the tree is committable:

```bash
npx skills add LottieFiles/motion-design-skill  --skill '*' --agent claude-code --copy -y
npx skills add jakubkrehel/skills               --skill '*' --agent claude-code --copy -y
npx skills add master5d/claude-design-skills    --skill '*' --agent claude-code --copy -y
```

## Updating

```bash
npx skills update --project -y   # then review the diff before committing
npx skills list                  # show what is installed
```

## Plugin install (alternative — not used here)

Both upstream suites also ship as Claude Code plugins:

```
/plugin marketplace add jakubkrehel/skills
/plugin install interfaces@interfaces
```

That path was **not** used, deliberately. Plugin installs are written to user-level config
(`~/.claude`), which is not committed and does not survive this project's ephemeral remote
containers; and enabling the plugin alongside these vendored copies would register every `better-*`
skill twice. Pick one mechanism. If you switch to plugins later, delete the corresponding
directories here and the matching `skills-lock.json` entries in the same change.

## Boundary

These skills are advisory. They do not outrank `student-os/docs/design-handoff/`,
`FINAL-FREEZE.md`, the approved visual reference, or current repository/backend truth. See
`CLAUDE.md` and `ui-ux-skills-animated/SKILL.md`.
