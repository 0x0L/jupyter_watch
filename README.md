# jupyter-watch

A web-based real-time viewer for Jupyter kernel output. Connects to a running kernel via ZeroMQ and displays executed code, results, streams, and errors in a JupyterLab-inspired interface.

Features: syntax highlighting, LaTeX math rendering, dark/light theme, cell folding, auto-scroll, click-to-copy.

## Quick start

Prerequisites: Node.js >= 18 and a Jupyter kernel.

### 1. Get a running kernel UUID

If you already have a local running kernel (e.g. from JupyterLab or a notebook), you can get the kernel UUID with

```python
import ipykernel
ipykernel.get_connection_file()
```

You could also check the active connection files:

```shell
ls ~/.local/share/jupyter/runtime/kernel-*.json   # Linux
ls ~/Library/Jupyter/runtime/kernel-*.json        # macOS
```

Each file is named `kernel-<uuid>.json`. The UUID identifies the kernel.

To start a fresh standalone kernel:

```
$ jupyter kernel
[KernelApp] Starting kernel 'python3'
[KernelApp] Connection file: .../kernel-2c91528a-a8f7-437a-83ba-94c0af8c5228.json
```

The kernel UUID here is `2c91528a-a8f7-437a-83ba-94c0af8c5228`. You can refer to it by any unique prefix — `2c91528a`, `2c91`, or even `2c` if no other kernel shares that prefix.

### 2. Run jupyter-watch

```shell
npx github:0x0L/jupyter_watch 2c91
```

This starts a server on http://localhost:8765. To use a different port:

```shell
PORT=3000 npx github:0x0L/jupyter_watch 2c91
```

## Build from source

```shell
git clone https://github.com/0x0L/jupyter_watch.git
cd jupyter_watch
npm install
npm run build
node server.js <kernel-id>
```

## Development

Run the backend and Vite dev server side by side:

```shell
node server.js <kernel-id>   # backend on :8765
npm run dev                  # Vite HMR on :5173
```

Open http://localhost:5173 during development.

| Command          | Description                         |
| ---------------- | ----------------------------------- |
| `npm run dev`    | Start Vite dev server with HMR      |
| `npm run build`  | Production build to `dist/`         |
| `npm start`      | Run the production server           |
| `npm run lint`   | Run ESLint and Prettier checks      |
| `npm run format` | Auto-format all files with Prettier |

## License

MIT
