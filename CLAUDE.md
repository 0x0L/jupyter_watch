# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is jupyter-watch

A real-time web viewer for Jupyter kernel output. A Node.js server connects to a running Jupyter kernel via ZeroMQ (iopub port), parses the wire protocol (HMAC-SHA256 validated), and broadcasts messages over WebSocket to a browser client that renders cells with syntax highlighting, LaTeX math, markdown, and ANSI colors.

## Commands

| Command          | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `npm run dev`    | Vite dev server (port 5173, proxies WS to backend) |
| `npm run build`  | Production build to `dist/`                        |
| `npm start`      | Run production server (`node server.js`)           |
| `npm run lint`   | ESLint + Prettier check                            |
| `npm run format` | Auto-format with Prettier                          |

Run backend separately during development: `node server.js <kernel-id>`

No test framework is configured.

## Architecture

Three-file frontend + one-file backend:

- **server.js** — HTTP + WebSocket server. Discovers Jupyter connection files, connects to kernel iopub via ZeroMQ, broadcasts parsed messages to all WS clients.
- **src/main.js** — Browser client. WebSocket with auto-reconnect (exponential backoff). Tracks cells by `parent_msg_id` mapping to DOM elements. Handles Jupyter message types: `execute_input`, `execute_result`, `display_data`, `stream`, `error`, `status`.
- **src/renderer.js** — Output rendering. MIME type priority: HTML → Markdown → LaTeX → images → JSON → plain text. Syntax highlighting via highlight.js, math via KaTeX, ANSI via ansi_up.
- **src/style.css** — All styling, dark/light theme support.

## Code Style

- Prettier: double quotes, semicolons, trailing commas, 100-char line width
- ESLint: `no-unused-vars` allows `_` prefix for intentionally unused args
- Vanilla JS, no framework — direct DOM manipulation
