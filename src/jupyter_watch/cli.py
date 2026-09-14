"""Command-line setup and single-event-loop application lifecycle."""

import argparse
import asyncio
import signal
import sys

from .kernel import KernelObserver, load_client
from .server import STATIC, Hub, make_application, validate_origin


async def serve(path, client, port, dev_origin):
    hub = Hub(path.name)
    observer = KernelObserver(client, hub.publish)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    signals = (signal.SIGINT, signal.SIGTERM)
    for sig in signals:
        loop.add_signal_handler(sig, stopped.set)
    server = None
    tasks = []
    try:
        # Channel setup can reject malformed endpoints before any HTTP listener exists.
        observer.start()
        server = make_application(hub, port, dev_origin).listen(port, address="127.0.0.1")
        print(f"Serving on http://127.0.0.1:{port}", flush=True)
        tasks = [asyncio.create_task(observer.output()), asyncio.create_task(observer.heartbeat())]
        stop_task = asyncio.create_task(stopped.wait())
        tasks.append(stop_task)
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()  # Propagate unrecoverable observer errors to the CLI.
    finally:
        if server:
            server.stop()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, *hub.close(), return_exceptions=True)
        if server:
            await server.close_all_connections()
        observer.stop()
        for sig in signals:
            loop.remove_signal_handler(sig)


def main():
    parser = argparse.ArgumentParser(description="Passively view an existing Jupyter kernel")
    parser.add_argument("connection_file", help="Explicit Jupyter connection JSON file")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dev-origin", help="Allow the Vite origin, e.g. http://127.0.0.1:5173")
    args = parser.parse_args()
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError("--port must be between 1 and 65535")
        if args.dev_origin:
            validate_origin(args.dev_origin)
        path, client = load_client(args.connection_file)
        if not args.dev_origin and not (STATIC / "index.html").is_file():
            raise ValueError("Frontend assets missing. Run npm run build, or use --dev-origin.")
        asyncio.run(serve(path, client, args.port, args.dev_origin))
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"jupyter-watch: {error}", file=sys.stderr)
        return 1
    return 0
