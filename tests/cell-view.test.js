import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputAreaModel } from "@jupyterlab/outputarea";
import { createCellView } from "../src/cell-view.js";
import { cellText, outputText } from "../src/transcript.js";
import { copyButton, richText } from "../src/renderer.js";
import { readViewPreferences } from "../src/view-settings.js";

const cleanup = [];
function fixture() {
  const model = new OutputAreaModel({ trusted: false });
  const container = document.createElement("div");
  document.body.append(container);
  const view = createCellView(model, {
    container,
    getLanguage: () => "python",
    preservePosition: (change) => change(),
  });
  cleanup.push(() => {
    view.dispose();
    model.dispose();
    container.remove();
  });
  return { model, view, node: container.firstChild };
}
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
});
const display = (data) => ({ output_type: "display_data", data, metadata: {} });

describe("cell sections", () => {
  it("folds all outputs independently, tracks hidden updates, and survives replacement", async () => {
    const { model, view, node } = fixture();
    view.setInput("print('one')\n2 + 2", 7);
    model.add({ output_type: "stream", name: "stdout", text: "one" });
    model.add(display({ "text/plain": "two" }));
    const section = node.querySelector(".cell-output");
    const toggle = section.querySelector(".output-fold");
    toggle.click();
    expect(section.querySelector(".outputs-placeholder").textContent).toBe("⋯ 2 outputs");
    expect(node.querySelector(".cell-input").classList.contains("collapsed")).toBe(false);
    model.get(1).setData({ data: { "text/plain": "latest" }, metadata: {} });
    expect(section.querySelector(".outputs-placeholder").textContent).toContain("Updated");
    node.querySelector(".gutter").click();
    section.querySelector(".outputs-placeholder").click();
    expect(node.querySelector(".cell-input").classList.contains("collapsed")).toBe(true);
    expect(section.classList.contains("collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    model.clear(false);
    expect(section.hidden).toBe(true);
    model.add({ output_type: "stream", name: "stdout", text: "new" });
    expect(section.hidden).toBe(false);
    expect(section.classList.contains("collapsed")).toBe(true);
    toggle.click();
    toggle.click();
    expect(section.querySelector(".outputs-placeholder").textContent).not.toContain("Updated");
    model.add({ output_type: "stream", name: "stdout", text: " appended" });
    expect(model.length).toBe(1);
    expect(section.querySelector(".outputs-placeholder").textContent).toBe("⋯ 1 output · Updated");
  });
  it("supports output-only cells without creating a fake input", () => {
    const { model, node } = fixture();
    model.add(display({ "text/plain": "orphan" }));
    expect(node.querySelector(".cell-input").hidden).toBe(true);
    expect(node.querySelector(".orphan-actions button").textContent).toBe("Copy cell");
    expect(node.querySelectorAll(".output-fold")).toHaveLength(1);
  });
});

describe("text transcripts", () => {
  it("copies normalized current outputs and original source, without prompts or controls", () => {
    const { model, node, view } = fixture();
    const source = "  print('one')\n  42";
    view.setInput(source, 8);
    model.add({ output_type: "stream", name: "stdout", text: "old\rcurrent\n" });
    model.add(display({ "text/plain": "\u001b[31mred\u001b[0m" }));
    model.get(1).setData({ data: { "text/plain": "latest" } });
    node.querySelector(".gutter").click();
    node.querySelector(".output-fold").click();
    expect(cellText(source, model, () => null, richText)).toBe(source + "\n\ncurrent\nlatest");
    model.clear(false);
    expect(cellText(source, model, () => null, richText)).toBe(source);
  });
  it("uses safe rich-text snapshots, JSON, tracebacks, and explicit image/chart placeholders", () => {
    const model = new OutputAreaModel({ trusted: false });
    cleanup.push(() => model.dispose());
    model.add(display({ "text/html": "<p>first</p><p>second<script>bad()</script></p>" }));
    expect(outputText(model.get(0), null, richText)).toBe("first\nsecond");
    model.get(0).setData({ data: { "text/html": "<b>updated</b>" } });
    expect(outputText(model.get(0), null, richText)).toBe("updated");
    model.add(display({ "text/markdown": "**Heading**\n\nBody" }));
    expect(outputText(model.get(1), null, richText)).toContain("Heading\n");
    model.add(display({ "application/json": { answer: 42 } }));
    expect(outputText(model.get(2))).toBe('{\n  "answer": 42\n}');
    model.add(display({ "image/png": "NOT-COPIED" }));
    expect(outputText(model.get(3))).toBe("[Image output]");
    model.add(display({ "application/vnd.plotly.v1+json": { data: [] } }));
    expect(outputText(model.get(4))).toBe("[Plotly output]");
    model.add({
      output_type: "error",
      ename: "ValueError",
      evalue: "bad",
      traceback: ["\u001b[31mValueError: bad\u001b[0m"],
    });
    expect(outputText(model.get(5))).toBe("ValueError: bad");
  });
  it("calls the clipboard in the click handler and reports failures without losing focus", async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const button = copyButton(() => "snapshot", "Copy cell");
    document.body.append(button);
    button.focus();
    button.click();
    expect(writeText).toHaveBeenCalledWith("snapshot");
    await vi.waitFor(() => expect(button.textContent).toBe("Copy failed"));
    expect(document.activeElement).toBe(button);
    button.remove();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  });
});

it("validates stored view preferences", () => {
  const storage = (value) => ({ getItem: () => value });
  expect(readViewPreferences(storage("not-json"))).toEqual({ wrap: false, language: "python" });
  expect(readViewPreferences(storage('{"wrap":"yes","language":"unknown"}'))).toEqual({
    wrap: false,
    language: "python",
  });
  expect(readViewPreferences(storage('{"wrap":true,"language":"javascript"}'))).toEqual({
    wrap: true,
    language: "javascript",
  });
});
