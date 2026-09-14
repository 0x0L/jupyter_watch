import { test, expect } from "@playwright/test";

// Deterministic protocol messages let the UI exercise unusual combinations
// (output-only cells and non-Python inputs) without owning another kernel.
async function viewer(page) {
  let socket;
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ msg_type: "_reset", content: {} }));
    ws.send(
      JSON.stringify({ msg_type: "_kernel_info", content: { connection_file: "controls.json" } }),
    );
    ws.send(JSON.stringify({ msg_type: "_kernel_status", content: { alive: true } }));
  });
  await page.goto("/");
  await expect(page.locator("#status")).toHaveClass("status connected");
  return (type, content, parent = "a") =>
    socket.send(
      JSON.stringify({
        header: { msg_type: type },
        parent_header: { msg_id: parent },
        content,
      }),
    );
}
const stream = (text) => ({ name: "stdout", text });
const display = (data, id) => ({ data, metadata: {}, transient: id ? { display_id: id } : {} });

test("group folding, current cell copying, output replacement, and Clear remain live", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const send = await viewer(page);
  const code = "print('stream')\ndisplay(value)";
  send("execute_input", { code, execution_count: 1 });
  send("stream", stream("stream\n"));
  send("display_data", display({ "text/plain": "old" }, "value"));
  const cell = page.locator(".cell").first();
  const section = cell.locator(".cell-output");
  await expect(section.locator(".jp-OutputArea-child")).toHaveCount(2);
  await expect(section.locator(".output-fold")).toHaveCount(1);
  await section.getByRole("button", { name: "Fold outputs", exact: true }).click();
  await expect(section.locator(".outputs-placeholder")).toHaveText("⋯ 2 outputs");
  send("update_display_data", display({ "text/plain": "latest" }, "value"), "b");
  await expect(section.locator(".outputs-placeholder")).toContainText("Updated");
  await cell.locator(".gutter").click();
  await cell.hover();
  await cell.getByRole("button", { name: "Copy cell", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${code}\n\nstream\nlatest`);
  await cell.locator(".cell-input .fold-placeholder").click();
  await expect(section.locator(".output-host")).toBeHidden();
  send("clear_output", { wait: true });
  await expect(section).toBeVisible();
  send("stream", stream("replacement\n"));
  await expect(section.locator(".outputs-placeholder")).toHaveText("⋯ 1 output · Updated");
  await section.locator(".outputs-placeholder").click();
  await expect(section.locator(".output-host")).toContainText("replacement");
  send("stream", stream("continued\n"));
  await section.getByRole("button", { name: "Fold outputs", exact: true }).click();
  send("stream", stream("while folded\n"));
  await expect(section.locator(".outputs-placeholder")).toHaveText("⋯ 1 output · Updated");

  await page.locator("#view-settings summary").click();
  await page.getByLabel("Wrap input lines").check();
  await page.getByLabel("Input language").selectOption("javascript");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator("#notebook > div")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveClass("status connected");
  await expect(page.locator("body")).toHaveClass(/wrap-input/);
  send("update_display_data", display({ "text/plain": "must not resurrect" }, "value"));
  await expect(page.locator("#notebook > div")).toHaveCount(0);
  send("stream", stream("output without input\n"), "orphan");
  const orphan = page.locator(".output-only");
  await expect(orphan.locator(".cell-input")).toBeHidden();
  await orphan.hover();
  await orphan.getByRole("button", { name: "Copy cell", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("output without input\n");
  send("execute_input", { code: "const answer = 42;", execution_count: 2 }, "new");
  await expect(page.locator(".cell .hljs-keyword")).toHaveText("const");
});

test("View settings preserve code, folding, reading position, and preferences", async ({
  page,
}) => {
  const send = await viewer(page);
  const code = `const value = '${"longtoken".repeat(50)}';\nconsole.log(value);`;
  for (let i = 0; i < 20; i++) {
    send("execute_input", { code, execution_count: i + 1 }, String(i));
    send("stream", stream(`result ${i}\n`.repeat(5)), String(i));
  }
  await expect(page.locator(".cell")).toHaveCount(20);
  await expect(page.locator("#follow-output")).toBeChecked();
  await page.mouse.move(650, 400);
  await page.mouse.wheel(0, -850);
  await expect(page.locator("#follow-output")).not.toBeChecked();
  const before = await page.locator(".cell").evaluateAll((cells) => {
    const index = cells.findIndex((cell) => cell.getBoundingClientRect().bottom > 60);
    return { index, top: cells[index].getBoundingClientRect().top };
  });
  await page.locator("#view-settings summary").click();
  await page.getByLabel("Wrap input lines").check();
  await page.getByLabel("Input language").selectOption("javascript");
  await expect(page.locator(".cell").first().locator(".source")).toHaveText(code);
  await expect(page.locator(".cell").first().locator(".hljs-keyword").first()).toHaveText("const");
  await expect(page.locator(".continuation-prompts").first()).toBeHidden();
  await expect
    .poll(async () => {
      const box = await page.locator(".cell").nth(before.index).boundingBox();
      return Math.abs(box.y - before.top);
    })
    .toBeLessThan(3);
  await expect(page.locator("#follow-output")).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator("#view-settings")).not.toHaveAttribute("open");
  await expect(page.locator("#view-settings summary")).toBeFocused();
  await page.reload();
  await expect(page.locator("#status")).toHaveClass("status connected");
  await page.locator("#view-settings summary").click();
  await expect(page.getByLabel("Wrap input lines")).toBeChecked();
  await expect(page.getByLabel("Input language")).toHaveValue("javascript");
  await page.getByLabel("Input language").selectOption("plaintext");
  await page.locator(".title").click();
  await expect(page.locator("#view-settings")).not.toHaveAttribute("open");
  send("execute_input", { code, execution_count: 21 }, "later");
  await expect(page.locator(".source")).toHaveText(code);
  await expect(page.locator(".source code span")).toHaveCount(0);
  await page.locator(".gutter").click();
  await expect(page.locator("#follow-output")).toBeChecked();
  await page.locator("#view-settings summary").click();
  await page.getByLabel("Wrap input lines").uncheck();
  await expect(page.locator(".cell-input")).toHaveClass(/collapsed/);
  await page.getByLabel("Input language").selectOption("python");
  await expect(page.locator(".cell-input")).toHaveClass(/collapsed/);
  await page.keyboard.press("Escape");
  await page.locator(".cell-input .fold-placeholder").click();
  await expect(page.locator(".continuation-prompts")).toBeVisible();
  await expect(page.locator(".source")).toHaveText(code);
});

test("grouped charts resize on expansion and View fits a narrow screen", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const send = await viewer(page);
  send("execute_input", { code: "display(fig)", execution_count: 1 });
  send(
    "display_data",
    display({
      "application/vnd.plotly.v1+json": {
        data: [{ x: [1, 2, 3], y: [2, 1, 4], type: "scatter" }],
        layout: { title: { text: "Grouped chart" }, height: 300 },
      },
    }),
  );
  send("display_data", display({ "text/html": "<p>A caption below the chart</p>" }));
  await expect(page.locator(".plotly-output .gtitle")).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Fold outputs", exact: true }).click();
  await page.locator("#view-settings summary").click();
  await page.screenshot({ path: ".test-runtime/view-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".outputs-placeholder").click();
  await expect
    .poll(async () => (await page.locator(".plotly-output .main-svg").first().boundingBox()).width)
    .toBeLessThan(310);
  await expect(page.locator(".plotly-output .gtitle")).toBeVisible();
  await page.getByTitle("Toggle dark mode").click();
  await page.locator("#view-settings summary").click();
  await expect(page.locator(".view-panel")).toBeVisible();
  const panel = await page.locator(".view-panel").boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".test-runtime/view-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("blocked storage does not prevent viewing or changing settings", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  const send = await viewer(page);
  await expect(page.getByText("No activity yet", { exact: true })).toBeVisible();
  await page.getByTitle("Toggle dark mode").click();
  await expect(page.getByTitle("Toggle dark mode")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#view-settings summary").click();
  await page.getByLabel("Wrap input lines").check();
  await page.getByLabel("Input language").selectOption("javascript");
  await page.keyboard.press("Escape");
  send("execute_input", { code: "const answer = 42;", execution_count: 1 });
  await expect(page.locator(".source .hljs-keyword")).toHaveText("const");
  await expect(page.getByText("No activity yet", { exact: true })).toBeHidden();
  await expect(page.locator("body")).toHaveClass(/wrap-input/);
  expect(errors).toEqual([]);
});

test("prompts align and controls do not overlap content at supported widths", async ({ page }) => {
  const send = await viewer(page);
  send("execute_input", { code: "print('alignment')\n42", execution_count: 1 });
  send("execute_result", { data: { "text/plain": "42" }, metadata: {}, execution_count: 1 });
  await expect(page.locator(".jp-OutputArea-output")).toHaveText("42");
  for (const width of [320, 390, 760, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const header = await page.locator("#header").boundingBox();
    const input = await page.locator(".cell-input").boundingBox();
    const source = await page.locator(".source").boundingBox();
    const output = await page.locator(".jp-OutputArea-output").boundingBox();
    const inputActions = await page.locator(".cell-input .cell-actions").boundingBox();
    const outputCopy = await page
      .getByRole("button", { name: "Copy output", exact: true })
      .boundingBox();
    expect(input.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(Math.abs(source.x - output.x)).toBeLessThan(1);
    expect(
      source.x + source.width <= inputActions.x + 1 ||
        source.y + source.height <= inputActions.y + 1,
    ).toBe(true);
    expect(
      output.x + output.width <= outputCopy.x + 1 || output.y + output.height <= outputCopy.y + 1,
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.locator("#view-settings summary").click();
    const panel = await page.locator(".view-panel").boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
});

test("connection filename copying reports success and failure", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await viewer(page);
  const copy = page.getByRole("button", { name: "Copy connection filename: controls.json" });
  await copy.click();
  await expect(page.locator("#notice")).toHaveText("Connection filename copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("controls.json");
  await context.clearPermissions();
  await context.grantPermissions([]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await copy.click();
  await expect(page.locator("#notice")).toHaveText("Could not copy the connection filename.");
});
