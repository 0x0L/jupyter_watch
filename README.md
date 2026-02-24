# jupyter-watch

A web-based real-time viewer for Jupyter kernel output. Connects to a running kernel via ZeroMQ and displays executed code, results, streams, and errors in a JupyterLab-inspired interface.

Features: syntax highlighting, LaTeX math rendering, dark/light theme, cell folding, auto-scroll, click-to-copy.

## Prerequisites

- Node.js >= 18
- Jupyter (`pip install jupyter`)

## Setup

```shell
npm install
npm run build
```

## Usage

1. Launch a Jupyter kernel

```shell
jupyter kernel
# [KernelApp] Connection file: .../kernel-2c91528a-....json
```

2. Start the server (pass any unique prefix of the kernel UUID)

```shell
node server.js 2c91
```

3. Open http://localhost:8765

4. Execute code from any Jupyter client

```shell
jupyter console --existing 2c91
```

The port can be configured with the `PORT` environment variable.

## Development

Run the backend and Vite dev server side by side:

```shell
node server.js <kernel-id>   # backend on :8765
npm run dev                   # Vite HMR on :5173
```

Open http://localhost:5173 during development.

## Scripts

| Command          | Description                         |
| ---------------- | ----------------------------------- |
| `npm run dev`    | Start Vite dev server with HMR      |
| `npm run build`  | Production build to `dist/`         |
| `npm start`      | Run the production server           |
| `npm run lint`   | Run ESLint and Prettier checks      |
| `npm run format` | Auto-format all files with Prettier |

## License

MIT
