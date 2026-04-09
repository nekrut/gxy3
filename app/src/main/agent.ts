import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import type { BrowserWindow } from "electron";

// Resolve the gxy3 entry point relative to the app
const GXY3_BIN = path.resolve(__dirname, "../../../bin/gxy3.js");

export type AgentStatus = "running" | "stopped" | "error";

interface PendingResponse {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

function log(...args: unknown[]): void {
  console.log("[agent]", ...args);
}

export class AgentManager {
  private process: ChildProcess | null = null;
  private window: BrowserWindow;
  private status: AgentStatus = "stopped";
  private stderr = "";
  private pendingResponses = new Map<string, PendingResponse>();
  private idCounter = 0;
  private cwd: string;

  constructor(window: BrowserWindow, cwd: string) {
    this.window = window;
    this.cwd = cwd;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
    log("cwd set to", cwd);
  }

  getCwd(): string {
    return this.cwd;
  }

  start(): void {
    if (this.process) this.stop();
    this.stderr = "";

    log("starting agent", { bin: GXY3_BIN, cwd: this.cwd });

    try {
      this.process = spawn("node", [GXY3_BIN, "--mode", "rpc"], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.cwd,
        env: { ...process.env },
      });
    } catch (err) {
      log("spawn failed:", err);
      this.setStatus("error", `Failed to spawn agent: ${err}`);
      return;
    }

    log("agent spawned, pid:", this.process.pid);
    this.setStatus("running");

    const rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    rl.on("line", (line) => this.handleLine(line));

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderr += text;
      log("stderr:", text.trimEnd());
    });

    this.process.on("exit", (code, signal) => {
      log("agent exited, code:", code, "signal:", signal);
      this.process = null;
      if (code !== 0 && code !== null) {
        this.setStatus("error", `Agent exited with code ${code}`);
      } else {
        this.setStatus("stopped");
      }
    });

    this.process.on("error", (err) => {
      log("agent process error:", err.message);
      this.process = null;
      this.setStatus("error", err.message);
    });
  }

  stop(): void {
    if (this.process) {
      log("stopping agent, pid:", this.process.pid);
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.setStatus("stopped");
    for (const [id, pending] of this.pendingResponses) {
      log("rejecting pending response:", id);
      pending.reject(new Error("Agent stopped"));
    }
    this.pendingResponses.clear();
  }

  send(obj: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      log("send failed: stdin not writable");
      return;
    }
    const json = JSON.stringify(obj);
    log("-> stdin:", json.slice(0, 200));
    this.process.stdin.write(json + "\n");
  }

  sendCommand(obj: Record<string, unknown>): Promise<unknown> {
    const id = `cmd_${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
      this.send({ ...obj, id });
    });
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private setStatus(status: AgentStatus, message?: string): void {
    this.status = status;
    log("status:", status, message || "");
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("agent:status", status, message);
    }
  }

  private handleLine(line: string): void {
    if (this.window.isDestroyed()) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      log("non-JSON stdout:", line.slice(0, 200));
      return;
    }

    const type = data.type as string;
    log("<- event:", type, JSON.stringify(data).slice(0, 200));

    // Route responses to pending promises
    if (type === "response" && data.id) {
      const pending = this.pendingResponses.get(data.id as string);
      if (pending) {
        this.pendingResponses.delete(data.id as string);
        if (data.success === false) {
          pending.reject(new Error(data.error as string));
        } else {
          pending.resolve(data.data ?? data);
        }
        return;
      }
    }

    // Route extension UI requests
    if (type === "extension_ui_request") {
      this.window.webContents.send("agent:ui-request", data);
      return;
    }

    // Everything else is an agent event
    this.window.webContents.send("agent:event", data);
  }
}
