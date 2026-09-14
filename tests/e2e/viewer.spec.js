import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import WebSocket from "ws";

function execute(code) {
  execFileSync(
    "uv",
    ["run", "python", "tests/execute.py", resolve(".test-runtime/kernel-test.json"), code],
    { timeout: 30000 },
  );
}

test("live output, sanitized rich content, display updates, controls and fresh displays after reload or reconnect", async ({
  page,
  context,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.locator("#kernel-info")).toHaveText("kernel-test.json");
  await expect(page.locator("#status")).toHaveClass("status connected", { timeout: 15000 });
  execute(`from IPython.display import display, HTML, Markdown, SVG, clear_output
print('watcher-stream-marker')
handle = display(HTML('<b>initial display</b>'), display_id=True)
`);
  await expect(page.locator(".jp-OutputArea")).toContainText(["watcher-stream-marker"]);
  execute("handle.update(HTML('<b>updated display</b>'))");
  await expect(page.locator(".jp-OutputArea b")).toHaveText("updated display");
  await expect(page.locator(".jp-OutputArea b")).toHaveCount(1);
  await expect(page.locator(".cell-input .gutter").first()).toHaveText(/^In \[\d+\]:$/);
  await expect(page.locator(".continuation-prompts").first()).toContainText("...:");
  execute("6 * 7");
  await expect(page.locator(".jp-OutputArea-executeResult").last()).toContainText("42");
  await expect(page.locator(".jp-OutputArea-executeResult .jp-OutputPrompt").last()).toHaveText(
    /^\[\d+\]:$/,
  );
  const input = page.locator(".cell-input").first();
  await input.locator(".gutter").click();
  await expect(input).toHaveClass(/collapsed/);
  await expect(page.locator(".cell-output").first()).toBeVisible();
  await expect(input.locator(".source")).toBeHidden();
  await expect(input.getByRole("button", { name: "Expand input", exact: true })).toBeVisible();
  await expect(input.locator(".gutter")).toHaveAttribute("aria-expanded", "false");
  await input.getByRole("button", { name: "Expand input", exact: true }).click();
  await expect(input.locator(".source")).toBeVisible();
  execute(`display(Markdown('**Markdown marker** and $x^2$'))
display(HTML('<img src="invalid" onerror="document.body.dataset.compromised=1"><script>document.body.dataset.compromised=1</script><b>safe marker</b>'))
display(SVG('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="50"><text x="5" y="30">日本語 SVG</text></svg>'))
display({'application/json': {'answer': 42}}, raw=True)
display({'application/vnd.plotly.v1+json': {'data': [{'x': [1,2,3], 'y': [2,1,4], 'type': 'scatter'}], 'layout': {'title': {'text': 'Plotly marker'}, 'height': 300}}}, raw=True)
`);
  await expect(page.locator(".jp-OutputArea .katex")).toHaveCount(1);
  await expect(page.locator(".plotly-output .main-svg").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator("body")).not.toHaveAttribute("data-compromised");
  await expect(page.locator(".jp-OutputArea [onerror], .jp-OutputArea script")).toHaveCount(0);
  await page.locator(".jp-OutputArea summary").click();
  await expect(page.locator(".jp-OutputArea details pre")).toBeVisible();
  const output = page.locator(".jp-OutputArea-child").first();
  const section = page.locator(".cell-output").first();
  await section.locator(".output-fold").click();
  await expect(section).toHaveClass(/collapsed/);
  await expect(section.locator(".output-host")).toBeHidden();
  await expect(input.locator(".source")).toBeVisible();
  await expect(section.locator(".fold-placeholder")).toBeVisible();
  await input.locator(".gutter").click();
  await page.screenshot({
    path: ".test-runtime/folded.png",
    fullPage: true,
    animations: "disabled",
  });
  await input.locator(".fold-placeholder").click();
  await expect(section).toHaveClass(/collapsed/);
  await section.locator(".fold-placeholder").click();
  await expect(output.locator(".jp-OutputArea-output")).toBeVisible();
  await output.hover();
  await output.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(output.getByRole("button", { name: "Copied!" })).toBeVisible();
  await page.screenshot({
    path: ".test-runtime/light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByTitle("Toggle dark mode").click();
  await expect(page.locator("body")).toHaveClass("dark");
  await expect(page.locator(".plotly-output .gtitle")).toBeVisible();
  await page.screenshot({ path: ".test-runtime/dark.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const chart = await page.locator(".plotly-output .main-svg").first().boundingBox();
      return chart.width;
    })
    .toBeLessThan(310);
  await page.screenshot({
    path: ".test-runtime/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(page.locator("#status")).toHaveClass("status connected");
  await expect(page.locator(".jp-OutputArea-child")).toHaveCount(0);
  execute("print('after-reload-marker')");
  await expect(page.locator(".jp-OutputArea").last()).toContainText("after-reload-marker");
  await context.setOffline(true);
  await expect(page.locator("#status")).toHaveClass("status disconnected");
  execute("print('during-disconnection-marker')");
  await context.setOffline(false);
  await expect(page.locator("#status")).toHaveClass("status connected", { timeout: 15000 });
  await expect(page.locator(".jp-OutputArea-child")).toHaveCount(0);
  execute("print('after-reconnect-marker')");
  await expect(page.locator(".jp-OutputArea").last()).toContainText("after-reconnect-marker");
  await expect(page.locator("#notebook")).not.toContainText("during-disconnection-marker");
  execute("print('cleared-marker'); clear_output(wait=True); print('replacement-marker')");
  await expect(page.locator(".jp-OutputArea").last()).toContainText("replacement-marker");
  await expect(page.locator(".jp-OutputArea").last()).not.toContainText("cleared-marker");
  expect(errors).toEqual([]);
  expect((await request.get("/", { headers: { Host: "evil.example" } })).status()).toBe(403);
});

test("rejects cross-origin WebSocket subscribers", async () => {
  const status = await new Promise((resolveStatus, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:8876/ws", { origin: "https://evil.example" });
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      ws.terminate();
      resolveStatus(res.statusCode);
    });
    ws.on("open", () => {
      ws.close();
      reject(new Error("Untrusted origin connected"));
    });
    ws.on("error", () => {});
  });
  expect(status).toBe(403);
});

test("Vite development proxy delivers kernel output", async ({ page }) => {
  test.setTimeout(60000);
  await expect(async () => {
    await page.goto("http://127.0.0.1:5174");
  }).toPass({ timeout: 15000 });
  await expect(page.locator("#status")).toHaveClass("status connected", { timeout: 30000 });
  await expect(page.locator("#kernel-info")).toHaveText("kernel-test.json");
  execute("print('vite-proxy-marker')");
  await expect(page.locator(".jp-OutputArea").last()).toContainText("vite-proxy-marker");
});
