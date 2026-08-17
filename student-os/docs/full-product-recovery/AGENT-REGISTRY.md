# AGENT REGISTRY — discovered before any code was touched

Task: `STUDENT_OS_TOTAL_RECOVERY_AND_PRODUCTIZATION_V2` · Section 1 (mandatory agent discovery)
Discovery date: 2026-08-17 · Discovered from the live session's actual tool surface, not from wishes.

## What "agent" means in this environment

Two real mechanisms exist for delegated execution:

1. **The `Agent` tool** — spawns a subagent of a named type with its own context and tool set.
2. **The `Workflow` tool** — deterministic orchestration of many subagents (`agent()` calls
   with schema-forced structured outputs, `parallel()` / `pipeline()` fan-out). Ultracode mode
   is ON for this session, so Workflow is the sanctioned vehicle for substantive fan-out.

There is no marketplace of pre-installed specialist agents (no "security-auditor" binary, no
"i18n-agent" plugin). The specialist roles the task requires are therefore staffed by
instantiating the generic agent types below with role-specific charters, and the evidence of
each activation is recorded in `AGENT_EXECUTION_LEDGER.md`.

## Discovered agent types

| Agent type | Tools | Relevant? | Use in this task |
|---|---|---|---|
| `claude` | all | YES | Catch-all executor; Workflow subagents run on this class. |
| `general-purpose` | all | YES | Multi-step research/verification runs. |
| `Explore` | read-only search | YES | Read-only forensic sweeps (Phase A is READ ONLY by decree). |
| `Plan` | read-only + planning | YES | Phase B implementation-strategy input. |
| Workflow subagents | all (+ StructuredOutput) | YES | The Phase A audit fleet and Phase F adversarial fleet — every invocation journaled by the Workflow runtime (run id + per-agent transcript), which is the execution evidence. |
| `claude-code-guide` | docs lookup | NOT_USED | Answers questions about Claude Code itself; no bearing on Student OS. |
| `statusline-setup` | Read, Edit | NOT_USED | Configures the CLI status line; irrelevant, and Phase A forbids writes. |

## Discovered skills (branch `claude/install-uiux-animated-skills-a18r6n`, `.claude/skills/`)

16 skills present: `baseline-ui`, `better-accessibility`, `better-colors`, `better-interface`,
`better-layout`, `better-typography`, `better-ui`, `better-writing`, `emil-design-eng`,
`fixing-accessibility`, `fixing-metadata`, `fixing-motion-performance`, `interface-design`,
`interface-review`, `motion-design`, `ui-ux-skills-animated`, plus `README.md`.
Per-skill status, what was applied, and what was rejected (and why) live in
`SKILL_EXECUTION_LEDGER.md`. Standing rule restated: skills advise; repository truth, the
frozen design system, and owner decisions override them.

## Also present, not agents

- **MCP tool servers** (Netlify, GitHub, others): tools, not agents — used directly for
  deploy verification and git-hosted operations.
- **CI** (`.github/workflows/ci.yml` at the repo root): a check, not an agent.

## Honesty constraints this registry operates under

- No agent is claimed to have run unless `AGENT_EXECUTION_LEDGER.md` carries its evidence
  (workflow run id, agent label, files read, findings produced).
- Roles from the task's Section 2 that map to no distinct installed agent are staffed by
  chartered instances of the generic types above — stated as such, never dressed up as
  bespoke specialists.
