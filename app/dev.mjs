#!/usr/bin/env node
/**
 * gxy3 dev launcher — bypasses electron-forge for development.
 * 1. Builds main + preload with Vite
 * 2. Starts Vite dev server for renderer on :5199
 * 3. Launches Electron with --no-sandbox
 */
import { spawn } from "node:child_process";
import { createServer, build } from "vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ELECTRON = require("electron");

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
// Vite plugin: neutralize Vite HMR's post-sleep page reload.
//
// After a macOS display sleep, Vite's HMR WebSocket drops and on reconnect
// the client unconditionally calls location.reload(), wiping all renderer
// state (chat, plan, steps, results) while the agent subprocess keeps
// running. location.reload is [LegacyUnforgeable] so patching fails from
// user code, and hmr: false doesn't stop Vite from opening the WebSocket.
//
// Workaround: inject a script before @vite/client that wraps WebSocket so
// that any 'close' event listener registered on it is silently ignored.
// Vite's reload handler is registered via socket.addEventListener('close',
// ...), so if the listener never attaches, the reload never fires. 'open'
// and 'message' listeners still work, so HMR itself is unaffected.
const noReloadPlugin = {
  name: "gxy3-no-hmr-reload",
  transformIndexHtml() {
    return [
      {
        tag: "script",
        injectTo: "head-prepend",
        children: `
(function () {
  var OrigWS = window.WebSocket;
  window.WebSocket = new Proxy(OrigWS, {
    construct: function (target, args) {
      var ws = new target(args[0], args[1]);
      var origAdd = ws.addEventListener.bind(ws);
      ws.addEventListener = function (type, listener, options) {
        if (type === "close") {
          console.warn("[gxy3] swallowed WebSocket 'close' listener (display-sleep workaround)");
          return;
        }
        return origAdd(type, listener, options);
      };
      return ws;
    },
  });
})();
`,
      },
    ];
  },
};

const server = await createServer({
  root: path.resolve(__dirname, "src/renderer"),
  server: { port: 5199, strictPort: false },
  plugins: [noReloadPlugin],
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
