import { renderCode, renderMIME, renderError, renderStream } from "./renderer.js";
import "./style.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

const notebook = document.getElementById("notebook");
const statusDot = document.getElementById("status");

// Cell tracking: parent_msg_id -> cell DOM element
const cells = new Map();

// Auto-scroll: only if user hasn't scrolled up
let autoScroll = true;
window.addEventListener("scroll", () => {
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
  autoScroll = atBottom;
});

function scrollToBottom() {
  if (autoScroll) {
    window.scrollTo(0, document.body.scrollHeight);
  }
}

// --- Cell creation ---

function getOrCreateCell(parentMsgId) {
  if (parentMsgId && cells.has(parentMsgId)) {
    return cells.get(parentMsgId);
  }
  return null;
}

function createCell(executionCount, code, parentMsgId) {
  const cell = document.createElement("div");
  cell.classList.add("cell");

  // Input area
  const input = document.createElement("div");
  input.classList.add("cell-input");

  const gutter = document.createElement("div");
  gutter.classList.add("gutter");
  gutter.textContent = `In [${executionCount}]:`;

  const source = document.createElement("div");
  source.classList.add("source");
  source.appendChild(renderCode(code));

  input.appendChild(gutter);
  input.appendChild(source);

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

function createOutputBlock(executionCount) {
  const block = document.createElement("div");
  block.classList.add("output-block");

  const gutter = document.createElement("div");
  gutter.classList.add("gutter");
  if (executionCount != null) {
    gutter.textContent = `Out [${executionCount}]:`;
  }

  const content = document.createElement("div");
  content.classList.add("content");

  block.appendChild(gutter);
  block.appendChild(content);
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
      createCell(content.execution_count, content.code, parent_msg_id);
      break;
    }

    case "execute_result": {
      const cell = getOrCreateCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();
      const block = createOutputBlock(content.execution_count);
      const rendered = renderMIME(content.data, content.metadata || {});
      if (rendered) {
        block.querySelector(".content").appendChild(rendered);
        outputArea.appendChild(block);
      }
      break;
    }

    case "display_data":
    case "update_display_data": {
      const cell = getOrCreateCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();
      const block = createOutputBlock(null);
      const rendered = renderMIME(content.data, content.metadata || {});
      if (rendered) {
        block.querySelector(".content").appendChild(rendered);
        outputArea.appendChild(block);
      }
      break;
    }

    case "stream": {
      const cell = getOrCreateCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();

      // Try to append to existing stream element of same name in this cell
      const streamClass = `output-stream ${content.name || "stdout"}`;
      let streamEl = outputArea.querySelector(
        `.output-block:last-child .output-stream.${content.name || "stdout"}`
      );

      if (streamEl) {
        streamEl.innerHTML += renderStream(content.text);
      } else {
        const block = createOutputBlock(null);
        streamEl = document.createElement("div");
        streamEl.className = streamClass;
        streamEl.innerHTML = renderStream(content.text);
        block.querySelector(".content").appendChild(streamEl);
        outputArea.appendChild(block);
      }
      break;
    }

    case "error": {
      const cell = getOrCreateCell(parent_msg_id);
      const outputArea = cell ? getOutputArea(cell) : createStandaloneOutput();
      const errorDiv = document.createElement("div");
      errorDiv.classList.add("output-error");
      const contentDiv = document.createElement("div");
      contentDiv.classList.add("content");
      contentDiv.appendChild(renderError(content.traceback));
      errorDiv.appendChild(contentDiv);
      outputArea.appendChild(errorDiv);
      break;
    }

    case "status":
    case "comm_open":
    case "comm_msg":
    case "comm_close":
      // Silently ignore these
      break;

    default:
      // Unknown message type — ignore
      break;
  }

  scrollToBottom();
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
