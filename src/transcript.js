import stripAnsi from "strip-ansi";

const text = (value) => (Array.isArray(value) ? value.join("") : String(value ?? ""));

// Work from the sanitized renderer subtree, even when it is folded. innerText
// would omit hidden content and can include chart/tool UI.
function renderedText(node) {
  if (!node) return "";
  const copy = node.cloneNode(true);
  copy.querySelectorAll("script, style, button, .katex-mathml").forEach((el) => el.remove());
  copy.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  copy.querySelectorAll("td, th").forEach((el) => el.append("\t"));
  copy
    .querySelectorAll("p, div, pre, li, tr, h1, h2, h3, h4, blockquote")
    .forEach((el) => el.append("\n"));
  return copy.textContent
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function outputText(model, rendererNode, richText) {
  const raw = model.toJSON();
  let result;
  if (raw.output_type === "stream") result = text(raw.text);
  else if (raw.output_type === "error") {
    result = raw.traceback?.length ? raw.traceback.join("\n") : `${raw.ename}: ${raw.evalue}`;
  } else {
    const data = model.data;
    if (Object.hasOwn(data, "text/plain")) result = text(data["text/plain"]);
    else if (Object.hasOwn(data, "application/json"))
      result = JSON.stringify(data["application/json"], null, 2);
    else if (Object.hasOwn(data, "application/vnd.plotly.v1+json")) result = "[Plotly output]";
    else if (Object.keys(data).some((mime) => mime.startsWith("image/"))) result = "[Image output]";
    else
      result =
        renderedText(
          richText && (data["text/html"] || data["text/markdown"]) ? richText(data) : rendererNode,
        ) || "[Rich output]";
  }
  return stripAnsi(result);
}

export function cellText(source, model, rendererForIndex, richText) {
  const outputs = [];
  for (let i = 0; i < model.length; i++) {
    const value = outputText(model.get(i), rendererForIndex(i), richText);
    if (value) outputs.push(value);
  }
  // Preserve source whitespace and stream line breaks; add a separator only
  // where the preceding output doesn't already supply one.
  const output = outputs.reduce(
    (joined, value) => joined + (joined && !joined.endsWith("\n") ? "\n" : "") + value,
    "",
  );
  return source && output ? `${source}\n\n${output}` : source || output;
}
