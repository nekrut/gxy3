# Goal

To develop a lightweight desktop app that would be able to execute data analyses using local compute for small-to-medium tasks and usegalaxy.org infrastrcture for large tasks. 

# Details

The app's interface should have two halves: the first half is similar to calude code - users types queries and recieves answers. The right pane is similat to current claude artifacts. It will allow user to see and edit plans. Once plans are accepted it will showsd graphical representation of plan's setps and reflect their completion. 

As a prototype analysis use analsys performed in /media/anton/data/git/S_aureus. It should work something like this:

- Start app. Both panes are empty. The left pane shows prompt
- In the right pane I type: "analyze the following paper: /media/anton/data/git/S_aureus/ms/s41467-025-57575-2.pdf". Identify samples that have both Illumina and ONT data and assemble them with autocycler. Before doimg anything create a plan and show it to me"
- Once I hit enter the agents thinks, analyzes teh paper (essentially comes up with a plna like the one you can see in /media/anton/data/git/S_aureus/hybrid_assemblies/PLAN.md). This plan is shown in the left pane that acts as a simple text editor. There I can edit it and save. 
- Then in the right pane I type: execute
- Left pane shows graphical representation of steps from the plan and shows the progress.
- Once the analysis is done, it text and graphical artifacts are shown in the right pane. 

# Things to consider:

- The app should connect to a galaxy instance via API key (see /media/anton/data/git/galaxy-skills and /media/anton/data/git/galaxy-mcp)
- For information about galaxy see: /media/anton/data/git/galaxy-brain and /media/anton/data/git/galaxy
- You can resuse iseas for building an app from /media/anton/data/git/pi-galaxy-analyst

---

# Implementation Plan

## Vision

gxy3 replaces Galaxy's user-facing interface. Most bioinformatics analyses can be done locally via an AI agent. Galaxy becomes "headless" — its infrastructure used for large-scale compute and serving foundation models (e.g., AlphaGenome). Target users: the entire Galaxy community (biologists and data analysts).

**Core interaction model**: Chat-only. Biologists describe what they want in natural language. The AI agent handles all technical details. The agent always creates a plan and shows it for approval before executing.

**Workflow understanding**: "Learn by example" — users point at existing pipelines (Snakemake, Nextflow, CWL, WDL, bash) and say "do something like this for my data." The agent reads, understands, and adapts.

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── Pi.dev Agent Runtime (LLM interaction, tool-use loop)
│   ├── gxy3 Extension (fresh, references pi-galaxy-analyst patterns)
│   │   ├── Plan Manager (state, notebook persistence, git)
│   │   ├── Execution Engine (shell, conda/containers, process pool)
│   │   ├── Galaxy Bridge (MCP client → galaxy-mcp subprocess)
│   │   └── Workflow Reader (multi-language → agent understanding)
│   └── IPC Layer (typed channels to renderer)
├── Preload (contextBridge)
└── Renderer
    ├── Left: Chat (streaming messages, input bar)
    └── Right: Artifacts (plan text, visual DAG, rendered results, PDF)
