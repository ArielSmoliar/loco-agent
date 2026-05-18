"""Tests for Agent dataclass."""

from loco.agent import Agent
from loco.task import Task


def test_empty_agent_queue_depth():
    a = Agent(agent_id="a1")
    assert a.queue_depth_weighted == 0.0


def test_queue_depth_weighted_sums_weights():
    a = Agent(agent_id="a1")
    a.tasks = [Task(weight=1.0), Task(weight=2.0), Task(weight=3.0)]
    assert a.queue_depth_weighted == 6.0


def test_dmax_returns_oldest_age():
    a = Agent(agent_id="a1")
    a.tasks = [Task(age=3), Task(age=10), Task(age=1)]
    assert a.dmax == 10.0


def test_dmax_empty_queue():
    a = Agent(agent_id="a1")
    assert a.dmax == 0.0


def test_serve_oldest_task_removes_and_returns():
    t_old = Task(task_id="old", age=10)
    t_new = Task(task_id="new", age=2)
    a = Agent(agent_id="a1", tasks=[t_new, t_old])

    served = a.serve_oldest_task()

    assert served is t_old
    assert len(a.tasks) == 1
    assert a.tasks[0] is t_new


def test_serve_oldest_task_empty_queue():
    a = Agent(agent_id="a1")
    assert a.serve_oldest_task() is None


def test_served_task_tracked_in_completed():
    t = Task(task_id="t1", age=5)
    a = Agent(agent_id="a1", tasks=[t])

    a.serve_oldest_task()

    assert len(a.completed_tasks) == 1
    assert a.completed_tasks[0] is t


def test_completed_tasks_accumulate():
    a = Agent(agent_id="a1")
    a.tasks = [Task(task_id="t1", age=3), Task(task_id="t2", age=1)]

    a.serve_oldest_task()
    a.serve_oldest_task()

    assert len(a.completed_tasks) == 2
    assert len(a.tasks) == 0


def test_agent_type_default():
    a = Agent(agent_id="a1")
    assert a.agent_type == "default"


def test_custom_agent_type():
    a = Agent(agent_id="a1", agent_type="webhook")
    assert a.agent_type == "webhook"


def test_serve_oldest_with_equal_ages():
    """When multiple tasks have the same age, serve one deterministically."""
    a = Agent(agent_id="a1")
    a.tasks = [Task(task_id="t1", age=5), Task(task_id="t2", age=5)]

    served = a.serve_oldest_task()
    assert served is not None
    assert len(a.tasks) == 1
