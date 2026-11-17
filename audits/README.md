# Current status

All findings from this bounded audit now have fixes and required regression
coverage on `codex/tenant-resource-lifecycle` (building on the enforcement and
callback lifecycle fixes). This is a local branch, not a published release.

- Task/callback cases: `tests/test_task_callback_lifecycle.py`.
- Tenant/resource-pool cases: `tests/test_tenant_resource_regressions.py`.
- Full required suite after combined review: 627 passed on Python 3.13; Ruff passed.
- Original seven tenant/resource-pool cases: all passed in 20 repetitions each.
  See `resolved-results.json` and `resolved-results.log`.

The explicit audit file re-exports the seven promoted cases, so the audit runner
and CI cannot silently diverge. `results.json`, `first-run.log`, and
`remaining-results.*` are historical pre-fix evidence (log trailing whitespace
has been normalized). Use
`python audits/run_boundary_audit.py --output audits/resolved-results.json`
for a fresh run.

See `docs/resource-lifecycle.md` and `docs/task-lifecycle.md` for behavior and
compatibility changes. The report below preserves the original investigation;
its failure counts and next steps describe that earlier revision.

---

# LOCO public-API boundary audit

Investigated 2026-11-17 against `5005be9`, which already contains the four fixes
from the previous investigation. Library code is unchanged. This audit is on
`codex/enforcement-boundary-audit`, separate from `codex/policy-concurrency-fixes`.

Result: **23 scenarios repeated 20 times (460 runs)**. Thirteen scenario variants
failed in every repetition; ten control variants passed in every repetition.
These are scenario counts, not thirteen independent bugs. Python 3.14.5; no real
providers, customer data, credentials, or third-party framework runtime was used.

`results.json` records source hashes, per-case counts, and failure messages.
`first-run.log` preserves the first run's failures. The runner returns nonzero
when a desired contract fails; there are no xfail marks or swallowed failures.

## Findings

### Wrapper cleanup after rejection or cancellation

Promise: convenience wrappers manage task submission and dequeueing, including errors.

Probe: reject a weight-3 call against a budget of 2, then submit a weight-1 call.
The second call is also rejected, despite zero spend and enough available budget:
LOCO checks the abandoned weight-3 task. A separate probe cancels a waiting call
and finds its task still in the queue after the holder finishes. Both `wrap()`
and `scheduled()` reproduce the problem. A cheap call without the prior rejection
succeeds in all repetitions.

Cause: cleanup starts *inside* the acquired context, so admission failure or
cancellation while waiting bypasses it. See `loco/convenience.py:144` and `:179`.
Next regression requirement: remove the exact submitted task on every exit,
including before admission; verify no unrelated task is removed.

### Out-of-order wrapper completion misattributes cost

Promise: each wrapped action is priced using its submitted task weight.

Probe: hold a weight-2 action open, complete a weight-5 action, then run a weight-1
action for the same agent. Observed actions have weights `[2, 5, 1]` but settled
spend is **12, not 8**. Both `wrap()` and `scheduled()` reproduce it. Sequential
controls record 8 correctly.

Cause: the completed second action removes the oldest task (the first action),
leaving its own weight-5 task behind. After its claim is released, the third
acquisition claims that stale task and is priced as 5. See
`loco/convenience.py:150` and `:184`.
Next regression requirement: bind submission, acquisition, and completion to the
same task identity, regardless of completion order. This is an additional wrapper
lifecycle gap, not a failure of the earlier direct-acquire reproduction.

### Callback adapters lose overlapping handles

Promise: start/end callback pairs acquire and release a slot and settle its budget.

Probe: start two calls for the same agent, end the second, then end the first.
LOCO's LangChain, ADK, and CrewAI callbacks each leave **one slot held and one
budget unit reserved**, with only one of the two units settled. Sequential
callback controls leave no held slot or reservation and settle both units.

Cause: LangChain stores a single `_handle`; ADK and CrewAI store one handle per
agent name/role. The second start overwrites the first. Sources:
`loco/adapters/langchain.py:89`, `google_adk.py:90`, `crewai.py:80`.
Next regression requirement: key by invocation identity where available, or
explicitly reject overlapping invocations before overwriting a handle. Also test
error/cancellation callbacks and duplicate completions. These are local callback
contract tests; actual framework integration behavior still needs verification.

