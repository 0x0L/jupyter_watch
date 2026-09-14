import { Widget } from "@lumino/widgets";
import {
  renderCode,
  copyButton,
  foldPlaceholder,
  rendermime,
  richText,
  WatchOutputArea,
} from "./renderer.js";
import { cellText } from "./transcript.js";

/** A passive cell shell; Jupyter owns all output models and renderers. */
export function createCellView(model, { container, getLanguage, preservePosition }) {
  const cell = document.createElement("div");
  cell.className = "standalone-output jp-ThemedContainer";
  const input = document.createElement("div");
  input.className = "cell-input";
  input.hidden = true;
  const gutter = document.createElement("button");
  gutter.className = "gutter";
  gutter.title = "Fold input";
  gutter.setAttribute("aria-expanded", "true");
  gutter.onclick = () =>
    preservePosition(() => {
      const collapsed = input.classList.toggle("collapsed");
      gutter.setAttribute("aria-expanded", String(!collapsed));
      gutter.title = collapsed ? "Expand input" : "Fold input";
      if (
        !collapsed &&
        input.contains(document.activeElement) &&
        document.activeElement.classList.contains("fold-placeholder")
      )
        gutter.focus({ preventScroll: true });
    }, cell);
  const prompts = document.createElement("div");
  prompts.className = "input-prompts";
  const continuations = document.createElement("div");
  continuations.className = "continuation-prompts";
  continuations.setAttribute("aria-hidden", "true");
  prompts.append(gutter, continuations);
  const source = document.createElement("div");
  source.className = "source";
  let code = "";
  const inputActions = document.createElement("div");
  inputActions.className = "cell-actions";
  inputActions.append(copyButton(() => code, "Copy input"));
  input.append(
    prompts,
    source,
    foldPlaceholder("Expand input", () => gutter.click()),
    inputActions,
  );

  const output = document.createElement("div");
  output.className = "cell-output";
  output.hidden = true;
  const outputToggle = document.createElement("button");
  outputToggle.className = "output-fold";
  const placeholder = foldPlaceholder("Expand outputs", () => outputToggle.click());
  placeholder.classList.add("outputs-placeholder");
  const outputHost = document.createElement("div");
  outputHost.className = "output-host";
  output.append(outputToggle, placeholder, outputHost);
  cell.append(input, output);
  container.appendChild(cell);
  const area = new WatchOutputArea({ model, rendermime });
  Widget.attach(area, outputHost);

  const copyCell = copyButton(
    () => cellText(code, model, (i) => area.rendererNode(i), richText),
    "Copy cell",
  );
  const orphanActions = document.createElement("div");
  orphanActions.className = "cell-actions orphan-actions";
  orphanActions.append(copyCell);
  cell.prepend(orphanActions);
  let folded = false;
  let updated = false;

  function updateControls() {
    output.hidden = model.length === 0;
    output.classList.toggle("collapsed", folded);
    outputToggle.textContent = folded ? "▸" : "▾";
    outputToggle.title = folded ? "Expand outputs" : "Fold outputs";
    outputToggle.setAttribute("aria-label", outputToggle.title);
    outputToggle.setAttribute("aria-expanded", String(!folded));
    const description = `${model.length} ${model.length === 1 ? "output" : "outputs"}`;
    placeholder.textContent = `⋯ ${description}${updated ? " · Updated" : ""}`;
    placeholder.setAttribute("aria-label", `Expand ${description}${updated ? ", updated" : ""}`);
  }
  outputToggle.onclick = () =>
    preservePosition(() => {
      folded = !folded;
      updated = false;
      updateControls();
      if (!folded) {
        if (document.activeElement === placeholder) outputToggle.focus({ preventScroll: true });
        return area.resizeOutputs();
      }
    }, cell);
  const streams = new Set();
  function syncStreams() {
    const current = new Set();
    for (let i = 0; i < model.length; i++) {
      const stream = model.get(i).streamText;
      if (stream) current.add(stream);
    }
    for (const stream of streams) {
      if (!current.has(stream)) {
        stream.changed.disconnect(onOutputChange);
        streams.delete(stream);
      }
    }
    for (const stream of current) {
      if (!streams.has(stream)) {
        stream.changed.connect(onOutputChange);
        streams.add(stream);
      }
    }
  }
  function onOutputChange() {
    syncStreams();
    if (folded) updated = true;
    updateControls();
  }
  model.changed.connect(onOutputChange);
  model.stateChanged.connect(onOutputChange);
  syncStreams();
  updateControls();
  const view = {
    setInput(text, count) {
      code = text;
      cell.classList.remove("standalone-output");
      cell.classList.add("cell");
      input.hidden = false;
      inputActions.append(copyCell);
      orphanActions.remove();
      gutter.textContent = `In [${count ?? ""}]:`;
      continuations.textContent = code
        .split("\n")
        .slice(1)
        .map(() => "...:")
        .join("\n");
      view.refreshInput();
    },
    refreshInput() {
      source.replaceChildren(renderCode(code, getLanguage()));
    },
    dispose() {
      model.changed.disconnect(onOutputChange);
      model.stateChanged.disconnect(onOutputChange);
      for (const stream of streams) stream.changed.disconnect(onOutputChange);
      streams.clear();
      area.dispose();
      cell.remove();
    },
  };
  return view;
}
