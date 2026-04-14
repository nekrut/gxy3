# Loom Migration: Merge pi-galaxy-analyst into gxy3

## Context

pi-galaxy-analyst is the canonical "brain" (modular extension with 5-phase lifecycle, Galaxy API, notebooks, 35 tools, 113 tests). gxy3 is the superior "shell" (Electron two-pane UI with React Flow DAG, parameter form, typed results, cost header). This plan merges the brain into the shell on a single `feature/loom-migration` branch, one PR.

**Not imported from gxy3:** `run_command`, `install_tools`, `check_process`, `cancel_command`, conda/mamba integration, test mode. Galaxy-native tools are the default execution path.

## Key Bridge Problem

- pi-galaxy-analyst emits text: `setWidget("plan-view", textLines)`
- gxy3 shell expects structured JSON: `setWidget("steps", [JSON.stringify(steps)])`

Solution: `ui-bridge.ts` adapter hooks into state mutations and emits shell-compatible JSON.

## Single PR — Commit Sequence

### Commit 1: Copy pi-galaxy-analyst files

Pure file copy, no modifications.

**Created:**
- `extensions/galaxy-analyst/` — all 11 files: `index.ts`, `state.ts`, `tools.ts`, `types.ts`, `context.ts`, `notebook-writer.ts`, `notebook-parser.ts`, `galaxy-api.ts`, `git.ts`, `profiles.ts`, `config.ts`
- `tests/` — 7 test files from pi-galaxy-analyst
- `skills/` — 6 skill directories
- `vitest.config.ts`

**Modified:**
- `package.json` — add `"pi": { "skills": ["./skills"] }`, ensure vitest in devDeps
- `tsconfig.json` — include `extensions/galaxy-analyst/**/*` and `tests/**/*`

**Check:** `npx vitest run` passes all 113 tests.

---

### Commit 2: Wire CLI + delete old extension

**Modified:**
- `bin/gxy3.js` — change extensionPath to `../extensions/galaxy-analyst`. Port from gxypi.js: legacy config migration (`~/.gxypi/` → `~/.gxy3/`), `handleInformationalCommand()`, `checkLLMProvider()`.
- `extensions/galaxy-analyst/config.ts` — config dir `~/.gxypi` → `~/.gxy3`
- `package.json` — `pi.extensions` → `["./extensions/galaxy-analyst"]`

**Deleted:**
- `extensions/gxy3/index.ts`
- `extensions/gxy3/config.ts`

**Check:** `node bin/gxy3.js --mode rpc` starts, `analysis_plan_create` in tool list.

---

### Commit 3: UI bridge adapter

**Created:**
- `extensions/galaxy-analyst/ui-bridge.ts` (~200 lines)
  - `setupUIBridge(pi)` — main entry
  - `toShellSteps(plan): ShellStep[]` — maps `AnalysisStep` → `{id, name, description, status, dependsOn, result?, command?, explanation?}` (status enums are identical in both)
  - `planToMarkdown(plan): string` — for Plan tab
  - Registers `onPlanChange` listener → emits `setWidget("plan", ...)` and `setWidget("steps", ...)`

**Modified:**
- `extensions/galaxy-analyst/state.ts` — add `onPlanChange(callback)` hook (~15 lines), called from `createPlan()`, `addStep()`, `updateStepStatus()`, `setPhase()`, `restorePlan()`
- `extensions/galaxy-analyst/index.ts` — import and call `setupUIBridge(pi)`

---

### Commit 4: Add report_result + analyze_plan_parameters tools

**Modified:**
- `extensions/galaxy-analyst/tools.ts` — add at end of `registerPlanTools()`:
  - `report_result` — `{stepName?, type, content?, headers?, rows?, path?, caption?}` → `setWidget("results", [JSON.stringify(block)])`
  - `analyze_plan_parameters` — `{title, description, groups[]}` → `setWidget("parameters", [JSON.stringify(spec)])`
- `tests/extension-integration.test.ts` — update `EXPECTED_TOOLS` list

---

### Commit 5: Merge context prompts + renderer text widgets

**Modified:**
- `extensions/galaxy-analyst/context.ts` — merge gxy3's "DON'T NARRATE" directive, execution workflow instructions, `report_result`/`analyze_plan_parameters` guidance. Preserve Galaxy/BRC/workflow context. Mode-aware: verbose during planning, silent during execution.
- `extensions/galaxy-analyst/index.ts` — trim `session_start` greeting to single sentence
- `app/src/renderer/app.ts` — in `onUiRequest`, add cases for text widget keys: `"plan-view"` → Plan tab, `"status-view"` / `"decisions-view"` / `"notebook-view"` / `"profiles-view"` → chat info messages. In `handleSlashCommand()`, add `/plan`, `/status`, `/notebook`, `/decisions`, `/profiles`.

---

### Commit 6: Tests + cleanup

**Created:**
- `tests/ui-bridge.test.ts` — tests for `toShellSteps()`, `planToMarkdown()`, `onPlanChange` firing
- `MIGRATION_PLAN.md` — this document

**Modified:**
- `README.md` — update architecture, document merged extension

**Check:** `npx vitest run` all pass. `npx tsc --noEmit` zero errors.

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Widget key mismatch | HIGH | ui-bridge.ts adapter emits shell-compatible JSON |
| Context prompt contradiction | HIGH | Mode-aware instructions (planning=verbose, execution=silent) |
| Test breakage from new tools | MEDIUM | Update EXPECTED_TOOLS list in commit 4 |
| State-to-DAG mapping | MEDIUM | `toShellSteps()` with dedicated tests |
| Config path migration | LOW | One-time copy in bin/gxy3.js |

## Verification

1. `npx vitest run` + `npx tsc --noEmit` pass
2. `cd app && npm start` — plan creation → DAG renders → results populate
3. Cost header, model switch (`--continue`), external URL handler all work
4. `node bin/gxy3.js --mode rpc` works standalone (CLI-first)

## Critical Files

| File | Role |
|------|------|
| `extensions/galaxy-analyst/state.ts` | State mutations bridge must intercept |
| `extensions/galaxy-analyst/ui-bridge.ts` | NEW — state → shell widget adapter |
| `extensions/galaxy-analyst/tools.ts` | Where new tools land |
| `extensions/galaxy-analyst/context.ts` | System prompt merge point |
| `app/src/renderer/app.ts` | Shell widget dispatcher |
| `bin/gxy3.js` | CLI entry point merge |
| `tests/extension-integration.test.ts` | Integration test with tool list |
