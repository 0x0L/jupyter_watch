"""Readiness checks shared by subprocess integration and packaging tests."""

import asyncio

import httpx


async def wait_ready(process, origin):
    async with asyncio.timeout(15), httpx.AsyncClient(trust_env=False) as client:
        while True:
            if process.returncode is not None:
                raise AssertionError(f"Server exited: {(await process.stderr.read()).decode()}")
            try:
                response = await client.get(origin)
                if response.status_code in (200, 302):
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(0.05)
