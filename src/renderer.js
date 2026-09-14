import { RenderMimeRegistry, standardRendererFactories } from "@jupyterlab/rendermime";
import { OutputArea } from "@jupyterlab/outputarea";
import { Widget } from "@lumino/widgets";
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
    codeEl.innerHTML = hljs.highlight(code, { language }).value;
  } catch {
    codeEl.textContent = code;
  }
  pre.appendChild(codeEl);
  return pre;
}

export function copyButton(getText) {
  const button = document.createElement("button");
  button.className = "copy-btn";
  button.textContent = "Copy";
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "Copied!";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => {
      button.textContent = "Copy";
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

/** Only watcher controls are custom; Jupyter owns output rendering and updates. */
export class WatchOutputArea extends OutputArea {
  createOutputItem(model) {
    const panel = super.createOutputItem(model);
    if (!panel) return panel;
    const prompt = panel.widgets[0];
    const toggle = document.createElement("button");
    toggle.className = "output-fold";
    toggle.textContent = "▾";
    toggle.title = "Fold output";
    toggle.setAttribute("aria-expanded", "true");
    toggle.onclick = () => {
      const collapsed = panel.node.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    };
    prompt.node.replaceChildren(toggle);
    const copy = new Widget({ node: copyButton(() => panel.widgets[1].node.textContent) });
    panel.addWidget(copy);
    return panel;
  }
}
