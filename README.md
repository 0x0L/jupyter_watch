# jupyter-watch

A web-based jupyter kernel watcher experiment.

https://github.com/0x0L/jupyter_watch/assets/3621629/9126782a-f8e3-42d8-85e1-5d86df11010a


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
python relay.py 2c91
```

3. Open `index.html` in your browser

4. Connect to the kernel

```shell
jupyter console --existing 2c91
```
