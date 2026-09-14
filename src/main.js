import { createCellView } from "./cell-view.js";
import { OutputRouter } from "./output-router.js";
import { setupViewSettings } from "./view-settings.js";
import { setupScroll } from "./scroll.js";
import "@lumino/widgets/style/widget.css";
import "@jupyterlab/rendermime/style/base.css";
import "@jupyterlab/outputarea/style/base.css";
import "./style.css";
import "katex/dist/katex.min.css";
import lightTheme from "@jupyterlab/theme-light-extension/style/variables.css?inline";
import darkTheme from "@jupyterlab/theme-dark-extension/style/variables.css?inline";

// Consume JupyterLab's complete palette rather than maintaining partial copies.
const themeStyle = document.createElement("style");
themeStyle.id = "jupyter-theme";
document.head.appendChild(themeStyle);

const notebook = document.getElementById("notebook");
const statusDot = document.getElementById("status");
const statusLabel = document.getElementById("status-label");
const kernelInfoEl = document.getElementById("kernel-info");

// Theme toggle
const themeFab = document.getElementById("theme-fab");
const sunIcon = document.getElementById("theme-icon-sun");
const moonIcon = document.getElementById("theme-icon-moon");

function applyTheme(dark) {
  themeStyle.textContent = dark ? darkTheme : lightTheme;
  document.body.classList.toggle("dark", dark);
  document.body.dataset.jpThemeLight = String(!dark);
  themeFab.setAttribute("aria-pressed", String(dark));
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

const scroll = setupScroll(
  notebook,
  document.getElementById("autoscroll-toggle"),
  document.getElementById("autoscroll-fab"),
);
const preferences = setupViewSettings((next) =>
  scroll.preservePosition(() => {
    document.body.classList.toggle("wrap-input", next.wrap);
    for (const cell of router.cells.values()) cell.view.refreshInput();
  }),
);

// --- Cell views and upstream output models ---

const notice = document.createElement("div");
notice.id = "notice";
notice.setAttribute("role", "status");
notebook.before(notice);
function showNotice(text) {
  notice.textContent = text;
}

const router = new OutputRouter({
  createCell: (model) =>
    createCellView(model, {
      container: notebook,
      getLanguage: () => preferences.language,
      preservePosition: scroll.preservePosition,
    }),
  onTruncate: () =>
    showNotice("Earlier activity was omitted to keep the viewer within its history limit."),
});
document.getElementById("clear-output").addEventListener("click", () => {
  scroll.preservePosition(() => {
    router.reset();
    showNotice("");
  });
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
  statusDot.setAttribute("aria-label", statusDot.title);
  statusLabel.textContent = !kernelAlive ? "Offline" : kernelBusy ? "Busy" : "Connected";
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
    if (
      [
        "execute_input",
        "execute_result",
        "display_data",
        "update_display_data",
        "stream",
        "error",
        "clear_output",
      ].includes(type)
    )
      scroll.activity();
  }
}

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
    statusLabel.textContent = "Reconnecting";
    statusDot.setAttribute("aria-label", statusDot.title);
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
