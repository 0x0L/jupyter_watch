# jupyter-watch

A web-based jupyter kernel watcher.

## Demo

1. Launch a jupyter kernel

```shell
❯ jupyter kernel
[KernelApp] Starting kernel 'python3'
[KernelApp] Connection file: /Users/xav/Library/Jupyter/runtime/kernel-2c91528a-a8f7-437a-83ba-94c0af8c5228.json
[KernelApp] To connect a client: --existing kernel-2c91528a-a8f7-437a-83ba-94c0af8c5228.json
```

Kernel id in this case is `2c91`

2. Launch the proxy

```shell
python websocket.py 2c91
```

3. Open `index.html` in your browser

4. Use the REPL to interact with the kernel

```shell
python repl.py 2c91
```
