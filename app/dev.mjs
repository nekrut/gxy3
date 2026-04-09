#!/usr/bin/env node
/**
 * gxy3 dev launcher — bypasses electron-forge for development.
 * 1. Builds main + preload with Vite
 * 2. Starts Vite dev server for renderer on :5199
 * 3. Launches Electron with --no-sandbox
 */
import { spawn } from "node:child_process";
import { createServer, build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON = path.join(__dirname, "node_modules/electron/dist/electron");

// Build main process
console.log("[gxy3] Building main...");
await build({
  build: {
    outDir: ".vite/build",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["electron", "node:child_process", "node:readline", "node:path",
                  "node:fs", "node:os", "node:url"],
    },
    minify: false,
    sourcemap: true,
  },
  resolve: { conditions: ["node"] },
});

// Build preload
console.log("[gxy3] Building preload...");
await build({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/preload/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    rollupOptions: {
      external: ["electron"],
    },
    minify: false,
    sourcemap: true,
  },
  resolve: { conditions: ["node"] },
});

// Start renderer dev server
console.log("[gxy3] Starting renderer dev server...");
const server = await createServer({
  root: path.resolve(__dirname, "src/renderer"),
  server: { port: 5199, strictPort: false },
});
await server.listen();
const port = server.config.server.port;
console.log(`[gxy3] Renderer: http://localhost:${port}/`);

// Launch Electron with dev server URL
console.log("[gxy3] Launching Electron...");
const child = spawn(ELECTRON, ["--no-sandbox", "."], {
  cwd: __dirname,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: `http://localhost:${port}/`,
  },
});

child.on("exit", (code) => {
  console.log(`[gxy3] Electron exited (${code})`);
  server.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
