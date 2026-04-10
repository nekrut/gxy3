# gxy3

AI-driven bioinformatics analysis desktop app. Replaces Galaxy's web UI with a chat-based interface where biologists describe analyses in natural language and an AI agent handles execution — locally for small/medium tasks, on Galaxy for large-scale compute.

## How it works

1. User describes an analysis in the chat pane (e.g., "assemble these MRSA genomes with autocycler")
2. Agent creates a plan and displays it in the artifact pane for review
3. User approves (edits optional), agent executes step by step
4. Progress shown as a visual DAG; results rendered in the Results tab

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── Pi.dev Agent Runtime (LLM interaction, tool-use loop)
│   ├── gxy3 Extension (plan management, execution, Galaxy bridge)
│   └── IPC Layer (typed channels to renderer)
├── Preload (contextBridge)
└── Renderer (two-pane layout)
    ├── Left:  Chat (streaming messages, thinking indicator, tool cards)
    └── Right: Artifacts (plan editor, visual DAG, typed results)
```

## Tech stack

| Component | Technology |
|---|---|
| Desktop | Electron 35 |
| Build | Vite + electron-forge |
| Language | TypeScript (strict) |
| Agent | Pi.dev (`@mariozechner/pi-coding-agent`) |
| MCP bridge | `pi-mcp-adapter` |
| Markdown | `marked` |
| UI theme | Galaxy-derived (Atkinson Hyperlegible, Galaxy color palette) |

## Current state

### Phase 1: Skeleton ✓
- Electron + Vite + forge setup
- Pi.dev agent running as RPC subprocess
- Two-pane layout with draggable divider
- Chat with streaming markdown and tool cards

### Phase 2: Plan + Artifacts ✓
- `display_plan` / `update_step` / `get_plan` tools
- Plan rendering (markdown + raw edit modes)
- Visual DAG with SVG bezier connectors and branching for parallel steps
- Clickable step nodes showing executed command + explanation
- Galaxy-style history item colors for step status (green=done, orange=running, red=failed)
- Notebook persistence (markdown+YAML) with git auto-commit
- Thinking indicator ("... thinking" bubble + status badge)
- Working directory display in header with change button

### Phase 3: Local Execution ✓
- `install_tools` — conda/mamba env creation with bioconda+conda-forge
- `run_command` — shell execution with auto conda env activation, background mode, timeout
- `check_process` / `cancel_command` — process management
- `report_result` — typed results to Results tab (markdown, tables, images, file links)
- System prompt instructs agent to always use bioconda and report results

### Phase 4: Galaxy Bridge (planned)
- MCP bridge to galaxy-mcp subprocess
- Galaxy tools (connect, run, upload, get results)
- Mixed local + Galaxy execution

### Phase 5: End-to-End (planned)
- Full prototype scenario: read paper, plan assembly, execute, display results
- Workflow reader (learn from existing Snakemake/Nextflow/CWL pipelines)

## Running

```bash
# Install dependencies (both root and app)
npm install
cd app && npm install

# Start in development mode
cd app && npm run start
```

Requires a Pi.dev-compatible LLM API key configured in `~/.gxy3/config.json`.

## Project structure

```
gxy3/
  bin/gxy3.js                     CLI entry point (Pi.dev agent)
  extensions/gxy3/index.ts        Extension: tools, plan state, execution
  app/
    src/main/main.ts              Electron lifecycle, window, menu
    src/main/agent.ts             Agent subprocess manager (RPC)
    src/main/ipc-handlers.ts      IPC channel registration
    src/preload/preload.ts        contextBridge API
    src/renderer/
      app.ts                      Root UI, event wiring, tab switching
      chat/chat-panel.ts          Chat messages, streaming, thinking indicator
      artifacts/
        artifact-panel.ts         Plan editor, result block renderer
        step-graph.ts             Visual DAG with SVG connectors
      styles.css                  Galaxy-derived light theme
```
