# jupyter-watch

A web-based jupyter kernel watcher experiment.

## Setup

```shell
npm install
npm run build
```

## Demo

1. Launch a jupyter kernel

```shell
jupyter kernel
[KernelApp] Starting kernel 'python3'
[KernelApp] Connection file: /Users/xav/Library/Jupyter/runtime/kernel-2c91528a-a8f7-437a-83ba-94c0af8c5228.json
[KernelApp] To connect a client: --existing kernel-2c91528a-a8f7-437a-83ba-94c0af8c5228.json
```

Kernel id in this case is `2c91`

2. Launch the server

```shell
node server.js 2c91
```

3. Open `http://localhost:8765` in your browser

4. Connect to the kernel

```shell
jupyter console --existing 2c91
```

## Development

Run the relay server and Vite dev server:

```shell
node server.js <kernel-id>   # relay on :8765
npm run dev                   # Vite HMR on :5173
```

Open `http://localhost:5173` during development.
