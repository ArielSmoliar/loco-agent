"""Per-invocation task/handle ownership shared by callback adapters."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Hashable

from loco.agent import Agent
from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler
from loco.task import Task


@dataclass
class _Invocation:
    task: Task
    starter: asyncio.Task
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    agent: Agent | None = None
    handle: AcquireHandle | None = None
    closing: asyncio.Task | None = None


class CallbackCalls:
    """One active handle per (agent, invocation ID); never overwrite a pending start.

    None is a legacy sequential-only identifier. Identified and unidentified
    calls for one agent may not overlap. IDs must match at start and completion;
    unknown/duplicate completions are no-ops and never consume a different call.
    """

    def __init__(self, scheduler: AsyncLOCOScheduler):
        self.scheduler = scheduler
        self._calls: dict[tuple[str, Hashable | None], _Invocation] = {}

    async def start(self, agent_id: str, invocation_id: Hashable | None, task: Task) -> None:
        key = (agent_id, invocation_id)
        hash(key)  # fail before submission for invalid identifiers
        if key in self._calls:
            raise RuntimeError("Invocation already active or waiting; use a distinct invocation ID")
        if any(
            aid == agent_id and (iid is None or invocation_id is None) for aid, iid in self._calls
        ):
            raise RuntimeError("Overlapping calls require distinct invocation IDs")
        call = _Invocation(task, asyncio.current_task())
        self._calls[key] = call  # claim identity before the first suspension
        try:
            await self.scheduler.submit_task(agent_id, task)
            call.agent = self.scheduler.get_agent(agent_id)
            call.handle = await self.scheduler.acquire_start(agent_id, task=task)
        except BaseException:
            if call.agent is not None:
                call.agent.remove_task(task)
            if call.closing is None and self._calls.get(key) is call:
                del self._calls[key]
            raise
        finally:
            call.ready.set()

    async def finish(self, agent_id: str, invocation_id: Hashable | None) -> None:
        key = (agent_id, invocation_id)
        call = self._calls.get(key)
        if call is None:
            if invocation_id is None and any(aid == agent_id for aid, _ in self._calls):
                raise ValueError("Completion requires the invocation ID used at start")
            return
        if call.closing is None:
            call.closing = asyncio.create_task(self._finish(key, call))
        # Cleanup survives cancellation of an end/error callback, including
        # repeated cancellation while the scheduler is releasing its slot.
        cancelled = False
        while not call.closing.done():
            try:
                await asyncio.shield(call.closing)
            except asyncio.CancelledError:
                cancelled = True
        call.closing.result()
        if cancelled:
            raise asyncio.CancelledError

    async def _finish(self, key, call):
        try:
            if not call.ready.is_set():
                call.starter.cancel()
                await call.ready.wait()
            if call.handle is not None:
                # The exact task is removed even if settlement/hook code raises.
                call.agent.remove_task(call.task, completed=True)
                await self.scheduler.release_handle(call.handle)
        finally:
            if self._calls.get(key) is call:
                del self._calls[key]
