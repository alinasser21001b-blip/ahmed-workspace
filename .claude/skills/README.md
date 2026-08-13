# Skills

Expo / React Native skill set, reachable through the `/skillpro` command
(`.claude/commands/skillpro.md`), which routes a request to the right skill(s).

## Contents

| Skill | Origin |
| --- | --- |
| `expo-starter` | Written for this workspace from [kanzitelli/expo-starter](https://github.com/kanzitelli/expo-starter) (MIT) — template conventions, recipes, file templates. |
| 20 `expo-*` / `eas-*` skills | Vendored verbatim from [expo/skills](https://github.com/expo/skills), `plugins/expo` v1.10.1 (MIT, © 650 Industries). |
| `expo-migrate-module` | Vendored verbatim from the same repo, `plugins/expo-experiments`. |

`LICENSE-expo` is the upstream MIT license covering the vendored skills.

## Using them in every project

This directory is project-scoped. To make the skills and `/skillpro` available in **all** projects on
a machine, install them into `~/.claude`:

```bash
bash scripts/install-skillpro.sh              # install or update
bash scripts/install-skillpro.sh --uninstall  # remove
```

It copies each skill to `~/.claude/skills/<name>` and the command to
`~/.claude/commands/skillpro.md`, replacing only what it owns. `~/.claude/skills/synced` (skills from
your Claude account) is left alone. Set `CLAUDE_CONFIG_DIR` to target a different config directory.

This repository stays the source of truth: re-run the installer after pulling changes, and on any
new machine or fresh remote session, since `~/.claude` is not part of the repo.

## Deliberate omissions

- **`expo-skill-feedback`** — its telemetry commands resolve `${CLAUDE_PLUGIN_ROOT}`, which only
  exists when the skills are installed as a Claude Code plugin. Feedback can still be sent with
  `npx --yes submit-expo-feedback@latest "..."`.
- **Plugin hooks** (`hooks/hooks.json`) — usage telemetry on every Skill invocation. Not installed,
  so nothing is reported.
- **Expo MCP server** (`https://mcp.expo.dev/mcp`) — not configured; add it to `.mcp.json` if live
  docs lookups are wanted.

## Updating the vendored skills

```bash
git clone --depth 1 https://github.com/expo/skills.git /tmp/expo-skills
cp -r /tmp/expo-skills/plugins/expo/skills/* .claude/skills/
cp -r /tmp/expo-skills/plugins/expo-experiments/skills/expo-migrate-module .claude/skills/
rm -rf .claude/skills/expo-skill-feedback
git checkout .claude/skills/README.md   # upstream ships its own README.md that clobbers this one
```

Check `plugins/expo/.claude-plugin/plugin.json` upstream for the version you pulled, and update the
table above. `expo-starter` is maintained here, not upstream — do not overwrite it.
