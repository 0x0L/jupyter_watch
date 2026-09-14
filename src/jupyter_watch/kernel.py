"""Observe only IOPub and heartbeat; never own or execute on the kernel."""

import asyncio
import base64
import json
from pathlib import Path
from queue import Empty

from jupyter_client import AsyncKernelClient
from jupyter_client.jsonutil import json_default
from jupyter_client.session import Session


def validate_connection(argument):
    path = Path(argument).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"Connection file does not exist: {path}")
    info = json.loads(path.read_text())
    if not isinstance(info, dict):
        raise ValueError("Connection settings must be a JSON object")
    if info.get("transport") not in ("tcp", "ipc"):
        raise ValueError("Connection transport must be tcp or ipc")
    if not isinstance(info.get("ip"), str) or not info["ip"].strip():
        raise ValueError("Connection ip must be a nonempty address or IPC path")
    if any(c in info["ip"] for c in ("\x00", "://")):
        raise ValueError("Invalid connection address")
    for field in ("shell_port", "iopub_port", "stdin_port", "control_port", "hb_port"):
        port = info.get(field)
        if type(port) is not int or port < 1 or (info["transport"] == "tcp" and port > 65535):
            raise ValueError(f"Invalid connection setting: {field}")
    if not isinstance(info.get("key"), str):
        raise ValueError("Connection key must be a string")
    if not isinstance(info.get("signature_scheme"), str):
        raise ValueError("Connection signature_scheme must be a string")
    Session(signature_scheme=info["signature_scheme"])
    return path, info


def load_client(argument):
    path, info = validate_connection(argument)
    client = AsyncKernelClient(connection_file=str(path))
    # Jupyter validates the signature algorithm and applies its connection settings.
    client.load_connection_info(info)
    return path, client


def encode(message):
    return json.dumps(message, default=json_default, ensure_ascii=False)


class KernelObserver:
    def __init__(self, client, publish):
        self.client = client
        self.publish = publish

    async def output(self):
        while True:
            try:
                message = await self.client.get_iopub_msg(timeout=1)
            except Empty:
                continue
            message["buffers"] = [
                base64.b64encode(bytes(buffer)).decode("ascii")
                for buffer in message.get("buffers", [])
            ]
            self.publish(message)
            # Yield even under continuous output so status and HTTP remain responsive.
            await asyncio.sleep(0)

    async def heartbeat(self):
        previous = None
        while True:
            alive = self.client.hb_channel.is_beating()
            if alive != previous:
                self.publish({"msg_type": "_kernel_status", "content": {"alive": alive}})
                previous = alive
            await asyncio.sleep(0.25)

    def start(self):
        self.client.start_channels(shell=False, iopub=True, stdin=False, hb=True, control=False)

    def stop(self):
        # stop_channels() lazily creates unused channels; close only the channels we opened.
        if self.client._iopub_channel is not None:
            self.client.iopub_channel.stop()
        if self.client._hb_channel is not None:
            self.client.hb_channel.stop()
        if self.client._created_context and not self.client.context.closed:
            self.client.context.destroy(linger=100)
