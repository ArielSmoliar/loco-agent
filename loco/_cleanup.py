"""Finish resource cleanup before propagating repeated caller cancellation."""

import asyncio
from collections.abc import Coroutine
from typing import Any


async def finish_cleanup(work: Coroutine[Any, Any, None]) -> None:
    cleanup = asyncio.create_task(work)
    cancelled = False
    while not cleanup.done():
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            cancelled = True
    cleanup.result()
    if cancelled:
        raise asyncio.CancelledError
