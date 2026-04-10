# Session notes

Terse snapshot of current work state. Update at natural checkpoints. Read at start of new sessions to sync up.

## Where we are

Phase 1, 2, 3 shipped. Phase 6 planned (GitHub push). Phase 4 (Galaxy bridge) and 5 (end-to-end prototype) not started.

Current commit on master: see `git log -1`. Running instance uses dev mode (`cd app && npm run start`).

## Recent decisions

- **Theme**: Galaxy light theme, Atkinson Hyperlegible, masthead `#2c3143`, history-item colors for DAG nodes
- **Model routing (thinking vs executing)**: discussed, NOT implemented. Recommended approach = Option 3 (tool-level delegation: cheap Haiku subprocess per execution step, Opus for planning). Deferred.
- **GitHub push**: NOT in Preferences. Option C chosen — agent handles via `gh`/SSH/PAT detection when user asks. Captured as Phase 6 in PLAN.md.
- **Directory change**: must NOT restart session. Masthead "change" button and File > Open Analysis Directory both update cwd + send `[system]` message to agent, no subprocess restart
- **Step narration**: agent told in system prompt NOT to narrate each step in chat during execution — DAG shows progress. Chat reserved for errors, completion summary, user Qs.
- **DAG layout**: SVG bezier connectors, topological layers, parallel steps side-by-side, redraws on expand/collapse with double-rAF
- **Tokens/cost**: header shows session tokens always, cost only if model is in pricing table

## Open questions

- Model routing for cost savings: pick approach & implement? (Option 3 tool delegation recommended)
- Phase 4 scope: full Galaxy MCP integration or minimal subset first?
- Phase 5 prototype scenario: which dataset exactly — `/media/anton/data/git/S_aureus/` paper + hybrid assembly pipeline
- Should gxy3 expose its own notebook format as reusable for non-bioinformatics uses?

## User preferences (important)

- **Be concise** — sacrifice grammar for brevity
- **No backup scripts, no fallbacks, no speculative abstractions** — see CLAUDE.md global instructions
- **Don't run destructive commands without asking**
- **Commit only when asked**
- **Don't narrate what you just did at end of each response** — user reads the diff

## How things work (gotchas)

- **Preload/main rebuilds require full kill-and-restart** — `Ctrl+R` only reloads the renderer
- **Vite dev server serves TypeScript directly** for the renderer (not the built files)
- **Agent subprocess cwd is set at spawn time** — that's why directory change used to restart; we moved to updating cwd in AgentManager + telling agent via chat message instead
- **Running instance logs** go to `/tmp/claude-1000/-home-anton-git-gxy3-app/<session>/tasks/<task-id>.output` — can grow large
- **Pi.dev usage events**: `message_end` on assistant messages is authoritative; each assistant message = one LLM call billed separately

## Known issues / TODO

- Stale memories at `~/.claude/projects/-home-anton-git-gxy3/memory/` may reference obsolete things — re-read before trusting
- Model routing not yet implemented (see "Open questions")
- `read_pdf` tool mentioned in Phase 3 plan but not implemented
- No test suite yet
