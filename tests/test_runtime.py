"""Actual Uvicorn process behavior, including reload and transport limits."""

import asyncio
import json
import os
import shutil
import signal
import socket
import sys
from pathlib import Path

import httpx
import pytest
from jupyter_client import AsyncKernelManager
from server_helpers import wait_ready
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosedError, InvalidStatus

import jupyter_watch


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def copy_source(tmp_path):
    source = tmp_path / "jupyter_watch"
    shutil.copytree(
        Path(jupyter_watch.__file__).parent,
        source,
        ignore=shutil.ignore_patterns("static", "__pycache__"),
    )
    return source


async def start_server(connection, port, source, *options):
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "from jupyter_watch.cli import main; raise SystemExit(main())",
        str(connection),
        "--port",
        str(port),
        "--dev-origin",
        "http://127.0.0.1:5173",
        *options,
        cwd=source.parent,
        env={**os.environ, "PYTHONPATH": str(source.parent)},
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )


async def stop_process(process):
    if process and process.returncode is None:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 15)
        except TimeoutError:
            process.kill()
            await process.wait()


@pytest.mark.parametrize("shutdown_signal", [signal.SIGINT, signal.SIGTERM])
def test_reload_and_kernel_survival(tmp_path, shutdown_signal):
    async def scenario():
        source = copy_source(tmp_path)
        pid_file = tmp_path / "worker.pid"
        kernel_source = source / "kernel.py"
        kernel_source.write_text(
            kernel_source.read_text().replace(
                "    def start(self):",
                f"    def start(self):\n        import os\n        Path({str(pid_file)!r}).write_text(str(os.getpid()))",
            )
        )
        manager = AsyncKernelManager(connection_file=str(tmp_path / "connection.json"))
        await manager.start_kernel()
        client = manager.client()
        client.start_channels()
        process = None
        worker_pids = []
        try:
            await client.wait_for_ready(timeout=20)
            port = free_port()
            origin = f"http://127.0.0.1:{port}"
            process = await start_server(manager.connection_file, port, source, "--reload")
            await wait_ready(process, origin)
            worker_pids.append(int(pid_file.read_text()))
            # Let the supervisor enter its first watch iteration. Non-Python edits
            # must leave the serving worker alone.
            (source / "settings.json").write_text("{}")
            (source / "static").mkdir()
            (source / "static" / "app.js").write_text("// frontend change")
            await asyncio.sleep(1)
            assert int(pid_file.read_text()) == worker_pids[0]
            async with connect(f"ws://127.0.0.1:{port}/ws", origin=origin, proxy=None) as ws:
                assert json.loads(await ws.recv())["msg_type"] == "_reset"
                # Trigger a real Python edit in the isolated source tree.
                kernel_source.write_text(kernel_source.read_text() + "\n# reload test\n")
                async with asyncio.timeout(15):
                    while int(pid_file.read_text()) == worker_pids[0]:
                        await asyncio.sleep(0.1)
                    await ws.wait_closed()
            worker_pids.append(int(pid_file.read_text()))
            assert worker_pids[0] != worker_pids[1]
            with pytest.raises(ProcessLookupError):
                os.kill(worker_pids[0], 0)
            await wait_ready(process, origin)
            assert await manager.is_alive()
            async with connect(f"ws://127.0.0.1:{port}/ws", origin=origin, proxy=None) as ws:
                assert json.loads(await ws.recv())["msg_type"] == "_reset"
                async with asyncio.timeout(15):
                    while True:
                        message = json.loads(await ws.recv())
                        if (
                            message.get("msg_type") == "_kernel_status"
                            and message["content"]["alive"]
                        ):
                            break
                    client.execute("print('after-reload-marker')")
                    while True:
                        message = json.loads(await ws.recv())
                        if "after-reload-marker" in message.get("content", {}).get("text", ""):
                            break
            process.send_signal(shutdown_signal)
            await asyncio.wait_for(process.wait(), 15)
            assert process.returncode == 0, (await process.stderr.read()).decode()
            for pid in worker_pids:
                with pytest.raises(ProcessLookupError):
                    os.kill(pid, 0)
            assert await manager.is_alive()
        except BaseException:
            await stop_process(process)
            if process:
                print((await process.stderr.read()).decode())
            raise
        finally:
            await stop_process(process)
            client.stop_channels()
            await manager.shutdown_kernel(now=True)

    asyncio.run(scenario())


