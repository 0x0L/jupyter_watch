"""Run after uv build: verify release archives and the installed wheel without Node."""

import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

from jupyter_client import AsyncKernelManager
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.websocket import websocket_connect

ROOT = Path(__file__).resolve().parents[1]


async def smoke():
    wheel = ROOT / "dist/jupyter_watch-0.1.0-py3-none-any.whl"
    source = ROOT / "dist/jupyter_watch-0.1.0.tar.gz"
    with zipfile.ZipFile(wheel) as archive:
        wheel_assets = {
            n.removeprefix("jupyter_watch/static/"): archive.read(n)
            for n in archive.namelist()
            if n.startswith("jupyter_watch/static/")
        }
    with tarfile.open(source) as archive:
        source_assets = {
            n.split("/src/jupyter_watch/static/", 1)[1]: archive.extractfile(n).read()
            for n in archive.getnames()
            if "/src/jupyter_watch/static/" in n and archive.getmember(n).isfile()
        }
    assert wheel_assets == source_assets
    assert "index.html" in wheel_assets and any(n.endswith(".js") for n in wheel_assets)
    uv = shutil.which("uv")
    with tempfile.TemporaryDirectory(prefix="jupyter-watch-package-") as directory:
        work = Path(directory)
        envdir = work / "env"
        subprocess.run([uv, "venv", str(envdir), "--python", "3.12"], check=True)
        subprocess.run(
            [uv, "pip", "install", "--python", str(envdir / "bin/python"), str(wheel)], check=True
        )
        # Rebuild from the sdist without Node, then verify the missing-assets build error.
        extracted = work / "source"
        with tarfile.open(source) as archive:
            archive.extractall(extracted, filter="data")
        project = next(extracted.iterdir())
        env = {**os.environ, "PATH": str(envdir / "bin")}
        env.pop("PYTHONPATH", None)
        assert shutil.which("node", path=env["PATH"]) is None
        subprocess.run(
            [uv, "build", "--wheel", str(project), "--out-dir", str(work / "rebuilt")],
            check=True,
            env=env,
            cwd=work,
        )
        shutil.rmtree(project / "src/jupyter_watch/static")
        missing = subprocess.run(
            [uv, "build", "--wheel", str(project)],
            env=env,
            cwd=work,
            capture_output=True,
            text=True,
        )
        assert missing.returncode != 0 and "Frontend assets missing" in missing.stderr
        command = str(envdir / "bin/jupyter-watch")
        invalid = subprocess.run(
            [command, "missing.json"], cwd=work, env=env, capture_output=True, text=True
        )
        assert invalid.returncode == 1 and "does not exist" in invalid.stderr
        manager = AsyncKernelManager(connection_file=str(work / "connection.json"))
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
                command,
                manager.connection_file,
                "--port",
                str(port),
                cwd=work,
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            assert b"Serving" in await asyncio.wait_for(process.stdout.readline(), 10)
            origin = f"http://127.0.0.1:{port}"
            http = AsyncHTTPClient()
            page = await http.fetch(origin)
            assert page.body == wheel_assets["index.html"]
            assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', page.body.decode())
            assert assets
            for asset in assets:
                assert (await http.fetch(origin + asset)).body == wheel_assets[asset.lstrip("/")]
            ws = await websocket_connect(
                HTTPRequest(
                    f"ws://127.0.0.1:{port}/ws",
                    headers={"Origin": origin},
                )
            )
            assert json.loads(await ws.read_message())["msg_type"] == "_reset"
            async with asyncio.timeout(15):
                while True:
                    message = json.loads(await ws.read_message())
                    if message.get("msg_type") == "_kernel_status" and message["content"]["alive"]:
                        break
                client.execute("print('installed-wheel-marker')")
                while True:
                    message = json.loads(await ws.read_message())
                    if "installed-wheel-marker" in message.get("content", {}).get("text", ""):
                        break
            process.terminate()
            await asyncio.wait_for(process.wait(), 10)
            assert process.returncode == 0, (await process.stderr.read()).decode()
            assert await manager.is_alive()
        finally:
            if ws:
                ws.close()
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            client.stop_channels()
            await manager.shutdown_kernel(now=True)
    print(
        "Package smoke passed: wheel runtime without Node, matching sdist assets, sdist rebuild, build guard"
    )


if __name__ == "__main__":
    asyncio.run(smoke())
