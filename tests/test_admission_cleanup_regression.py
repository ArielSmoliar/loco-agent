"""Cancellation during admission cleanup must not strand scored waiters."""

import asyncio

from loco import Agent, AsyncLOCOScheduler, SharedResource, Task


async def wait_until(predicate):
    async def poll():
        while not predicate():
            await asyncio.sleep(0)

    await asyncio.wait_for(poll(), timeout=1)


async def test_repeated_cancellation_finishes_raced_grant_wakeup():
    resource = SharedResource("provider")
    scheduler = AsyncLOCOScheduler(
        [Agent(name, tasks=[Task(weight=1)]) for name in ("cancelled", "next")],
        resource,
    )
    effects = []

    async def execute(agent_id):
        async with scheduler.acquire(agent_id):
            effects.append(agent_id)

    # An external holder lets the test force grant-before-cancellation without
    # running another scheduler release that could independently wake "next".
    assert await resource.try_acquire("holder")
    cancelled = asyncio.create_task(execute("cancelled"))
    next_call = asyncio.create_task(execute("next"))
    lock_held = False
    try:
        await wait_until(lambda: resource.waiter_count == 2)
        # Model contention on the scheduler lock during cancellation cleanup.
        await scheduler._lock.acquire()
        lock_held = True
        await resource.release("holder")
        await resource.grant("cancelled")
        # No yield between grant and cancellation: the caller has not consumed
        # its grant, so its cancellation cleanup must return that slot.
        cancelled.cancel()
        await wait_until(
            lambda: resource.holder_count == 0 and bool(scheduler._lock._waiters)
        )
        cancelled.cancel()
        await asyncio.sleep(0)  # Deliver the second cancellation under contention.
        scheduler._lock.release()
        lock_held = False

        result = await asyncio.wait_for(
            asyncio.gather(cancelled, return_exceptions=True), timeout=1
        )
        assert isinstance(result[0], asyncio.CancelledError)
        # A free slot alone is insufficient: cleanup must actually wake the
        # surviving scored waiter, without another release to rescue it.
        await asyncio.wait_for(asyncio.shield(next_call), timeout=1)
        assert effects == ["next"]
        assert resource.holder_count == 0
        assert resource.waiter_count == 0
        assert not scheduler._task_claims
        assert not resource._granted_waiters
    finally:
        if lock_held:
            scheduler._lock.release()
        for call in (cancelled, next_call):
            if not call.done():
                call.cancel()
        await asyncio.wait_for(
            asyncio.gather(cancelled, next_call, return_exceptions=True), timeout=1
        )
        await resource.release("holder")
