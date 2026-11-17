# Budget reservations and settlement

`AsyncLOCOScheduler` reserves a priced task's estimated cost before returning an
acquisition. In reject mode, admission requires:

```text
settled spend + outstanding reservations + new estimate <= per-agent limit

acquire slot -> reserve policies -> return handle -> execute -> settle -> free slot
                      |
                later check/hook fails -> cancel reservations -> free slot
```

Check-and-reserve and settlement use the same process-local lock on `BudgetPolicy`.
Sharing one policy object across schedulers coordinates their commitments. Separate
policy objects, separate processes, and separate hosts do not share a ledger.
This is not a distributed transaction, persistent ledger, or provider billing cap.

## Existing callers

Existing `async with scheduler.acquire(agent_id):` and `release_handle(handle)`
usage continues to work. Settlement defaults to the **original reserved estimate**,
even if task weight changes during execution. `spent()` remains settled spend;
`reserved()` reports outstanding commitments; `remaining()` subtracts both.
`summary()` adds a `reserved` field. Scheduler metrics still attribute estimated
task weights; `budget.spent()` is the settled budget ledger, not token telemetry.

Task submission and dequeueing remain caller/adapter responsibilities. Each
acquisition claims the next unclaimed queued task when requested, then reserves
its price at admission. This keeps a waiting call from borrowing another call's
price after a rejection. Concurrent callers must still dequeue the correct task;
the scheduler does not infer which application action belongs to a task. Pair
submission and acquisition in the same order. This change does not redesign
adapter task queues.

## Reconcile a known charge

Charges must use **the same units as the budget and task estimate**. SDK token
counts are not automatically converted to currency or normalized task weights.

```python
from loco import AsyncLOCOScheduler, BudgetManager, SharedResource, Task

budget = BudgetManager(default_limit=10)
scheduler = AsyncLOCOScheduler([], SharedResource("provider", capacity=4), budget=budget)
await scheduler.submit_task("research", Task(weight=5))

async with scheduler.acquire("research") as handle:
    scheduler.get_agent("research").serve_oldest_task()
    result = await call_provider()  # application's provider function
    handle.set_actual_cost(result.verified_charge_in_budget_units)
```

For split callbacks, release in a `finally` block:

```python
handle = await scheduler.acquire_start("research")
actual_cost = None
try:
    scheduler.get_agent("research").serve_oldest_task()
    result = await call_provider()
    actual_cost = result.verified_charge_in_budget_units
finally:
    await scheduler.release_handle(handle, actual_cost=actual_cost)
```

Known zero cost is accepted. Invalid negative, non-finite, boolean, or nonnumeric
charges are rejected before consuming an explicit release handle; correct the
value and release it. A validated charge can also be set on the context handle
before exit. Releasing twice never charges twice. Handles cannot be released by
another scheduler.

An actual charge above its reservation **is recorded in full**. It may exceed the
limit; later admissions see that settled charge and are rejected. No controller
can retroactively prevent a charge already incurred. A strict real-money ceiling
requires safe upper-bound estimates, bounded provider calls, and billing in
consistent units. Accurate settlement improves future decisions; it does not
turn an underestimate into a guarantee.

## Failure and cancellation

- A policy rejection or admission-hook failure cancels prior reservations and
  frees the slot. Rejected tasks remain in the caller's queue until removed.
- Cancelling or timing out before admission does not create a budget reservation.
- Once admitted, failure or cancellation settles the original estimate unless a
  verified actual charge was supplied. This removes the reservation **without
  silently refunding potentially billable work**. Use zero only when known unbilled.
- Completion-policy and lifecycle-hook errors cannot skip settlement of other
  policies or leave the resource held. Resource cleanup completes under cancellation.
- Policies are snapshotted at admission; removing one while a call runs does not
  discard its settlement obligation. Existing stateless policy check/record hooks
  continue through the new reserve/settle/cancel lifecycle defaults.
- `reset()` / `reset_all()` reject resets while affected reservations exist, including
  zero-cost reservations. Lowering a limit does not revoke work already admitted.

Direct budget users can call `reserve(agent_id, cost)`, `settle(token, actual_cost)`,
and `cancel(token)`; settlement and cancellation are idempotent. `check()` remains
an advisory read, not an atomic authorization. Direct `record_spend()` records an
external charge; it does not replace reservation-based admission.

`alert` and `downgrade` modes remain intentionally permissive. Empty task queues
still take the legacy taskless acquisition path and are not priced or budgeted.
Calls outside LOCO remain outside enforcement. These limitations, multi-tenant
scheduling, and distributed enforcement are not resolved by this change.

## Policy decisions and shutdown

`Policy.check()` returns `True` for permission, `False` for denial, or raises
`PolicyViolationError` with a reason. A non-boolean return raises `TypeError`.
Warnings must be recorded separately and return `True`. Budget `alert` and
`downgrade` modes follow this rule; inspect `alerts` to detect an overage.
Custom reservation overrides must enforce this contract themselves.

Shutdown rejects new acquisitions and cancels every queued waiter, including
multiple callers for the same agent. A cancellation wakeup never grants a
resource slot. Waiting callers receive `asyncio.CancelledError`; the shutdown
report counts waiting calls, not distinct agent IDs. Existing holders may finish
and settle their commitments. A shutdown timeout does not terminate those actions.
