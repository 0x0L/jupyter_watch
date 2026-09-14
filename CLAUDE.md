# Project guide

jupyter-watch is a passive viewer for existing Jupyter kernels. Prefer upstream Jupyter APIs over implementing kernel protocol or rendering behavior locally.

## Architecture

- `src/jupyter_watch/cli.py`: explicit connection-file CLI, Uvicorn lifecycle, and Python autoreload.
- `src/jupyter_watch/kernel.py`: `AsyncKernelClient`, IOPub + heartbeat only. Never owns the kernel lifecycle. Full envelopes and base64 buffers.
- `src/jupyter_watch/server.py`, `subscriber.py`: loopback Starlette/Uvicorn HTTP/WebSocket service, Host/Origin checks, bounded live subscriber queues. No output history or replay.
- `src/output-router.js`: parent request / display ID routing into JupyterLab models with bounded retention.
- `src/renderer.js`: JupyterLab rendering plus Plotly, JSON, SVG images, math/Markdown, and folding/copy controls. Models remain untrusted.
- `src/cell-view.js`: independent input/grouped-output folding and cell actions around Jupyter output widgets.
- `src/transcript.js`: current-model plain-text copying, including folded content.
- `src/view-settings.js`, `src/preferences.js`, `src/scroll.js`: optional browser preferences and reading-position preservation.
- `src/main.js`, `src/style.css`: presentation and interaction.

## Validation

`uv sync --locked`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`.

`npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run test:browser`.
Chromium tests need `npx playwright install chromium`. Fixtures launch through uv and clean up their own kernels.

`uv build`, `uv run python tests/package_smoke.py` verify standalone distributions. Builds require compiled frontend assets in `src/jupyter_watch/static/`; editable installs do not.

## Development

Run `uv run jupyter-watch /path/to/connection.json --reload --dev-origin http://127.0.0.1:5173` alongside `npm run dev`. No kernel discovery or runtime npm installation.

## Style

Python uses Ruff. JavaScript uses ES modules, double quotes, semicolons, trailing commas, and 100-column Prettier formatting. Test observable behavior rather than upstream internals.