```

Key decisions:
1. **Pi.dev as agent runtime** — handles LLM interaction, tool-use loop, streaming. Fresh extension (clean slate, reference pi-galaxy-analyst for patterns).
2. **MCP client** — spawns galaxy-mcp as subprocess via stdio for Galaxy operations.
3. **Agent decides execution** — local (conda, containers, bare shell) vs Galaxy vs hybrid, per step.
4. **Plan-then-execute** — agent always shows plan, waits for user approval before running anything.
5. **State stored locally + optionally on Galaxy server** — user chooses directory or dedicated location.

## Technology Stack

| Component | Technology |
|---|---|
| Desktop | Electron 35+ |
| Build | Vite + electron-forge |
| Language | TypeScript (strict) |
| Agent runtime | Pi.dev (`@mariozechner/pi-coding-agent`) |
| MCP bridge | `pi-mcp-adapter` |
| Markdown | `marked` + `highlight.js` |
| Step graph | SVG + dagre or elkjs |
| Shell exec | `node-pty` |
| Galaxy | `galaxy-mcp` via MCP stdio |
| Testing | Vitest |

## File Structure

```
gxy3/
  package.json
  tsconfig.json
  PLAN.md
  bin/
    gxy3.js                      # CLI entry point (like pi-galaxy-analyst/bin/gxypi.js)

  extensions/
    gxy3/
      index.ts                   # Extension registration, hooks, context injection
      config.ts                  # ~/.gxy3/config.json management
      types.ts                   # Plan data model (reference pi-galaxy-analyst)
      state.ts                   # Plan state machine
      tools.ts                   # All LLM-callable tools
      notebook-writer.ts         # Markdown+YAML persistence
      notebook-parser.ts         # Parse notebooks back to state
      git.ts                     # Auto-commit tracking
      galaxy-api.ts              # Galaxy API helpers
      workflow-reader.ts         # Multi-language workflow reading

  app/                           # Electron shell
    forge.config.ts
    vite.main.config.ts
    vite.preload.config.ts
    vite.renderer.config.ts
    src/
      main/
        main.ts                  # Electron lifecycle, window, menu
        agent.ts                 # AgentManager (spawns gxy3 CLI as RPC subprocess)
        ipc-handlers.ts          # IPC channel registration
      preload/
        preload.ts               # contextBridge API
      renderer/
        index.html
        styles.css
        app.ts                   # Root layout (two-pane)
        chat/
          chat-panel.ts          # Message list, streaming, tool cards
          input-bar.ts           # User input + file attach
        artifacts/
          artifact-panel.ts      # Tab container
          plan-view.ts           # Plan as readable text (not raw YAML)
          step-graph.ts          # Visual DAG (dagre/elkjs + SVG)
          result-viewer.ts       # Tables, images, text
          pdf-viewer.ts          # pdf.js embedded

  tests/
    *.test.ts
