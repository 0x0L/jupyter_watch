import asyncio
import websockets
import json
import sys

import jupyter_client
from jupyter_client.asynchronous.client import AsyncKernelClient

CLIENTS = set()

cf = jupyter_client.find_connection_file(sys.argv[1])
KERNEL = AsyncKernelClient(connection_file=cf)
KERNEL.load_connection_file()
KERNEL.start_channels()


async def relay(queue, websocket):
    while True:
        # Implement custom logic based on queue.qsize() and
        # websocket.transport.get_write_buffer_size() here.
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


async def broadcast_messages():
    while True:
        msg = await KERNEL.get_iopub_msg()
        msg = json.dumps({k: msg[k] for k in ("msg_type", "content")})
        broadcast(msg)


async def main():
    await KERNEL.wait_for_ready()
    async with websockets.serve(handler, "localhost", 8765):
        await broadcast_messages()  # runs forever


if __name__ == "__main__":
    asyncio.run(main())
