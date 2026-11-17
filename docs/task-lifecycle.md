# Task and callback lifecycle guarantees

`wrap()` and `scheduled()` own the exact Task they submit. They remove it when
admission is rejected or cancelled and complete that same task after execution,
including execution errors. Completion order does not alter another call's task
or price. Rejected admissions are not added to `completed_tasks`; actions that
started retain the existing completed-attempt accounting behavior.

`acquire(..., task=task)` and `acquire_start(..., task=task)` explicitly bind a
request to a queued Task object. A foreign/unsubmitted or already claimed task
is rejected. Omitting `task=` retains next-unclaimed selection for existing direct
callers. Direct callers still own submission/dequeueing. `Agent.remove_task()`
removes by object identity, not dataclass equality, and is idempotent.

The three callback adapters share invocation ownership logic:

- LangChain uses `run_id`.
- ADK uses `(agent_name, invocation_id)` with one active model call per pair.
- CrewAI's explicit step hooks accept `invocation_id` scoped to the role.

Distinct identified calls can overlap and finish in any order. A duplicate
active start or overlapping unidentified start raises before enqueueing. Pending
starts reserve their identifiers too. End/error callbacks release only the
matching invocation; concurrent duplicate completions settle once. Ending a
pending invocation cancels its start and waits for its cleanup. Cancellation of
an end/error callback cannot interrupt resource release midway.

An ID must be stable from start to completion and must not be reused while an
old terminal callback could still arrive. ID-less legacy calls are sequential
only and cannot distinguish a late callback from a later ID-less call. ADK's
invocation ID spans a request-response cycle, so its sequential model callbacks
must be delivered in order. Cancellation after admission still needs a terminal
callback or application `finally` cleanup; LOCO cannot infer missing callbacks.

The error hooks are `on_llm_error`, `on_model_error`, and `on_step_error`.
Provider failures settle the admitted estimate as before. They do not silently
refund potentially billable work. Coarse `run_crew()` uses the same exact-task
cleanup as the convenience wrappers.

Tests use local actions and callback invocations, including keyword-compatible
ADK calls. They cover stale rejected tasks, cancelled waiters, reversed completion
order, duplicate/missing/unknown IDs, overlapping starts, error callbacks,
cancellation during release, and identity validation. Live framework/provider
integration has not been exercised in this change. Other SDK and vanilla adapter
lifecycles have not been migrated by this scoped fix.

The tenant/resource-pool waiting, timeout, and ceiling findings were subsequently
fixed on `codex/tenant-resource-lifecycle`; see `docs/resource-lifecycle.md`.

## Local verification of the earlier task/callback fix

- Full required suite: 597 passed on Python 3.14.5; Ruff passed.
- Lifecycle regression file: 52 passed, including promoted audit scenarios.
- The ten wrapper scenarios against the previous code: six failures and four
  passing controls. Those same ten scenarios pass with this fix.
- The remaining explicit audit: four failing variants and three passing controls
  (tenant/resource-pool findings above). Its failure status is expected and is
  not included in the passing required-suite count.
