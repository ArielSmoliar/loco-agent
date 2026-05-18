# LOCO-Agent v0.1 API Specification

> Async-first scheduling layer for multi-agent systems.
> This spec defines the public API surface for v0.1. Internal methods are documented for testing and replay only.

## Core Types

### Task

```python
@dataclass
class Task:
    task_id: str
    weight: float = 1.0          # normalized cost: 1=cheap, 2=medium, 3=expensive
    arrival_tick: int = 0
    age: int = 0                 # ticks spent waiting
    task_type: str = "default"
```

- `weight` must be >= 1.0. Raises `ValueError` otherwise.
- `age` increments by 1 on each logical tick (i.e., each `release()` event).
- `task_id` is a string, assigned by the caller or auto-generated.

### Agent

```python
@dataclass
class Agent:
    agent_id: str
    name: str = ""
    agent_type: str = "default"
    tasks: list[Task]
    completed_tasks: list[Task]
```

**Properties:**

| Property | Returns | Description |
|----------|---------|-------------|
| `queue_depth_weighted` | `float` | Sum of `task.weight` for all queued tasks (Qi) |
| `dmax` | `float` | Age of the oldest waiting task (Dmax_i). Returns 0.0 if queue is empty |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `serve_oldest_task()` | `Task | None` | Removes and returns the task with the highest `age`. Appends it to `completed_tasks`. Returns `None` if queue is empty |

### SharedResource

```python
class SharedResource:
    name: str
    capacity: int = 1            # concurrent holders allowed
```

**Properties:**

| Property | Returns | Description |
|----------|---------|-------------|
| `utilization` | `float` | Current holders / capacity. Range [0.0, 1.0] |

### OptimizeFor

```python
class OptimizeFor(str, Enum):
    LATENCY = "latency"          # alpha = 0.0
    BALANCED = "balanced"        # alpha = 0.25
    THROUGHPUT = "throughput"    # alpha = 0.5
```

Note: `"throughput"` maps to alpha=0.5, not 1.0. Alpha >= 0.75 causes starvation (validated in simulation Scenario 2).

## LOCOScheduler

### Constructor

```python
class LOCOScheduler:
    def __init__(
        self,
        agents: list[Agent],
        resource: SharedResource,
        *,
        optimize_for: OptimizeFor = OptimizeFor.BALANCED,
        alpha: float | None = None,       # advanced: raw alpha override
        max_waiters: int = 100,           # backpressure limit per resource
        max_history: int = 10_000,        # ring buffer cap for history
        enable_logging: bool = False,
        seed: int | None = None,          # deterministic tie-breaking
    ):
```

**Validation:**

- Passing both `optimize_for` and `alpha` raises `ValueError`.
- `alpha` must be in [0.0, 1.0], else `ValueError`.
- If neither is provided, defaults to `OptimizeFor.BALANCED` (alpha=0.25).

### Async Public API

```python
async def acquire(self, agent_id: str) -> AsyncContextManager:
    """
    Request the shared resource for the given agent.
    Blocks until L(i) wins a slot. Respects priority order.
    
    Usage:
        async with scheduler.acquire(agent_id) as slot:
            result = await do_work()
    
    Raises:
        BackpressureError: if waiters exceed max_waiters
        TimeoutError: if cancelled while waiting
        ShutdownError: if scheduler is shutting down
    """

async def submit_task(self, agent_id: str, task: Task) -> None:
    """
    Enqueue a task to the specified agent.
    Triggers re-scoring if agent is already in the wait queue.
    
    Raises:
        ValueError: if agent_id is not registered
        ShutdownError: if scheduler is shutting down
    """

async def shutdown(self, timeout: float = 30.0) -> ShutdownResult:
    """
    Graceful shutdown:
    1. Stop accepting new tasks (submit_task raises ShutdownError)
    2. Wait for in-flight tasks to complete (up to timeout)
    3. Cancel remaining waiters
    
    Returns ShutdownResult with counts: completed, cancelled, timed_out.
    """
```

