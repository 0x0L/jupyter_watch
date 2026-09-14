# jupyter-watch

A local web viewer for live Jupyter kernel activity. Attach using an explicit connection file. The watcher uses **JupyterLab's output models and MIME renderers** in the browser and **`jupyter_client` with Tornado** in one Python backend.

It supports code highlighting, HTML/Markdown, math, images, JSON, Plotly, streams, tracebacks, display updates, output clearing, folding, copying, themes, and automatic scrolling.

## Run

Python 3.11+ is required. Installed distributions include the compiled frontend; running the watcher needs neither Node nor npm.

Install a built wheel with uv:

```sh
uv tool install /path/to/jupyter_watch-0.1.0-py3-none-any.whl
jupyter-watch /path/to/connection.json
```

From a prepared checkout (see below):

```sh
uv run jupyter-watch /path/to/connection.json
```

Open <http://127.0.0.1:8765>. Relative paths and `~` paths are accepted. The connection file must exist and contain valid Jupyter connection settings. The filename shown in the viewer is not a verified kernel UUID. The watcher does not discover, start, execute on, interrupt, or shut down kernels.

To get the connection file from an existing notebook or console:

```python
import ipykernel

ipykernel.get_connection_file()
```

Alternatively, start a kernel separately with `jupyter kernel` and pass its connection file.

Use `--port 3000` to change the listening port. The server binds to `127.0.0.1`, validates Host headers, and requires same-origin WebSocket connections. An explicit `--dev-origin` allows Vite during development. This is a local viewer; remote hosting and Jupyter Server integration are outside its scope.

The former Node launcher, UUID-prefix lookup, runtime-directory searches, and `PORT`, `WATCH_DEV_ORIGIN`, and `JUPYTER_WATCH_PYTHON` environment variables have been retired. Use the connection path, `--port`, and `--dev-origin` flags instead.

## Build and develop

Development uses uv with Python 3.12 and a current Node LTS release for frontend tooling. Frontend compilation is explicit:

```sh
uv sync --locked
npm ci
npm run build
uv build
uv run jupyter-watch /path/to/connection.json
```

Vite writes assets into the ignored `src/jupyter_watch/static/` directory. `uv build` creates a wheel and source distribution in `dist/`, both containing those assets. Release builds fail if assets are absent. Editable installation works before the frontend is built. Python startup never installs dependencies or runs npm.

For hot reload, run in separate terminals:

```sh
uv run jupyter-watch /path/to/connection.json --dev-origin http://127.0.0.1:5173
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the page and proxies `/ws`. Compiled frontend assets are not required in this mode. If you change the backend port, update Vite's proxy target in `vite.config.js`.

## Verify

```sh
uv run ruff check .
uv run ruff format --check .
uv run pytest
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
uv build
uv run python tests/package_smoke.py
```

Python tests exercise validation, live-only delivery, slow readers, security, full signed messages and buffers, heartbeat loss, and shutdown without stopping the kernel. Chromium tests exercise rendering, controls, clearing, cross-cell updates, empty displays after reload, offline reconnect, and Vite's proxy. Test fixtures use uv and own only their test kernels. The package smoke test installs the wheel into an isolated environment, runs outside the checkout without Node on PATH, verifies HTTP assets and WebSocket output, and checks the source distribution assets.

## Architecture and behavior

- `src/jupyter_watch/cli.py`: argparse setup and application lifecycle on one asyncio loop.
- `src/jupyter_watch/kernel.py`: passive `AsyncKernelClient`, with IOPub observation and independently polled heartbeat. Jupyter handles signatures and decoding. Complete envelopes and metadata are preserved, with binary buffers encoded as base64.
- `src/jupyter_watch/server.py` and `subscriber.py`: Tornado static/WebSocket handling, and ordered per-subscriber send queues. Stopping the watcher leaves the kernel running.
- `src/output-router.js`: routes executions into JupyterLab `OutputAreaModel`, including orphan outputs and display IDs shared across cells. Jupyter handles stream merging, carriage returns, backspaces, and deferred clearing.
- `src/renderer.js`: JupyterLab renderers with adapters for math/Markdown, JSON, SVG images, Plotly, and folding/copy controls. Plotly loads from a bundled chunk, with no CDN dependency.
- `src/main.js`: cell views, connection state, themes, and scrolling.

Output models are **untrusted**: Jupyter sanitizes HTML and Markdown, arbitrary JavaScript MIME output is disabled, and SVG uses an image context. Interactive Plotly charts use the bundled renderer. The sanitizer dependency is overridden to a compatible patched 2.x version.

The server stores no output history. Reloading the page or reconnecting starts with an empty display and shows only new kernel activity; output emitted while disconnected is lost. Larger individual messages (over 10 MiB) are omitted with a notice. Each subscriber has an ordered delivery queue capped at 2,003 messages / 10 MiB + 64 KiB, including its in-flight write; slow readers are disconnected on overflow or a 10-second write timeout. These queues are only for live delivery and are never replayed to another connection.

The browser retains at most **200 cells / 20 MiB of accounted activity**. Accounting includes replaced outputs and two bytes per JSON character. Older cells and their renderers are disposed. These limits bound retained data, not total memory used by browsers or plot renderers.

Viewing can begin partway through an execution; output is grouped by parent request even if the code input is unavailable. The connection indicator uses heartbeat independently of output traffic and WebSocket connectivity. Unavailable kernels are shown as disconnected.

Widget comm messages and buffers are preserved, but **ipywidgets are not rendered**. The watcher does not answer stdin or provide kernel controls.

## License

MIT
