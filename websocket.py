#!/usr/bin/env python
import asyncio
import json
import sys

import jupyter_client
from jupyter_client.asynchronous.client import AsyncKernelClient
from websockets.server import serve


async def echo(websocket):
    while True:
        msg = await km.get_iopub_msg()
        await websocket.send(json.dumps({k: msg[k] for k in ("msg_type", "content")}))


async def main():
    await km.wait_for_ready()
    async with serve(echo, "localhost", 8765):
        await asyncio.Future()  # run forever


cf = jupyter_client.find_connection_file(sys.argv[1])
km = AsyncKernelClient(connection_file=cf)
km.load_connection_file()
km.start_channels()

asyncio.run(main())
