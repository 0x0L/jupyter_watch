"""Integration with signed real kernels through the actual HTTP/WebSocket server."""

import asyncio
import base64
import json
import os
import signal
import socket
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from jupyter_client import AsyncKernelManager
from tornado.httpclient import HTTPRequest
from tornado.websocket import websocket_connect


class LiveKernelTests(unittest.IsolatedAsyncioTestCase):
    async def test_signed_output_heartbeat_and_shutdown(self):
        with TemporaryDirectory() as directory:
            manager = AsyncKernelManager(connection_file=str(Path(directory) / "test.json"))
            manager.session.signature_scheme = "hmac-sha512"
            await manager.start_kernel()
            client = manager.client()
            client.start_channels()
            process = ws = None
            try:
                await client.wait_for_ready(timeout=20)
                with socket.socket() as free:
                    free.bind(("127.0.0.1", 0))
                    port = free.getsockname()[1]
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    "from jupyter_watch.cli import main; raise SystemExit(main())",
                    manager.connection_file,
                    "--port",
                    str(port),
                    "--dev-origin",
                    "http://127.0.0.1:5173",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                line = await asyncio.wait_for(process.stdout.readline(), 10)
                assert b"Serving" in line
                ws = await websocket_connect(
                    HTTPRequest(
                        f"ws://127.0.0.1:{port}/ws",
                        headers={"Origin": f"http://127.0.0.1:{port}"},
                    )
                )

                async def read_until(predicate):
                    async with asyncio.timeout(15):
                        while True:
                            message = await ws.read_message()
                            assert message is not None
                            message = json.loads(message)
                            if predicate(message):
                                return message

                await read_until(
                    lambda m: m.get("msg_type") == "_kernel_status" and m["content"]["alive"]
                )
                request = client.execute("print('watch-ready')")
                observed = await read_until(
                    lambda m: m.get("header", {}).get("msg_type") == "stream"
                )
                assert observed["parent_header"]["msg_id"] == request
                request = client.execute(
                    "get_ipython().kernel.session.send(get_ipython().kernel.iopub_socket, "
                    "'display_data', content={'data': {'text/plain': 'binary'}, 'metadata': {}}, "
                    "parent=get_ipython().kernel.get_parent(), metadata={'test': True}, "
                    "buffers=[b'\\x00\\xff'])"
                )
                observed = await read_until(
                    lambda m: m.get("header", {}).get("msg_type") == "display_data"
                )
                assert observed["parent_header"]["msg_id"] == request
                assert observed["metadata"]["test"]
                assert base64.b64decode(observed["buffers"][0]) == b"\x00\xff"
                assert "header" in observed and "content" in observed
                # Suspend the kernel: no IOPub traffic, heartbeat must still detect loss.
                pid = manager.provisioner.pid
                os.kill(pid, signal.SIGSTOP)
                try:
                    await read_until(
                        lambda m: (
                            m.get("msg_type") == "_kernel_status" and not m["content"]["alive"]
                        )
                    )
                finally:
                    os.kill(pid, signal.SIGCONT)
                await read_until(
                    lambda m: m.get("msg_type") == "_kernel_status" and m["content"]["alive"]
                )
                process.terminate()
                await asyncio.wait_for(process.wait(), 10)
                assert process.returncode == 0, (await process.stderr.read()).decode()
                assert await manager.is_alive()
                client.execute("print('still-running')")
                reply = await client.get_shell_msg(timeout=10)
                assert reply["content"]["status"] == "ok"
            finally:
                if ws:
                    ws.close()
                if process and process.returncode is None:
                    process.kill()
                    await process.wait()
                client.stop_channels()
                await manager.shutdown_kernel(now=True)
