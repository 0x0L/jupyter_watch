import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

mkdirSync(".test-runtime", { recursive: true });
const uv = "uv";
const connection = resolve(".test-runtime/kernel-test.json");
const kernel = spawn(uv, ["run", "python", "-u", "tests/kernel_fixture.py", connection], {
  stdio: ["ignore", "pipe", "inherit"],
});
let server;
let devServer;
let vite;
let started = false;
kernel.stdout.on("data", (data) => {
  if (!started && data.toString().includes("ready")) {
    started = true;
    server = spawn(uv, ["run", "jupyter-watch", connection, "--port", "8876"], {
      stdio: "inherit",
    });
    devServer = spawn(
      uv,
      [
        "run",
        "jupyter-watch",
        connection,
        "--port",
        "8877",
        "--dev-origin",
        "http://127.0.0.1:5174",
      ],
      { stdio: "inherit" },
    );
    vite = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--config", "tests/vite.config.js"],
      { stdio: "inherit" },
    );
    server.on("exit", stop);
    devServer.on("exit", stop);
    vite.on("exit", stop);
  }
});
function stop() {
  server?.kill("SIGTERM");
  devServer?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  kernel.kill("SIGTERM");
}
kernel.on("exit", (code) => {
  server?.kill("SIGTERM");
  devServer?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  process.exitCode = code || 0;
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
