import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import { marked } from "marked";
import { AnsiUp } from "ansi_up";

function addImageClickHandler(img) {
  img.style.cursor = "pointer";
  img.addEventListener("click", () => {
    fetch(img.src)
      .then((r) => r.blob())
      .then((blob) => window.open(URL.createObjectURL(blob), "_blank"));
  });
}

hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);

const ansiUp = new AnsiUp();

/**
 * Syntax-highlight code and return a <pre><code> element.
 */
export function renderCode(code, language = "python") {
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  try {
    codeEl.innerHTML = hljs.highlight(code, { language }).value;
  } catch {
    codeEl.textContent = code;
  }
  pre.appendChild(codeEl);
  return pre;
}

/**
 * Render MIME bundle following JupyterLab's priority order.
 * Returns a DOM element.
 */
export function renderMIME(data, _metadata = {}) {
  // Priority order
  if (data["text/html"]) {
    const div = document.createElement("div");
    div.classList.add("rendered-html");
    div.innerHTML = sanitizeHTML(data["text/html"]);
    return div;
  }

  if (data["text/markdown"]) {
    const div = document.createElement("div");
    div.classList.add("rendered-html");
    div.innerHTML = marked.parse(data["text/markdown"]);
    try {
      renderMathInElement(div, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
    } catch {
      // math rendering failed, that's ok
    }
    return div;
  }

  if (data["text/latex"]) {
    const div = document.createElement("div");
    try {
      katex.render(data["text/latex"], div, { displayMode: true, throwOnError: false });
    } catch {
      div.textContent = data["text/latex"];
    }
    return div;
  }

  if (data["image/svg+xml"]) {
    const img = document.createElement("img");
    img.src = "data:image/svg+xml;base64," + btoa(data["image/svg+xml"]);
    addImageClickHandler(img);
    return img;
  }

  for (const mime of ["image/png", "image/jpeg", "image/gif"]) {
    if (data[mime]) {
      const img = document.createElement("img");
      img.src = `data:${mime};base64,${data[mime]}`;
      addImageClickHandler(img);
      return img;
    }
  }

  if (data["application/json"]) {
    const container = document.createElement("div");
    const toggle = document.createElement("div");
    toggle.classList.add("json-toggle");
    toggle.textContent = "JSON (click to expand)";
    const content = document.createElement("pre");
    content.classList.add("json-content");
    content.textContent = JSON.stringify(data["application/json"], null, 2);
    content.style.display = "none";
    toggle.addEventListener("click", () => {
      const visible = content.style.display !== "none";
      content.style.display = visible ? "none" : "block";
      toggle.textContent = visible ? "JSON (click to expand)" : "JSON (click to collapse)";
    });
    container.appendChild(toggle);
    container.appendChild(content);
    return container;
  }

  if (data["text/plain"]) {
    const pre = document.createElement("pre");
    pre.textContent = data["text/plain"];
    return pre;
  }

  return null;
}

/**
 * Render error traceback with ANSI color support.
 */
export function renderError(traceback) {
  const pre = document.createElement("pre");
  pre.classList.add("error-traceback");
  const text = Array.isArray(traceback) ? traceback.join("\n") : String(traceback);
  pre.innerHTML = ansiUp.ansi_to_html(text);
  return pre;
}

/**
 * Render stream output (stdout/stderr) with ANSI support.
 * Returns an HTML string to append to existing stream content.
 */
export function renderStream(text) {
  return ansiUp.ansi_to_html(text);
}

/**
 * Strip <script> tags from HTML.
 */
function sanitizeHTML(html) {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}
