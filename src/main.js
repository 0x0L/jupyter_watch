import { readPreference, savePreference } from "./preferences.js";
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

// Keep the full JupyterLab palette for upstream renderers.
const themeStyle = document.createElement("style");
themeStyle.id = "jupyter-theme";
document.head.appendChild(themeStyle);

const notebook = document.getElementById("notebook");
const statusDot = document.getElementById("status");
const statusLabel = document.getElementById("status-label");
const connectionButton = document.getElementById("kernel-info");

const themeToggle = document.getElementById("theme-toggle");
const sunIcon = document.getElementById("theme-icon-sun");
const moonIcon = document.getElementById("theme-icon-moon");

function applyTheme(dark) {
  themeStyle.textContent = dark ? darkTheme : lightTheme;
  document.body.classList.toggle("dark", dark);
  document.body.dataset.jpThemeLight = String(!dark);
  themeToggle.setAttribute("aria-pressed", String(dark));
  sunIcon.style.display = dark ? "none" : "block";
  moonIcon.style.display = dark ? "block" : "none";
  savePreference("theme", dark ? "dark" : "light");
}

const savedTheme = readPreference("theme");
if (["dark", "light"].includes(savedTheme)) {
  applyTheme(savedTheme === "dark");
} else {
  applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
}

themeToggle.addEventListener("click", () => {
  applyTheme(!document.body.classList.contains("dark"));
});

const scroll = setupScroll(
  notebook,
  document.getElementById("follow-output"),
  document.getElementById("follow-control"),
);
const preferences = setupViewSettings((next) =>
  scroll.preservePosition(() => {
    document.body.classList.toggle("wrap-input", next.wrap);
    for (const cell of router.cells.values()) cell.view.refreshInput();
  }),
);

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
    showNotice("Earlier activity was removed to keep the viewer within its display limit."),
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
    connectionButton.textContent = filename;
    connectionButton.disabled = false;
    connectionButton.title = "Copy connection filename";
    connectionButton.setAttribute("aria-label", `Copy connection filename: ${filename}`);
    connectionButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(filename);
        showNotice("Connection filename copied.");
      } catch {
        showNotice("Could not copy the connection filename.");
      }
    };
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

// Retry failed connections with capped exponential backoff.

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
      console.error("Could not process kernel message:", err);
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