def test_transport_security_and_size_limit(tmp_path):
    async def scenario():
        source = copy_source(tmp_path)
        manager = AsyncKernelManager(connection_file=str(tmp_path / "connection.json"))
        await manager.start_kernel()
        port = free_port()
        origin = f"http://127.0.0.1:{port}"
        process = await start_server(manager.connection_file, port, source)
        try:
            await wait_ready(process, origin)
            async with httpx.AsyncClient(trust_env=False) as http:
                assert (await http.get(origin + "/missing")).status_code == 404
                assert (await http.get(origin, headers={"Host": "evil.example"})).status_code == 403
            for bad_origin in (None, "http://evil.example"):
                with pytest.raises(InvalidStatus) as error:
                    await connect(f"ws://127.0.0.1:{port}/ws", origin=bad_origin, proxy=None)
                assert error.value.response.status_code == 403
            async with connect(f"ws://127.0.0.1:{port}/ws", origin=origin, proxy=None) as ws:
                for _ in range(3):
                    await ws.recv()
                await ws.send("x" * 1025)
                with pytest.raises(ConnectionClosedError) as error:
                    async with asyncio.timeout(5):
                        while True:
                            await ws.recv()
                assert error.value.rcvd.code == 1009
        finally:
            await stop_process(process)
            await manager.shutdown_kernel(now=True)

    asyncio.run(scenario())


@pytest.mark.parametrize("method", ["start", "output", "heartbeat"])
def test_observer_failure_exits(tmp_path, method):
    async def scenario():
        source = copy_source(tmp_path)
        kernel_source = source / "kernel.py"
        declaration = f"    {'async ' if method != 'start' else ''}def {method}(self):"
        kernel_source.write_text(
            kernel_source.read_text().replace(
                declaration,
                declaration + '\n        raise RuntimeError("injected observer failure")',
            )
        )
        manager = AsyncKernelManager(connection_file=str(tmp_path / "connection.json"))
        await manager.start_kernel()
        process = await start_server(manager.connection_file, free_port(), source)
        try:
            await asyncio.wait_for(process.wait(), 10)
            assert process.returncode != 0
            assert "injected observer failure" in (await process.stderr.read()).decode()
            assert await manager.is_alive()
        finally:
            await stop_process(process)
            await manager.shutdown_kernel(now=True)

    asyncio.run(scenario())


def test_slow_transport_is_evicted_without_blocking_fast_viewer(tmp_path):
    async def scenario():
        source = copy_source(tmp_path)
        trigger = tmp_path / "publish"
        remaining = tmp_path / "remaining"
        server_source = source / "server.py"
        # Exercise actual network backpressure with a controlled publisher, rather
        # than depending on the kernel's IOPub buffering or execution timing.
        server_source.write_text(
            server_source.read_text().replace(
                "        failure = []",
                f"""        async def flood():
            while not Path({str(trigger)!r}).exists():
                await asyncio.sleep(0.01)
            for index in range(80):
                hub.publish({{"content": {{"text": "x" * (512 * 1024), "index": index}}}})
                await asyncio.sleep(0.01)
            hub.publish({{"msg_type": "done", "content": {{}}}})
            Path({str(remaining)!r}).write_text(str(len(hub.subscribers)))
            await asyncio.Event().wait()

        observer.output = flood
        failure = []""",
            )
        )
        manager = AsyncKernelManager(connection_file=str(tmp_path / "connection.json"))
        await manager.start_kernel()
        port = free_port()
        origin = f"http://127.0.0.1:{port}"
        process = await start_server(manager.connection_file, port, source)
        slow = None
        try:
            await wait_ready(process, origin)
            slow = await connect(
                f"ws://127.0.0.1:{port}/ws",
                origin=origin,
                proxy=None,
                compression=None,
                max_queue=1,
            )
            for _ in range(3):
                await slow.recv()
            slow.transport.pause_reading()
            async with connect(
                f"ws://127.0.0.1:{port}/ws", origin=origin, proxy=None, compression=None
            ) as fast:
                trigger.touch()
                indices = []
                async with asyncio.timeout(15):
                    while True:
                        message = json.loads(await fast.recv())
                        if message.get("msg_type") == "done":
                            break
                        if "index" in message.get("content", {}):
                            indices.append(message["content"]["index"])
                assert indices == list(range(80))
                assert remaining.read_text() == "1"
                slow.transport.resume_reading()
                with pytest.raises(ConnectionClosedError):
                    async with asyncio.timeout(5):
                        while True:
                            await slow.recv()
        finally:
            if slow:
                slow.transport.resume_reading()
                await slow.close()
            await stop_process(process)
            await manager.shutdown_kernel(now=True)

    asyncio.run(scenario())
