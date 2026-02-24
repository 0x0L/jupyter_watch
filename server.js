import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { platform } from "node:process";

import { Subscriber } from "zeromq";
import { WebSocketServer } from "ws";

const DELIMITER = "<IDS|MSG>";
const PORT = 8765;
const DIST = join(import.meta.dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// --- Connection file discovery ---

function findConnectionFile(kernelId) {
  const runtimeDirs = [];

  if (process.env.JUPYTER_RUNTIME_DIR) {
    runtimeDirs.push(process.env.JUPYTER_RUNTIME_DIR);
  }

  const home = homedir();
  if (platform === "darwin") {
    runtimeDirs.push(join(home, "Library", "Jupyter", "runtime"));
  } else {
    runtimeDirs.push(join(home, ".local", "share", "jupyter", "runtime"));
  }

  for (const dir of runtimeDirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.startsWith("kernel-") && file.endsWith(".json") && file.includes(kernelId)) {
        return join(dir, file);
      }
    }
  }

  throw new Error(`Connection file for kernel '${kernelId}' not found`);
}

// --- Jupyter wire protocol ---

function parseJupyterMessage(frames, key) {
  // Find delimiter
  let delimIdx = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].toString() === DELIMITER) {
      delimIdx = i;
      break;
    }
  }
  if (delimIdx === -1) return null;

  const hmacSignature = frames[delimIdx + 1].toString();
  const headerBuf = frames[delimIdx + 2];
  const parentHeaderBuf = frames[delimIdx + 3];
  const metadataBuf = frames[delimIdx + 4];
  const contentBuf = frames[delimIdx + 5];

  // HMAC validation
  if (key) {
    const hmac = createHmac("sha256", key);
    hmac.update(headerBuf);
    hmac.update(parentHeaderBuf);
    hmac.update(metadataBuf);
    hmac.update(contentBuf);
    if (hmac.digest("hex") !== hmacSignature) {
      console.error("HMAC validation failed, skipping message");
      return null;
    }
  }

  const header = JSON.parse(headerBuf.toString());
  const parentHeader = JSON.parse(parentHeaderBuf.toString());
  const content = JSON.parse(contentBuf.toString());

  return {
    msg_type: header.msg_type,
    content,
    parent_msg_id: parentHeader.msg_id || null,
  };
}

// --- HTTP static file server ---

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = join(DIST, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- Main ---

async function main() {
  const kernelId = process.argv[2];
  if (!kernelId) {
    console.error("Usage: node server.js <kernel-id>");
    process.exit(1);
  }

  // Find and load connection file
  const connFile = findConnectionFile(kernelId);
  const connInfo = JSON.parse(readFileSync(connFile, "utf-8"));
  console.log(`Loaded connection file: ${connFile}`);

  // Connect ZMQ subscriber to iopub
  const sock = new Subscriber();
  const iopubUrl = `${connInfo.transport}://${connInfo.ip}:${connInfo.iopub_port}`;
  sock.connect(iopubUrl);
  sock.subscribe("");
  console.log(`Subscribed to iopub: ${iopubUrl}`);

  // Extract kernel UUID from connection filename
  const connFileName = connFile.split("/").pop();
  const kernelUUID = connFileName.replace(/^kernel-/, "").replace(/\.json$/, "");
  const kernelInfoMsg = JSON.stringify({
    msg_type: "_kernel_info",
    content: {
      kernel_id: kernelUUID,
      connection_file: connFileName,
    },
  });

  // HTTP + WebSocket server
  const clients = new Set();
  const httpServer = createServer(serveStatic);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(kernelInfoMsg);
    console.log(`Client connected (${clients.size} total)`);
    ws.on("close", () => {
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`Serving on http://localhost:${PORT}`);
  });

  // Broadcast iopub messages to all WebSocket clients
  const key = connInfo.key || "";
  for await (const frames of sock) {
    const msg = parseJupyterMessage(frames, key);
    if (!msg) continue;

    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
