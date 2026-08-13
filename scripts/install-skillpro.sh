#!/usr/bin/env bash
# Install the Expo skill set + /skillpro command globally, so they are available
# in every project on this machine (~/.claude), not just this repository.
#
#   bash scripts/install-skillpro.sh            # install / update
#   bash scripts/install-skillpro.sh --uninstall
#
# Safe to re-run: it replaces only the skills it owns and leaves everything else
# under ~/.claude untouched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SKILLS="$REPO_ROOT/.claude/skills"
SRC_COMMANDS="$REPO_ROOT/.claude/commands"
DST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Skills owned by this installer (everything shipped in .claude/skills).
mapfile -t OWNED < <(find "$SRC_SKILLS" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)

if [[ "${1:-}" == "--uninstall" ]]; then
  for s in "${OWNED[@]}"; do
    rm -rf "${DST:?}/skills/$s"
  done
  rm -f "$DST/skills/LICENSE-expo" "$DST/commands/skillpro.md"
  echo "Removed ${#OWNED[@]} skills and /skillpro from $DST"
  exit 0
fi

mkdir -p "$DST/skills" "$DST/commands"

for s in "${OWNED[@]}"; do
  rm -rf "${DST:?}/skills/$s"
  cp -r "$SRC_SKILLS/$s" "$DST/skills/$s"
done
cp "$SRC_SKILLS/LICENSE-expo" "$DST/skills/LICENSE-expo"
cp "$SRC_COMMANDS/skillpro.md" "$DST/commands/skillpro.md"

echo "Installed ${#OWNED[@]} skills into $DST/skills:"
printf '  %s\n' "${OWNED[@]}"
echo "Installed /skillpro into $DST/commands/skillpro.md"
echo
echo "Restart Claude Code (or start a new session) to pick them up."
