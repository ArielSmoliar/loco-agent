"""Tests for SecurityLabel and Task labels field."""

import json

import pytest

from loco.labels import SecurityLabel
from loco.task import Task


class TestSecurityLabel:
    def test_values(self):
        assert SecurityLabel.PUBLIC == "public"
        assert SecurityLabel.INTERNAL == "internal"
        assert SecurityLabel.CONFIDENTIAL == "confidential"

    def test_is_str(self):
        assert isinstance(SecurityLabel.PUBLIC, str)

    def test_json_serializable(self):
        data = {"label": SecurityLabel.CONFIDENTIAL}
        result = json.dumps(data)
        assert '"confidential"' in result

    def test_from_string(self):
        assert SecurityLabel("public") is SecurityLabel.PUBLIC

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            SecurityLabel("secret")


class TestTaskLabels:
    def test_default_none(self):
        task = Task(task_id="t1")
        assert task.labels is None

    def test_with_labels(self):
        task = Task(
            task_id="t1",
            labels={"input": SecurityLabel.CONFIDENTIAL, "output": SecurityLabel.INTERNAL},
        )
        assert task.labels["input"] == SecurityLabel.CONFIDENTIAL
        assert task.labels["output"] == SecurityLabel.INTERNAL

    def test_backward_compat(self):
        """Tasks without labels still work everywhere."""
        task = Task(task_id="t1", weight=2.0, task_type="llm_call")
        assert task.labels is None
        assert task.weight == 2.0
