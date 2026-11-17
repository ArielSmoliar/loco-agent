# Resource waiting and cleanup

Tenant and multi-resource APIs now use `SharedResource.acquire_fifo()`. Queueing
and grants update capacity under the resource lock. A grant reserves its slot
before waking the caller. A cancellation that races with a grant returns that
exact call's slot and wakes the next waiter.

On normal completion, execution error, timeout, or cancellation, resource cleanup
finishes before cancellation is propagated. Multiple calls with the same agent ID
have distinct waiter events; cancelling one does not remove another caller.
`grant()` also checks available capacity, so a raced explicit grant cannot overfill.

## Scheduling policy

FIFO callers queue by request arrival, including repeated agent IDs. The ordinary
AsyncLOCOScheduler still selects its scored waiters. FIFO acquisition/release
also wakes scored callers sharing the resource so the two APIs cannot strand
one another's waiters. A mixed pool therefore does not promise LOCO score order
on every release; use one admission policy when a uniform order is required.

Tenant FIFO is not reserved per-tenant capacity or weighted fairness. A backlog
can delay another tenant, but later tenant requests cannot overtake an already
queued tenant request. `optimize_for` is retained by MultiTenantScheduler for
compatibility; it does not select a tenant scheduling algorithm.

## Multiple resources

`ResourcePool.acquire_multiple()` resolves all resource names first, deduplicates
and sorts them, then acquires each through the FIFO path. Resources are released
in reverse order. This ordering avoids circular wait between pool acquisitions.

If acquisition is cancelled while waiting on the second resource, the first is
released. If execution fails or cleanup itself is repeatedly cancelled, all
acquired resources are still released. No action runs until every requested
resource is held. Unknown names fail before acquiring any slot.

## Tenant accounting and task ownership

The tenant cost ceiling is checked at grant even for preloaded agent queues. The
task's current validated weight is charged synchronously before execution, so
another call sees that charge immediately. `tenant_cost()` includes running work.
This differs from the core BudgetPolicy's reserve/settle API: tenant accounting
charges task weights at admission and does not reconcile actual provider bills.

Every tenant acquisition needs its own queued task. Executed attempts are removed
and counted on exit, including execution failures and cancellation. Rejections
and queued timeouts leave tasks queued for an explicit retry or removal. See
[Multi-Tenant Isolation](concepts/multi-tenant.md) for migration details.

## Validation

The seven original audit cases produced four failures and three passing controls
before the fix. All seven now pass in 20/20 repetitions. The required suite adds
26 regression cases covering those scenarios plus concurrent tenant accounting,
exact task claims, timeout isolation, cancellation before/after grant, repeated
cancellation, partial acquisition, reverse resource ordering, and mixed FIFO/scored
release. Full combined verification: **627 tests passed**, Ruff passed, Python 3.13.
These are local async tests; distributed coordination and provider billing are
outside this change.
