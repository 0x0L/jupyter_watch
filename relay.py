import asyncio
import json
import sys

import jupyter_client
from jupyter_client.asynchronous.client import AsyncKernelClient
import websockets

PORT = 8765
CLIENTS = set()


async def relay(queue, websocket):
    while True:
        message = await queue.get()
        await websocket.send(message)


async def handler(websocket):
    queue = asyncio.Queue()
    relay_task = asyncio.create_task(relay(queue, websocket))
    CLIENTS.add(queue)
    try:
        await websocket.wait_closed()
    finally:
        CLIENTS.remove(queue)
        relay_task.cancel()


def broadcast(message):
    for queue in CLIENTS:
        queue.put_nowait(message)


async def broadcast_messages(kernel):
    while True:
        msg = await kernel.get_iopub_msg()
        msg = json.dumps(
            {"msg_type": msg["header"]["msg_type"], "content": msg["content"]}
        )
        broadcast(msg)


async def main():
    cf = jupyter_client.find_connection_file(sys.argv[1])
    kernel = AsyncKernelClient(connection_file=cf)
    kernel.load_connection_file()
    kernel.start_channels()
    await kernel.wait_for_ready()

    async with websockets.serve(handler, "localhost", PORT):
        await broadcast_messages(kernel)  # runs forever


if __name__ == "__main__":
    asyncio.run(main())
