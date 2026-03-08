import { renderCode, renderMIME, renderError, renderStream } from "./renderer.js";
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

// Cell tracking: parent_msg_id -> cell DOM element
const cells = new Map();

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

// --- Cell creation ---

function findCell(parentMsgId) {
  return cells.get(parentMsgId) || null;
}

function createCell(code, parentMsgId) {
  const cell = document.createElement("div");
  cell.classList.add("cell");

  // Input area
  const input = document.createElement("div");
  input.classList.add("cell-input");

  const gutter = document.createElement("div");
  gutter.classList.add("gutter");

  const source = document.createElement("div");
  source.classList.add("source");
  source.appendChild(renderCode(code));

  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.classList.add("copy-btn");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
  });

  input.appendChild(gutter);
  input.appendChild(source);
  input.appendChild(copyBtn);

  // Fold toggle on gutter only
  gutter.addEventListener("click", () => {
    input.classList.toggle("collapsed");
  });

  // Output area
  const output = document.createElement("div");
  output.classList.add("cell-output");

  cell.appendChild(input);
  cell.appendChild(output);
  notebook.appendChild(cell);

  // Track by parent_msg_id (the msg_id of the execute_request)
  if (parentMsgId) {
    cells.set(parentMsgId, cell);
  }

  return cell;
}

function getOutputArea(cell) {
  return cell.querySelector(".cell-output");
}

function createOutputBlock() {
  const block = document.createElement("div");
  block.classList.add("output-block");

  const gutter = document.createElement("div");
  gutter.classList.add("gutter", "foldable");
  gutter.addEventListener("click", () => {
    block.classList.toggle("collapsed");
  });

  const content = document.createElement("div");
  content.classList.add("content");

  const copyBtn = document.createElement("button");
  copyBtn.classList.add("copy-btn");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content.textContent).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
  });

  block.appendChild(gutter);
  block.appendChild(content);
  block.appendChild(copyBtn);
  return block;
}

function createStandaloneOutput() {
  const wrapper = document.createElement("div");
  wrapper.classList.add("standalone-output");
  const output = document.createElement("div");
  output.classList.add("cell-output");
  wrapper.appendChild(output);
  notebook.appendChild(wrapper);
  return output;
}

// --- Message handling ---

function handleMessage(msg) {
  const { msg_type, content, parent_msg_id } = msg;

  switch (msg_type) {
    case "execute_input": {
      createCell(content.code, parent_msg_id);
      break;
    }

    case "execute_result":
    case "display_data":
    case "update_display_data": {
      const cell = findCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();
      const block = createOutputBlock();
      const rendered = renderMIME(content.data);
      if (rendered) {
        block.querySelector(".content").appendChild(rendered);
        outputArea.appendChild(block);
      }
      break;
    }

    case "stream": {
      const cell = findCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();

      // Try to append to existing stream element of same name in this cell
      const streamName = content.name || "stdout";
      let streamEl = outputArea.querySelector(
        `.output-block:last-child .output-stream[data-stream="${streamName}"]`,
      );

      if (streamEl) {
        streamEl.innerHTML += renderStream(content.text);
      } else {
        const block = createOutputBlock();
        streamEl = document.createElement("div");
        streamEl.className = `output-stream ${streamName}`;
        streamEl.dataset.stream = streamName;
        streamEl.innerHTML = renderStream(content.text);
        block.querySelector(".content").appendChild(streamEl);
        outputArea.appendChild(block);
      }
      break;
    }

    case "error": {
      const cell = findCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();
      const block = createOutputBlock();
      block.classList.add("output-error");
      block.querySelector(".content").appendChild(renderError(content.traceback));
      outputArea.appendChild(block);
      break;
    }

    case "status": {
      const state = content.execution_state;
      if (state === "busy") {
        statusDot.className = "status busy";
      } else if (state === "idle") {
        statusDot.className = "status connected";
      }
      break;
    }

    case "_kernel_info": {
      const uuid = content.kernel_id;
      kernelInfoEl.textContent = uuid;
      kernelInfoEl.title = "Click to copy kernel UUID";
      kernelInfoEl.onclick = () => {
        navigator.clipboard.writeText(uuid).then(() => {
          kernelInfoEl.textContent = "copied!";
          setTimeout(() => {
            kernelInfoEl.textContent = uuid;
          }, 1500);
        });
      };
      break;
    }

    case "comm_open":
    case "comm_msg":
    case "comm_close":
      break;

    default:
      // Unknown message type — ignore
      break;
  }

  if (autoScroll) scrollToBottom();
}

// --- WebSocket connection with auto-reconnect ---

let ws = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    statusDot.className = "status connected";
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
    statusDot.className = "status disconnected";
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {
    ws.close();
  };
}

connect();
