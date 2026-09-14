import { RenderMimeRegistry, standardRendererFactories } from "@jupyterlab/rendermime";
import { OutputArea } from "@jupyterlab/outputarea";
import { Widget } from "@lumino/widgets";
import { outputText } from "./transcript.js";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import renderMathInElement from "katex/contrib/auto-render";
import { marked } from "marked";

for (const [name, grammar] of Object.entries({ python, javascript, bash, json })) {
  hljs.registerLanguage(name, grammar);
}

export function renderCode(code, language = "python") {
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.className = "hljs";
  try {
    if (language === "plaintext") codeEl.textContent = code;
    else codeEl.innerHTML = hljs.highlight(code, { language }).value;
  } catch {
    codeEl.textContent = code;
  }
  pre.appendChild(codeEl);
  return pre;
}

export function foldPlaceholder(label, onExpand) {
  const button = document.createElement("button");
  button.className = "fold-placeholder";
  button.textContent = "…";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.onclick = onExpand;
  return button;
}

export function copyButton(getText, label = "Copy output") {
  const button = document.createElement("button");
  button.className = "copy-btn";
  button.textContent = label;
  button.title = label;
  button.setAttribute("aria-live", "polite");
  let resetTimer;
  button.addEventListener("click", async (event) => {
    window.clearTimeout(resetTimer);
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    resetTimer = setTimeout(() => {
      button.textContent = label;
    }, 1500);
  });
  return button;
}

class JSONRenderer extends Widget {
  async renderModel(model) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "JSON";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(model.data["application/json"], null, 2);
    details.append(summary, pre);
    this.node.replaceChildren(details);
  }
}

class SVGRenderer extends Widget {
  async renderModel(model) {
    // Image context disables scripts and external resources, including for SVG.
    // encodeURIComponent also handles Unicode SVG without btoa's Latin-1 limit.
    const img = document.createElement("img");
    img.src = `data:image/svg+xml,${encodeURIComponent(model.data["image/svg+xml"])}`;
    img.alt = "SVG output";
    this.node.replaceChildren(img);
  }
}

class PlotlyRenderer extends Widget {
  constructor() {
    super();
    this.queue = Promise.resolve();
    this.node.classList.add("plotly-output");
  }
  renderModel(model) {
    const data = structuredClone(model.data["application/vnd.plotly.v1+json"]);
    // Serialize asynchronous renders so an older plot cannot overwrite an update.
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const { default: Plotly } = await import("plotly.js-dist-min");
        if (this.isDisposed) return;
        this.plotly = Plotly;
        await Plotly.react(this.node, data.data, data.layout || {}, {
          responsive: true,
          ...(data.config || {}),
        });
        if (this.isDisposed) Plotly.purge(this.node);
      });
    return this.queue;
  }
  resize() {
    return this.queue.then(() => {
      if (!this.isDisposed && this.plotly && this.node.getBoundingClientRect().width > 0) {
        return this.plotly.Plots.resize(this.node);
      }
    });
  }
  dispose() {
    if (this.isDisposed) return;
    this.plotly?.purge(this.node);
    super.dispose();
  }
}

export const rendermime = new RenderMimeRegistry({
  initialFactories: standardRendererFactories,
  markdownParser: { render: async (source) => marked.parse(source) },
  latexTypesetter: {
    typeset: (node) =>
      renderMathInElement(node, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
        trust: false,
      }),
  },
});
for (const [mime, rank, Renderer] of [
  ["application/vnd.plotly.v1+json", 40, PlotlyRenderer],
  ["image/svg+xml", 80, SVGRenderer],
  ["application/json", 100, JSONRenderer],
]) {
  rendermime.addFactory({
    safe: true,
    mimeTypes: [mime],
    defaultRank: rank,
    createRenderer: () => new Renderer(),
  });
}

/** Only copy controls are custom; Jupyter owns rendering and updates. */
export class WatchOutputArea extends OutputArea {
  rendererNode(index) {
    return this.widgets[index]?.widgets?.[1]?.node;
  }
  resizeOutputs() {
    return Promise.all(this.widgets.map((panel) => panel.widgets?.[1]?.resize?.())).catch(
      console.error,
    );
  }
  createOutputItem(model) {
    const panel = super.createOutputItem(model);
    if (!panel) return panel;
    const controls = new Widget();
    controls.addClass("output-controls");
    const copy = copyButton(
      () => outputText(model, panel.widgets[1].node, richText),
      "Copy output",
    );
    controls.node.append(copy);
    panel.addWidget(controls);
    return panel;
  }
}

// Sanitize snapshots of rich text synchronously, so copying never depends on
// asynchronous display rendering and retains browser clipboard user activation.
export function richText(data) {
  const html =
    data["text/html"] ?? (data["text/markdown"] ? marked.parse(data["text/markdown"]) : "");
  const host = document.createElement("template");
  host.innerHTML = rendermime.sanitizer.sanitize(html);
  return host.content;
}