```

## LLM Tools (Pi.dev Extension)

Registered via Pi.dev's `ExtensionAPI.registerTool()`:

**Plan tools**:
- `analysis_plan_create` — create plan from user request, show for approval
- `analysis_plan_add_step` — add step to plan
- `analysis_step_update` — update step status/results
- `analysis_checkpoint` — QC checkpoint, pause for user review
- `analysis_set_phase` — transition lifecycle phase

**Execution tools**:
- `run_command` — execute shell command (agent decides conda/container/bare)
- `install_tools` — install bioinformatics tools (agent picks method)
- `check_process` — check running process status

**Galaxy tools** (via MCP bridge to galaxy-mcp):
- `galaxy_connect` — connect to Galaxy instance
- `galaxy_run_tool` — run a Galaxy tool
- `galaxy_invoke_workflow` — run a Galaxy workflow
- `galaxy_upload` — upload data to Galaxy
- `galaxy_get_results` — retrieve results from Galaxy

**File tools**:
- `read_file` — read any file
- `read_pdf` — extract text from PDF
- `write_file` — write output files

**Workflow tools**:
- `read_workflow` — read an existing pipeline in any language, understand its structure and purpose
- `adapt_workflow` — adapt a workflow pattern to new data/parameters

## Artifact Pane Design

```
+----------------------------+-+---------------------------+
| CHAT                       | | ARTIFACTS                 |
|                            | | [Plan] [Steps] [Results]  |
| Agent: I've analyzed the   | |                           |
| paper and identified 59    | | ┌─────────┐  ┌─────────┐ |
| samples with hybrid data.  | | │Download │→│Assemble │ |
| Here's the plan:           | | │ ● done  │  │ ◐ 30/59 │ |
|                            | | └─────────┘  └────┬────┘ |
| [Plan created ✓]           | |              ┌────▼────┐  |
|                            | |              │ Polish  │  |
| Shall I proceed?           | |              │ ○ wait  │  |
|                            | |              └────┬────┘  |
| ┌────────────────────────┐ | |              ┌────▼────┐  |
| │ Yes, go ahead          │ | |              │  QC     │  |
| └────────────────────────┘ | |              │ ○ wait  │  |
+----------------------------+-+---------------------------+
```

**Plan tab**: Readable text summary of what the agent will do. Not raw YAML — a human-friendly rendering. User approves/rejects via chat.

**Steps tab**: Visual DAG with nodes colored by status:
- ○ pending (gray)
- ◐ in progress (blue, with progress count)
- ● completed (green)
- ✗ failed (red)

**Results tab**: Rendered outputs — assembly statistics as formatted tables, QC plots as images, summary text with syntax highlighting.

## Execution Flow

1. User describes analysis in chat (natural language)
2. Agent reads relevant files (PDFs, data, existing workflows)
3. Agent creates plan → shown in artifact pane for approval
4. User approves (via chat: "go ahead" / "looks good" / etc.)
5. Agent executes step by step:
   - Decides tool installation method per tool
   - Decides local vs Galaxy per step
   - Streams progress to step graph
   - Pauses at QC checkpoints for user review
6. Results displayed in artifact pane
7. State saved locally (notebook + git) and optionally to Galaxy server

## Workflow Reading (Learn by Example)

The agent reads existing workflows by:
1. User provides path to workflow files (e.g., S_aureus scripts, nf-core pipeline, Snakemake rules)
2. Agent reads the files directly (using `read_file` tool)
3. Agent understands the structure via its own reasoning — no formal parser needed for MVP
4. Agent uses this understanding to create an adapted plan for new data

For the prototype: the agent reads `/media/anton/data/git/S_aureus/hybrid_assemblies/scripts/*.sh` and the PLAN.md, understands the autocycler assembly pipeline, and can recreate it for different samples.

**Later**: structured parsers for Snakemake/Nextflow/CWL/WDL to extract step dependencies, tool invocations, and resource requirements more reliably.

## Implementation Phases (ASAP Prototype)

### Phase 1: Skeleton
- Electron + Vite + forge setup
- Pi.dev extension skeleton with CLI entry point
- Two-pane layout (chat left, artifacts right)
- Pi.dev agent running in Electron (RPC subprocess pattern from pi-galaxy-analyst)
- Basic chat working (type message, get response)
- **Test**: Launch app, chat with agent

### Phase 2: Plan + Artifacts
- Plan tools (create, add step, update)
- Plan rendering in artifact pane (human-readable text)
- Step graph (visual DAG with dagre/elkjs)
- Plan approval flow (agent shows plan, waits for "go ahead")
- Notebook persistence (markdown+YAML) + git tracking
- **Test**: Ask "plan an assembly for S. aureus", see plan + DAG in artifacts

### Phase 3: Local Execution
- `run_command` tool with node-pty
- `install_tools` tool (conda/mamba/containers — agent decides)
- Process management (parallel jobs, kill/cancel)
- Step graph updates in real-time during execution
- Result rendering (tables, images, text)
- PDF reading (for the paper-reading part of the prototype)
- **Test**: Execute a plan step locally, see progress in DAG, see results

### Phase 4: Galaxy Bridge
- MCP bridge to galaxy-mcp subprocess
- Galaxy tools (connect, run, upload, get results)
- Mixed execution (some steps local, some on Galaxy)
- State sync to Galaxy server
- **Test**: Connect to usegalaxy.org, run a tool, retrieve results

### Phase 5: End-to-End Prototype
- Full S_aureus scenario: "analyze this paper, assemble with autocycler"
- Agent reads PDF, reads existing S_aureus scripts as examples
- Agent creates plan, user approves, agent executes
- Results displayed in artifact pane
- **Test**: Complete the prototype scenario from the Goal section

## References

- `/media/anton/data/git/pi-galaxy-analyst/` — patterns for extension architecture, tools, notebook, Electron shell
- `/media/anton/data/git/S_aureus/` — prototype analysis (bash scripts, PLAN.md)
- `/media/anton/data/git/galaxy-mcp/` — MCP server for Galaxy integration
- `/media/anton/data/git/galaxy-skills/` — knowledge base for Galaxy development
- `/media/anton/data/git/galaxy-brain/` — research vault
- `/media/anton/data/git/galaxy/` — Galaxy platform codebase