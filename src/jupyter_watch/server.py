"""Loopback ASGI HTTP/WebSocket delivery without output history."""

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.responses import PlainTextResponse, RedirectResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from .kernel import KernelObserver, encode, load_client
from .subscriber import MAX_BYTES, Subscriber

STATIC = Path(__file__).parent / "static"


class Hub:
    def __init__(self, connection_file):
        self.info = encode(
            {
                "msg_type": "_kernel_info",
                "content": {
                    "connection_file": connection_file,
                },
            }
        )
        self.status = encode({"msg_type": "_kernel_status", "content": {"alive": False}})
        self.subscribers = set()

    def subscribe(self, subscriber):
        subscriber.enqueue(encode({"msg_type": "_reset", "content": {}}))
        subscriber.enqueue(self.info)
        subscriber.enqueue(self.status)
        if not subscriber.closed:
            self.subscribers.add(subscriber)

    def publish(self, message):
        wire = encode(message)
        if message.get("msg_type") == "_kernel_status":
            self.status = wire
        elif len(wire.encode("utf-8")) > MAX_BYTES:
            wire = encode(
                {
                    "msg_type": "_notice",
                    "content": {
                        "text": "An output exceeded the 10 MiB message limit and was omitted.",
                    },
                }
            )
        for subscriber in tuple(self.subscribers):
            subscriber.enqueue(wire)
            if subscriber.closed:
                self.subscribers.discard(subscriber)

    def close(self):
        subscribers = tuple(self.subscribers)
        for subscriber in subscribers:
            subscriber.stop()
        self.subscribers.clear()
        return [subscriber.task for subscriber in subscribers]


class LocalOnly:
    def __init__(self, app, allowed_hosts, dev_origin):
        self.app = app
        self.allowed_hosts = allowed_hosts
        self.dev_origin = dev_origin

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1").lower()
        origin = headers.get(b"origin", b"").decode("latin-1")

        async def secure_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                ]
            await send(message)

        forbidden = host not in self.allowed_hosts
        if scope["type"] == "websocket":
            forbidden |= not origin or origin not in (f"http://{host}", self.dev_origin)
        if forbidden:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse("Forbidden", status_code=403)(scope, receive, secure_send)
            return
        await self.app(scope, receive, secure_send)


def validate_origin(origin):
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("--dev-origin must be an HTTP(S) origin without a path")
    _ = parsed.port  # Validate port syntax/range.
    return origin


class Assets(StaticFiles):
    async def check_config(self):
        # Vite development can run before the first frontend build.
        if Path(self.directory).exists():
            await super().check_config()

    def lookup_path(self, path):
        root = Path(self.directory).resolve()
        if not (root / path).resolve().is_relative_to(root):
            raise HTTPException(403)
        return super().lookup_path(path)


async def viewer_socket(websocket):
    hub = websocket.app.state.hub
    await websocket.accept()
    stopped = asyncio.Event()
    subscriber = Subscriber(websocket.send_text, stopped.set)
    hub.subscribe(subscriber)

    async def read():
        while True:
            message = await websocket.receive()  # Ignore text and binary viewer commands.
            if message["type"] == "websocket.disconnect":
                return

    reader = asyncio.create_task(read())
    closer = asyncio.create_task(stopped.wait())
    try:
        await asyncio.wait((reader, closer), return_when=asyncio.FIRST_COMPLETED)
    finally:
        hub.subscribers.discard(subscriber)
        subscriber.stop()
        reader.cancel()
        closer.cancel()
        await asyncio.gather(reader, closer, subscriber.task, return_exceptions=True)
        with suppress(Exception):
            await asyncio.wait_for(websocket.close(1008, "Viewer cannot keep up"), 1)


async def dev_page(request):
    return RedirectResponse(request.app.state.dev_origin, status_code=302)


def make_application(hub, port, dev_origin=None, static=STATIC, lifespan=None):
    routes = [WebSocketRoute("/ws", viewer_socket)]
    if dev_origin:
        routes.append(Route("/", dev_page))
    routes.append(Mount("/", Assets(directory=static, html=True, check_dir=not dev_origin)))
    app = Starlette(routes=routes, lifespan=lifespan)
    app.state.hub = hub
    app.state.dev_origin = dev_origin
    app.add_middleware(
        LocalOnly,
        allowed_hosts={f"localhost:{port}", f"127.0.0.1:{port}"},
        dev_origin=dev_origin,
    )
    return app


def kernel_lifespan(connection_file):
    @asynccontextmanager
    async def lifespan(app):
        path, client = load_client(connection_file)
        hub = app.state.hub = Hub(path.name)
        observer = KernelObserver(client, hub.publish)
        failure = []
        tasks = []
        stopping = False

        def completed(task):
            if not stopping:
                error = (
                    RuntimeError("Kernel observer stopped unexpectedly")
                    if task.cancelled()
                    else task.exception() or RuntimeError("Kernel observer stopped unexpectedly")
                )
                failure.append(error)

        try:
            observer.start()
            tasks = [
                asyncio.create_task(observer.output()),
                asyncio.create_task(observer.heartbeat()),
            ]
            for task in tasks:
                task.add_done_callback(completed)
            yield {"observer_failure": failure}
        finally:
            stopping = True
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, *hub.close(), return_exceptions=True)
            observer.stop()

    return lifespan
