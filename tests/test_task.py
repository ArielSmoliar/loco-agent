"""Tests for Task dataclass."""

import pytest

from loco.task import Task


def test_default_weight():
    t = Task()
    assert t.weight == 1.0


def test_custom_weight():
    t = Task(weight=3.0)
    assert t.weight == 3.0


def test_age_initializes_to_zero():
    t = Task()
    assert t.age == 0


def test_invalid_weight_rejected():
    with pytest.raises(ValueError, match="weight must be >= 1.0"):
        Task(weight=0.5)


def test_zero_weight_rejected():
    with pytest.raises(ValueError, match="weight must be >= 1.0"):
        Task(weight=0.0)


def test_negative_weight_rejected():
    with pytest.raises(ValueError, match="weight must be >= 1.0"):
        Task(weight=-1.0)


def test_task_id_auto_generated():
    t1 = Task()
    t2 = Task()
    assert t1.task_id != t2.task_id
    assert len(t1.task_id) == 12


def test_custom_task_id():
    t = Task(task_id="my-task")
    assert t.task_id == "my-task"


def test_task_type_default():
    t = Task()
    assert t.task_type == "default"


def test_custom_task_type():
    t = Task(task_type="webhook")
    assert t.task_type == "webhook"


def test_arrival_tick_default():
    t = Task()
    assert t.arrival_tick == 0


def test_custom_arrival_tick():
    t = Task(arrival_tick=42)
    assert t.arrival_tick == 42
