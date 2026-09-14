"""Bounded, ordered delivery to live subscribers."""

import asyncio

MAX_MESSAGES = 2000
MAX_BYTES = 10 * 1024 * 1024


class Subscriber:
    """One in-flight write, counted against the limit until it completes."""

    def __init__(self, write, close, max_messages=MAX_MESSAGES + 3, max_bytes=MAX_BYTES + 65536):
        self.write = write
        self.close = close
        self.max_messages = max_messages
        self.max_bytes = max_bytes
        self.queue = asyncio.Queue()
        self.bytes = 0
        self.count = 0
        self.closed = False
        self.task = asyncio.create_task(self.send())

    def enqueue(self, message):
        if self.closed:
            return
        size = len(message.encode("utf-8"))
        if self.count + 1 > self.max_messages or self.bytes + size > self.max_bytes:
            self.stop()
            return
        self.count += 1
        self.bytes += size
        self.queue.put_nowait((message, size))

    async def send(self):
        try:
            while True:
                message, size = await self.queue.get()
                await asyncio.wait_for(self.write(message), timeout=10)
                self.bytes -= size
                self.count -= 1
        except (Exception, asyncio.CancelledError):
            self.stop()

    def stop(self):
        if self.closed:
            return
        self.closed = True
        self.task.cancel()
        while not self.queue.empty():
            self.queue.get_nowait()
        self.bytes = self.count = 0
        self.close()
