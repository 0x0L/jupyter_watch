"""Loopback HTTP/WebSocket delivery without output history."""

from pathlib import Path
from urllib.parse import urlsplit

from tornado.web import Application, HTTPError, RequestHandler, StaticFileHandler
from tornado.websocket import WebSocketHandler

from .kernel import encode
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
    def prepare(self):
        if self.request.host.lower() not in self.settings["allowed_hosts"]:
            raise HTTPError(403)
        return super().prepare()

    def set_default_headers(self):
        self.set_header("X-Content-Type-Options", "nosniff")
        self.set_header("Referrer-Policy", "no-referrer")


class Assets(LocalOnly, StaticFileHandler):
    def validate_absolute_path(self, root, absolute_path):
        # Also contain symlinks, in addition to Tornado's traversal protection.
        if not Path(absolute_path).resolve().is_relative_to(Path(root).resolve()):
            raise HTTPError(403)
        return super().validate_absolute_path(root, absolute_path)


class ViewerSocket(LocalOnly, WebSocketHandler):
    subscriber = None

    def prepare(self):
        super().prepare()
        # Tornado normally allows absent Origin headers; viewers must supply one.
        origin = self.request.headers.get("Origin")
        if not origin or not self.check_origin(origin):
            raise HTTPError(403)

    def check_origin(self, origin):
        return (
            origin == f"http://{self.request.host.lower()}" or origin == self.settings["dev_origin"]
        )

    def open(self):
        def close():
            self.settings["hub"].subscribers.discard(self.subscriber)
            self.close(1008, "Viewer cannot keep up")
            # Abort buffered writes immediately instead of retaining a slow connection.
            if self.ws_connection:
                self.ws_connection.stream.close()

        self.subscriber = Subscriber(self.write_message, close)
        self.settings["hub"].subscribe(self.subscriber)

    def on_message(self, message):
        pass  # This is a read-only viewer, with no commands to forward.

    def on_close(self):
        if self.subscriber:
            self.settings["hub"].subscribers.discard(self.subscriber)
            self.subscriber.stop()


class DevPage(LocalOnly, RequestHandler):
    def get(self):
        self.redirect(self.settings["dev_origin"])


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


def make_application(hub, port, dev_origin=None, static=STATIC):
    routes = [(r"/ws", ViewerSocket)]
    if dev_origin:
        routes.append((r"/", DevPage))
    routes.append((r"/(.*)", Assets, {"path": str(static), "default_filename": "index.html"}))
    return Application(
        routes,
        hub=hub,
        dev_origin=dev_origin,
        allowed_hosts={f"localhost:{port}", f"127.0.0.1:{port}"},
        websocket_max_message_size=1024,
        websocket_ping_interval=20,
    )