### Tenant and resource-pool waiters do not resume

Promise: waiting work eventually acquires capacity after its holder releases it.

Probe: hold the only slot, queue another caller, and release the holder. Both
`MultiTenantScheduler.acquire()` and `ResourcePool.acquire_multiple()` remain
stuck with **zero holders and one waiter**. Capacity-two controls complete.

Cause: these paths register waiters but never call `grant()` on release, unlike
AsyncLOCOScheduler. Sources: `loco/tenant.py:205`, `:212`, and
`loco/multi_resource.py:90`, `:100`. Alphabetical multi-resource ordering avoids
circular wait but does not supply the missing wakeup mechanism.

The tenant case was already identified in an uncommitted xfail test in the original
checkout (`tests/test_tenant.py::TestTenantContention`); it is independently
reconfirmed here, not claimed as a new discovery. The resource-pool case is a
separate affected public API.
Next regression requirement: explicit release-to-grant ownership for every API
using SharedResource, including cancellation cleanup and multi-resource rollback.

### Tenant timeout is ignored

Promise: `MultiTenantScheduler.acquire(timeout=...)` bounds the wait.

Probe: hold the only slot and call acquire with a 5 ms timeout. The waiter is
still pending after a separate 50 ms watchdog in every repetition. The test then
cancels it to clean up.

Cause: the timeout argument is accepted but never used in the implementation.
This is independently testable while the holder remains active, so it is not
just the missing-release-wakeup problem. See `loco/tenant.py:179` and `:205`.
Next regression requirement: timeout raises, removes exactly its waiter, and
leaves the active holder undisturbed; separately verify a grant before deadline.

### Preloaded agent queues bypass tenant ceilings

Promise: tenant acquire documents enforcement of the cost ceiling at grant.

Probe: register an Agent whose public `tasks` field already contains a weight-2
task, under a tenant with a ceiling of 1. Acquisition runs the action and records
two units. The control submits the same task through `submit_task()` and is
correctly rejected.

Cause: only `submit_task()` checks the ceiling; `register_agent()` accepts the
preloaded queue and `acquire()` simply adds its weight to spend. See
`loco/tenant.py:131`, `:161`, and `:207`.
Next regression requirement: admission checks the ceiling on every supported
entry path, with explicit handling of preloaded tasks and active commitments.

## Repeatable method

For each public guarantee, capture the documentation/code location, then test:

1. A minimal successful control, plus the case expected to be denied.
2. Two overlapping calls with the same identity and different task metadata.
3. Rejection/cancellation before acquisition, while queued, and during execution.
4. Reversed completion order, duplicate completion, and error callbacks.
5. The state after completion: task identity, free slots, pending queue, settled
   spend, and outstanding reservations.
6. Every public path that makes the promise: direct API, convenience wrapper,
   callback adapter, tenant scheduler, and multi-resource pool.

Use events to force interleavings, not random sleeps. Use action traces alongside
accounting/holder observations. A timeout watchdog bounds a stuck test; the static
code path confirms whether a missing wakeup or unused timeout explains it.
Record controls and failures, then turn each confirmed finding into a required
regression test when fixed. The existing passing core suite is not evidence that
wrappers and alternate schedulers preserve the same guarantees.

## Run

From this worktree, using an environment with the repository's dev dependencies:

```sh
python -m pytest -q audits/test_boundary_contracts.py
python audits/run_boundary_audit.py --repetitions 20
```

Both commands currently fail intentionally because the tested contracts are
broken. The file is explicitly invoked under `audits/`, outside the default
`tests/` suite, to keep investigative failures separate from the finished fix
branch. It must not be presented as a passing release check. When a fix lands,
move the corresponding contract test into the required test suite.

Prioritize wrapper task identity/cleanup and callback handle ownership, followed
by the tenant/resource-pool admission and waiting contracts. No fixes, release,
public issues, or messages to other people were made in this audit. This is a
bounded first pass, not exhaustive concurrency verification.
