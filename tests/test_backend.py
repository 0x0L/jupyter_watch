import asyncio
import json
import os
import unittest
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from jupyter_watch.kernel import load_client
from jupyter_watch.server import Hub, make_application, validate_origin
from jupyter_watch.subscriber import Subscriber


@pytest.fixture
def connection(tmp_path):
    path = tmp_path / "connection.json"
    path.write_text(
        json.dumps(
            dict(
                transport="tcp",
                ip="127.0.0.1",
                key="secret",
                signature_scheme="hmac-sha512",
                shell_port=9001,
                iopub_port=9002,
                stdin_port=9003,
                control_port=9004,
                hb_port=9005,
            )
        )
    )
    return path


def test_explicit_paths(connection, monkeypatch):
    monkeypatch.chdir(connection.parent)
    assert load_client(connection.name)[0] == connection
    home_relative = os.path.relpath(connection, Path.home())
    assert load_client(f"~/{home_relative}")[0] == connection
    with pytest.raises(ValueError, match="does not exist"):
        load_client("abcd")


@pytest.mark.parametrize(
    "field,value",
    [
        ("transport", "udp"),
        ("ip", ""),
        ("iopub_port", 0),
        ("hb_port", 65536),
        ("shell_port", True),
        ("key", None),
        ("signature_scheme", "hmac-no-such-hash"),
    ],
)
def test_invalid_settings(connection, field, value):
    info = json.loads(connection.read_text())
    info[field] = value
    connection.write_text(json.dumps(info))
    with pytest.raises(Exception):
        load_client(connection)


@pytest.mark.parametrize("data", ["[]", "{", "{}"])
def test_invalid_json(connection, data):
    connection.write_text(data)
    with pytest.raises(ValueError):
        load_client(connection)


@pytest.mark.parametrize(
    "origin", ["file:///tmp", "http://a/path", "http://u:p@a", "http://a:99999"]
)
def test_invalid_dev_origin(origin):
    with pytest.raises(ValueError):
        validate_origin(origin)


class SubscriberTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_live_output_in_order(self):
        hub = Hub("connection.json")
        hub.publish({"content": "old"})
        received = []

        async def write(message):
            await asyncio.sleep(0)
            received.append(json.loads(message))

        subscriber = Subscriber(write, lambda: None)
        hub.subscribe(subscriber)
        hub.publish({"content": "new"})
        async with asyncio.timeout(2):
            while len(received) < 4:
                await asyncio.sleep(0.01)
        assert [m.get("msg_type", m["content"]) for m in received] == [
            "_reset",
            "_kernel_info",
            "_kernel_status",
            "new",
        ]
        await asyncio.gather(*hub.close())

    async def test_oversized_notice(self):
        hub = Hub("connection.json")
        received = []

        async def write(message):
            received.append(json.loads(message))

        subscriber = Subscriber(write, lambda: None)
        hub.subscribe(subscriber)
        hub.publish({"content": "x" * (10 * 1024 * 1024)})
        async with asyncio.timeout(2):
            while len(received) < 4:
                await asyncio.sleep(0.01)
        assert received[-1]["msg_type"] == "_notice"
        await asyncio.gather(*hub.close())

    async def test_slow_reader_does_not_block_fast_reader(self):
        hub = Hub("test.json")
        closed = asyncio.Event()
        started = asyncio.Event()
        fast_messages = []

        async def blocked_write(message):
            started.set()
            await asyncio.Event().wait()

        async def fast_write(message):
            fast_messages.append(message)

        slow = Subscriber(blocked_write, closed.set, max_messages=4)
        fast = Subscriber(fast_write, lambda: None)
        hub.subscribe(slow)
        hub.subscribe(fast)
        await started.wait()
        hub.publish({"content": "one"})
        hub.publish({"content": "two"})
        await asyncio.wait_for(closed.wait(), 1)
        async with asyncio.timeout(2):
            while len(fast_messages) < 5:
                await asyncio.sleep(0.01)
        assert slow not in hub.subscribers
        assert slow.bytes == 0
        await asyncio.gather(slow.task, *hub.close())

    async def test_byte_limit_includes_in_flight_write(self):
        started = asyncio.Event()

        async def write(message):
            started.set()
            await asyncio.Event().wait()

        subscriber = Subscriber(write, lambda: None, max_bytes=4)
        subscriber.enqueue("éé")
        await started.wait()
        subscriber.enqueue("a")
        assert subscriber.closed
        await subscriber.task


@pytest.fixture
def web_app(tmp_path):
    (tmp_path / "index.html").write_text("viewer")
    (tmp_path / "escape").symlink_to(Path(__file__).resolve())
    return make_application(Hub("connection.json"), 8765, "http://127.0.0.1:5173", tmp_path)


def test_static_and_host(web_app):
    with TestClient(web_app, base_url="http://127.0.0.1:8765") as client:
        response = client.get("/index.html")
        assert response.content == b"viewer"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert client.get("/index.html", headers={"Host": "evil.example"}).status_code == 403
        assert client.get("/escape").status_code == 403
        assert client.get("/%2e%2e/pyproject.toml").status_code == 403
        assert client.get("/missing").status_code == 404
        redirect = client.get("/", follow_redirects=False)
        assert redirect.status_code == 302
        assert redirect.headers["location"] == "http://127.0.0.1:5173"


def test_origins_and_reset(web_app):
    with TestClient(web_app, base_url="http://127.0.0.1:8765") as client:
        for headers in (
            {},
            {"Origin": "http://evil.example"},
            {"Origin": "http://127.0.0.1:5173", "Host": "evil.example"},
            {"Origin": "http://127.0.0.1:5173", "Host": "localhost:1234"},
        ):
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect("ws://127.0.0.1:8765/ws", headers=headers):
                    pass
        for origin in ("http://127.0.0.1:8765", "http://127.0.0.1:5173"):
            with client.websocket_connect(
                "ws://127.0.0.1:8765/ws", headers={"Origin": origin}
            ) as socket:
                assert socket.receive_json()["msg_type"] == "_reset"
                assert socket.receive_json()["content"] == {"connection_file": "connection.json"}
                assert socket.receive_json()["msg_type"] == "_kernel_status"
                socket.send_text("ignored command")
        assert not web_app.state.hub.subscribers


def test_cli_rejects_configuration_before_start(connection, monkeypatch, capsys):
    from jupyter_watch import cli

    called = []
    monkeypatch.setattr(cli, "run_server", lambda *args: called.append(args))
    for arguments in (["missing.json"], [str(connection), "--port", "0"]):
        monkeypatch.setattr("sys.argv", ["jupyter-watch", *arguments])
        assert cli.main() == 1
    assert not called
    assert "jupyter-watch:" in capsys.readouterr().err


def test_cli_requires_assets_except_in_development(connection, monkeypatch):
    from jupyter_watch import cli

    monkeypatch.setattr(cli, "STATIC", connection.parent / "missing-assets")
    monkeypatch.setattr("sys.argv", ["jupyter-watch", str(connection)])
    assert cli.main() == 1
    calls = []

    def serve(*args):
        calls.append(args)

    monkeypatch.setattr(cli, "run_server", serve)
    monkeypatch.setattr(
        "sys.argv", ["jupyter-watch", str(connection), "--dev-origin", "http://127.0.0.1:5173"]
    )
    assert cli.main() == 0
    assert len(calls) == 1
