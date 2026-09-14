import { afterEach, describe, expect, it, vi } from "vitest";
import { MimeModel } from "@jupyterlab/rendermime";
import { OutputRouter } from "../src/output-router.js";
import { rendermime, WatchOutputArea } from "../src/renderer.js";
import { Widget } from "@lumino/widgets";

const routers = [];
function router(options = {}) {
  const result = new OutputRouter({
    createCell: () => ({ setInput: vi.fn(), dispose: vi.fn() }),
    ...options,
  });
  routers.push(result);
  return result;
}
function msg(type, content, parent = "a") {
  return { header: { msg_type: type }, parent_header: { msg_id: parent }, content };
}
function display(text, id = "plot") {
  return { data: { "text/plain": text }, metadata: {}, transient: { display_id: id } };
}
afterEach(() => {
  for (const r of routers.splice(0)) r.reset();
});

describe("passive output routing", () => {
  it("merges streams and applies carriage returns and backspaces using Jupyter", () => {
    const r = router();
    r.handle(msg("stream", { name: "stdout", text: "step 1" }));
    r.handle(msg("stream", { name: "stdout", text: "\rstep 2\b3" }));
    const model = r.cells.get("a").model;
    expect(model.toJSON()).toEqual([{ output_type: "stream", name: "stdout", text: "step 3" }]);
    r.handle(msg("stream", { name: "stderr", text: "warning" }));
    expect(model.length).toBe(2);
  });
  it("keeps orphan outputs when their execute_input arrives later", () => {
    const r = router();
    r.handle(msg("display_data", display("before")));
    r.handle(msg("execute_input", { code: "print('hello')", execution_count: 1 }));
    expect(r.cells.size).toBe(1);
    expect(r.cells.get("a").model.length).toBe(1);
    expect(r.cells.get("a").view.setInput).toHaveBeenCalledWith("print('hello')", 1);
  });
  it("updates every matching display across cells without appending", () => {
    const r = router();
    r.handle(msg("display_data", display("old")));
    r.handle(msg("execute_result", { ...display("old"), execution_count: 7 }, "b"));
    r.handle(msg("update_display_data", { ...display("new"), metadata: { test: true } }, "c"));
    expect(r.cells.size).toBe(2);
    for (const cell of r.cells.values()) {
      expect(cell.model.length).toBe(1);
      expect(cell.model.get(0).data["text/plain"]).toBe("new");
      expect(cell.model.get(0).metadata).toEqual({ test: true });
    }
    expect(r.cells.get("b").model.get(0).executionCount).toBe(7);
  });
  it("honors deferred clearing and never resurrects cleared display targets", () => {
    const r = router();
    r.handle(msg("display_data", display("old")));
    const model = r.cells.get("a").model;
    r.handle(msg("clear_output", { wait: true }));
    expect(model.length).toBe(1);
    r.handle(msg("stream", { name: "stdout", text: "next" }));
    expect(model.length).toBe(1);
    r.handle(msg("update_display_data", display("should not appear")));
    expect(model.get(0).type).toBe("stream");
    r.handle(msg("clear_output", { wait: false }));
    expect(model.length).toBe(0);
    r.handle(msg("update_display_data", display("still absent")));
    expect(model.length).toBe(0);
  });
  it("disposes evicted cells and bounds even a single continuously growing stream", () => {
    const r = router({ maxCells: 1, maxBytes: 1500 });
    r.handle(msg("display_data", display("first")));
    const first = r.cells.get("a");
    r.handle(msg("display_data", display("second"), "b"));
    expect(first.model.isDisposed).toBe(true);
    expect(first.view.dispose).toHaveBeenCalled();
    r.handle(msg("stream", { name: "stdout", text: "x".repeat(1000) }, "b"));
    expect(r.bytes).toBe(0);
    expect(r.cells.size).toBe(0);
  });
});

describe("Jupyter MIME rendering", () => {
  it.each(["text/html", "text/markdown"])("sanitizes active content in %s", async (mime) => {
    const renderer = rendermime.createRenderer(mime);
    await renderer.renderModel(
      new MimeModel({
        trusted: false,
        data: {
          [mime]:
            '<b>safe</b><img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link</a>',
        },
      }),
    );
    expect(renderer.node.textContent).toContain("safe");
    expect(renderer.node.querySelector("script, [onerror], [href^='javascript:']")).toBeNull();
    renderer.dispose();
  });
  it("renders Unicode SVG in image context and handles JSON null", async () => {
    const svg = rendermime.createRenderer("image/svg+xml");
    await svg.renderModel(
      new MimeModel({
        data: {
          "image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>',
        },
      }),
    );
    expect(decodeURIComponent(svg.node.querySelector("img").src)).toContain("日本語");
    const json = rendermime.createRenderer("application/json");
    await json.renderModel(new MimeModel({ data: { "application/json": null } }));
    expect(json.node.querySelector("pre").textContent).toBe("null");
    svg.dispose();
    json.dispose();
  });
  it("updates a mounted output widget and retains copy controls", async () => {
    const r = router();
    r.handle(msg("display_data", display("old")));
    const area = new WatchOutputArea({ model: r.cells.get("a").model, rendermime });
    Widget.attach(area, document.body);
    await vi.waitFor(() => expect(area.node.textContent).toContain("old"));
    expect(area.node.querySelector(".copy-btn")).not.toBeNull();
    r.handle(msg("update_display_data", display("new")));
    await vi.waitFor(() => expect(area.node.textContent).toContain("new"));
    expect(area.node.querySelectorAll(".jp-OutputArea-child")).toHaveLength(1);
    area.dispose();
  });
});