### Lifecycle Hooks

```python
on_task_started: Callable[[str, Task], None] | None = None
on_task_completed: Callable[[str, Task, Any], None] | None = None
```

Fire-and-forget. No awaiting hook results. Connected to observability on Day 9.

### Internal Sync API (testing and replay only)

```python
def compute_load_scores(self) -> dict[str, float]:
    """
    L(i) = alpha * (Qi / max{Qj}) + (1 - alpha) * (Dmax_i / max{Dmax_j})
    
    Returns scores for all agents with non-empty queues.
    Returns empty dict if no agents have tasks.
    Division by zero: if max denominator is 0, use 1.0.
    """

def select_agent(self, scores: dict[str, float]) -> Agent | None:
    """
    Highest score wins. Random tie-break (seeded for determinism).
    Returns None if scores is empty.
    """

def _step(self, arrivals: dict[str, list[Task]] | None = None) -> StepResult:
    """
    One simulation tick:
    1. Accept arrivals
    2. Score all agents
    3. Select winner
    4. Serve one task from winner
    5. Age all remaining tasks by 1
    
    Returns StepResult(selected_agent, served_task, scores).
    """
```

## Result Types

### StepResult

```python
@dataclass
class StepResult:
    selected_agent: Agent | None
    served_task: Task | None
    scores: dict[str, float]
```

### ShutdownResult

```python
@dataclass
class ShutdownResult:
    completed: int
    cancelled: int
    timed_out: int
```

## Errors

```python
class BackpressureError(Exception):
    """Raised when acquire() is called and waiters >= max_waiters."""

class ShutdownError(Exception):
    """Raised when submit_task() or acquire() is called after shutdown."""
```

## Adapter Interface

```python
class BaseAdapter(ABC):
    @abstractmethod
    async def register_agent(self, agent_id: str, handler: Callable) -> Agent:
        """Register a callable as a LOCO agent. Raises ValueError on duplicate."""

    @abstractmethod
    async def submit_task(self, agent_id: str, task: Task) -> None:
        """Enqueue a task. Raises ValueError if agent not registered."""

    @abstractmethod
    async def on_scheduled(self, agent_id: str, task: Task) -> Any:
        """Called when the scheduler grants a resource to this agent's task."""

    @abstractmethod
    async def on_completed(self, agent_id: str, task: Task, result: Any) -> None:
        """Called when task execution completes."""
```

v0.1 ships with `VanillaAdapter` only (wraps plain async callables). Framework-specific adapters (LangChain, ADK, CrewAI) are v0.2.

## Metrics API

```python
class SchedulerMetrics:
    def wait_time_by_agent(self) -> dict[str, float]: ...
    def resource_utilization(self) -> float: ...
    def priority_distribution(self) -> dict[str, list[float]]: ...
    def cost_by_agent(self) -> dict[str, float]: ...
    def total_cost(self) -> float: ...
```

Accessible via `scheduler.metrics`. Only populated when `enable_logging=True`.

Cost tracking is visibility-only in v0.1. No enforcement or ceilings.

## Scope

### In scope for v0.1

- Single shared resource with configurable capacity
- Async acquire/release with priority ordering
- Load function scoring (alpha-tuned)
- Backpressure (reject on overflow)
- Cancellation (timeout on acquire)
- Graceful shutdown
- `optimize_for` API (latency / balanced / throughput)
- Vanilla adapter (plain async callables)
- Structured JSON scheduling log
- Testing utilities (SyncTestScheduler, mock factories, Scenario replay)

### Out of scope for v0.1

- Dynamic agent registration (agents spinning up/down at runtime)
- Multi-resource contention and deadlock prevention
- Adaptive alpha tuning (renormalization)
- Framework-specific adapters (LangChain, ADK, CrewAI, OpenAI)
- Cost enforcement / budget ceilings
- Agent topology / hidden terminal problem
- A2A protocol integration
- Dynamic weight estimation from empirical task cost
