"""CLI configuration and Uvicorn process lifecycle."""

import argparse
import json
import os
import signal
import sys
from pathlib import Path

import uvicorn
from uvicorn.protocols.websockets.websockets_sansio_impl import WebSocketsSansIOProtocol
from uvicorn.supervisors import ChangeReload

from .kernel import validate_connection
from .server import STATIC, kernel_lifespan, make_application, validate_origin

CONFIG_ENV = "_JUPYTER_WATCH_SERVER_CONFIG"


def create_app():
    config = json.loads(os.environ[CONFIG_ENV])
    return make_application(
        None,
        config["port"],
        config["dev_origin"],
        lifespan=kernel_lifespan(config["connection_file"]),
    )


class ViewerWebSocketProtocol(WebSocketsSansIOProtocol):
    """Discard buffered output when evicting a slow viewer."""

    async def send(self, message):
        evict = message["type"] == "websocket.close" and message.get("code") == 1008
        try:
            await super().send(message)
        finally:
            # Also runs when the app's bounded close is cancelled by its timeout.
            if evict and self.handshake_complete:
                self.transport.abort()


class ViewerServer(uvicorn.Server):
    """Stop on observer failure; retain successful exit status on normal shutdown."""

    def handle_exit(self, sig, frame):
        if self.should_exit and sig == signal.SIGINT:
            self.force_exit = True
        self.should_exit = True

    async def on_tick(self, counter):
        if self.lifespan.state.get("observer_failure"):
            self.should_exit = True
        return await super().on_tick(counter)

    def run(self, sockets=None):
        super().run(sockets=sockets)
        failure = self.lifespan.state.get("observer_failure")
        if failure:
            raise RuntimeError(f"Kernel observer failed: {failure[0]}") from failure[0]


def run_server(config, reload=False):
    server = ViewerServer(config)
    if reload:
        sock = config.bind_socket()
        try:
            ChangeReload(config, target=server.run, sockets=[sock]).run()
        finally:
            sock.close()
    else:
        server.run()


def main():
    parser = argparse.ArgumentParser(description="Passively view an existing Jupyter kernel")
    parser.add_argument("connection_file", help="Explicit Jupyter connection JSON file")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dev-origin", help="Allow the Vite origin, e.g. http://127.0.0.1:5173")
    parser.add_argument("--reload", action="store_true", help="Restart on Python source changes")
    args = parser.parse_args()
    previous = os.environ.get(CONFIG_ENV)
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError("--port must be between 1 and 65535")
        if args.dev_origin:
            validate_origin(args.dev_origin)
        path, _ = validate_connection(args.connection_file)
        if not args.dev_origin and not (STATIC / "index.html").is_file():
            raise ValueError("Frontend assets missing. Run npm run build, or use --dev-origin.")
        os.environ[CONFIG_ENV] = json.dumps(
            dict(connection_file=str(path), port=args.port, dev_origin=args.dev_origin)
        )
        config = uvicorn.Config(
            "jupyter_watch.cli:create_app",
            factory=True,
            host="127.0.0.1",
            port=args.port,
            workers=1,
            proxy_headers=False,
            ws=ViewerWebSocketProtocol,
            ws_max_size=1024,
            ws_ping_interval=20,
            ws_ping_timeout=20,
            timeout_graceful_shutdown=5,
            reload=args.reload,
            reload_dirs=[str(Path(__file__).parent)] if args.reload else None,
            reload_excludes=["**/static/**"] if args.reload else None,
        )
        run_server(config, args.reload)
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"jupyter-watch: {error}", file=sys.stderr)
        return 1
    finally:
        if previous is None:
            os.environ.pop(CONFIG_ENV, None)
        else:
            os.environ[CONFIG_ENV] = previous
    return 0
