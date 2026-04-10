import { contextBridge, ipcRenderer } from "electron";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface UiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  [key: string]: unknown;
}

export interface Gxy3API {
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  newSession(): Promise<{ cancelled: boolean }>;
  getState(): Promise<unknown>;
  getCwd(): Promise<string>;
  openFile(filePath: string): Promise<{ opened: boolean; error?: string }>;
  respondToUiRequest(id: string, response: Record<string, unknown>): void;
  restartAgent(): Promise<void>;
  selectDirectory(): Promise<string | null>;
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
  onUiRequest(callback: (request: UiRequest) => void): () => void;
  onAgentStatus(
    callback: (status: "running" | "stopped" | "error", msg?: string) => void
  ): () => void;
}

const api: Gxy3API = {
  prompt: (message) => ipcRenderer.invoke("agent:prompt", message),
  abort: () => ipcRenderer.invoke("agent:abort"),
  newSession: () => ipcRenderer.invoke("agent:new-session"),
  getState: () => ipcRenderer.invoke("agent:get-state"),
  getCwd: () => ipcRenderer.invoke("agent:get-cwd"),
  openFile: (filePath) => ipcRenderer.invoke("file:open", filePath),

  respondToUiRequest: (id, response) => {
    ipcRenderer.send("agent:ui-response", {
      type: "extension_ui_response",
      id,
      ...response,
    });
  },

  onUiRequest: (callback) => {
    const handler = (_e: unknown, request: UiRequest) => callback(request);
    ipcRenderer.on("agent:ui-request", handler);
    return () => ipcRenderer.removeListener("agent:ui-request", handler);
  },

  restartAgent: () => ipcRenderer.invoke("agent:restart"),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),

  onAgentEvent: (callback) => {
    const handler = (_e: unknown, event: AgentEvent) => callback(event);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },

  onAgentStatus: (callback) => {
    const handler = (
      _e: unknown,
      status: "running" | "stopped" | "error",
      msg?: string
    ) => callback(status, msg);
    ipcRenderer.on("agent:status", handler);
    return () => ipcRenderer.removeListener("agent:status", handler);
  },
};

contextBridge.exposeInMainWorld("gxy3", api);
