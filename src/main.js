import { renderCode, copyButton, rendermime, WatchOutputArea } from "./renderer.js";
import { OutputRouter } from "./output-router.js";
import { Widget } from "@lumino/widgets";
import "@lumino/widgets/style/widget.css";
import "@jupyterlab/rendermime/style/base.css";
import "@jupyterlab/outputarea/style/base.css";
import "./style.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

const notebook = document.getElementById("notebook");
const statusDot = document.getElementById("status");
const kernelInfoEl = document.getElementById("kernel-info");

// Theme toggle
const themeFab = document.getElementById("theme-fab");
const sunIcon = document.getElementById("theme-icon-sun");
const moonIcon = document.getElementById("theme-icon-moon");

function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  sunIcon.style.display = dark ? "none" : "block";
  moonIcon.style.display = dark ? "block" : "none";
  localStorage.setItem("theme", dark ? "dark" : "light");
}

// Restore saved preference or respect system preference
const saved = localStorage.getItem("theme");
if (saved) {
  applyTheme(saved === "dark");
} else {
  applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
}

themeFab.addEventListener("click", () => {
  applyTheme(!document.body.classList.contains("dark"));
});

// Auto-scroll: only if user hasn't scrolled up
let autoScroll = true;
const autoScrollToggle = document.getElementById("autoscroll-toggle");
const autoScrollFab = document.getElementById("autoscroll-fab");

function updateFab() {
  autoScrollFab.classList.toggle("off", !autoScroll);
}

window.addEventListener("scroll", () => {
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
  autoScroll = atBottom;
  autoScrollToggle.checked = autoScroll;
  updateFab();
});

autoScrollToggle.addEventListener("change", () => {
  autoScroll = autoScrollToggle.checked;
  updateFab();
  if (autoScroll) scrollToBottom();
});

function scrollToBottom() {
  window.scrollTo(0, document.body.scrollHeight);
}

// --- Cell views and upstream output models ---

const notice = document.createElement("div");
notice.id = "notice";
notice.setAttribute("role", "status");
notebook.before(notice);
function showNotice(text) {
  notice.textContent = text;
}

function createCell(model) {
  const cell = document.createElement("div");
  cell.className = "standalone-output jp-ThemedContainer";
  const input = document.createElement("div");
  input.className = "cell-input";
  input.hidden = true;
  const gutter = document.createElement("button");
  gutter.className = "gutter";
  gutter.title = "Fold code";
  gutter.setAttribute("aria-expanded", "true");
  gutter.onclick = () => {
    gutter.setAttribute("aria-expanded", String(!input.classList.toggle("collapsed")));
  };
  const source = document.createElement("div");
  source.className = "source";
  let code = "";
  input.append(
    gutter,
    source,
    copyButton(() => code),
  );
  const output = document.createElement("div");
  output.className = "cell-output";
  cell.append(input, output);
  notebook.appendChild(cell);
  const area = new WatchOutputArea({ model, rendermime });
  Widget.attach(area, output);
  return {
    setInput(text, count) {
      code = text;
      cell.className = "cell jp-ThemedContainer";
      input.hidden = false;
      gutter.title = `Fold input [${count ?? ""}]`;
      source.replaceChildren(renderCode(code));
    },
    dispose() {
      area.dispose();
      cell.remove();
    },
  };
}
const router = new OutputRouter({
  createCell,
  onTruncate: () =>
    showNotice("Earlier activity was omitted to keep the viewer within its history limit."),
});
let kernelAlive = false;
let kernelBusy = false;
function updateStatus() {
  statusDot.className = `status ${!kernelAlive ? "disconnected" : kernelBusy ? "busy" : "connected"}`;
  statusDot.title = !kernelAlive
    ? "Kernel heartbeat unavailable"
    : kernelBusy
      ? "Kernel busy"
      : "Kernel connected";
}
function handleMessage(msg) {
  const type = msg.header?.msg_type || msg.msg_type;
  const content = msg.content;
  if (type === "_reset") {
    router.reset();
    kernelAlive = false;
    kernelBusy = false;
    showNotice("");
    updateStatus();
  } else if (type === "_notice") {
    showNotice(content.text);
  } else if (type === "_kernel_info") {
    const filename = content.connection_file;
    kernelInfoEl.textContent = filename;
    kernelInfoEl.title = "Click to copy connection filename";
    kernelInfoEl.onclick = () => navigator.clipboard.writeText(filename).catch(console.error);
  } else if (type === "_kernel_status") {
    kernelAlive = content.alive;
    updateStatus();
  } else if (type === "status") {
    kernelBusy = content.execution_state === "busy";
    updateStatus();
  } else {
    router.handle(msg);
  }
  if (autoScroll) scrollToBottom();
}
// Account for asynchronous Markdown, math, image, and Plotly layout changes.
const resizeObserver = new ResizeObserver(() => {
  if (autoScroll) scrollToBottom();
});
resizeObserver.observe(notebook);

// --- WebSocket connection with auto-reconnect ---

let ws = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectDelay = 1000;
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleMessage(msg);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  };

  ws.onclose = () => {
    kernelAlive = false;
    updateStatus();
    statusDot.title = "Viewer disconnected; reconnecting";
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {
    ws.close();
  };
}

window.addEventListener("offline", () => ws?.close());

connect();
