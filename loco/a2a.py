"""A2A (Agent-to-Agent) protocol integration for LOCO-Agent.

Exposes LOCO-Agent as an A2A-compliant participant. Accepts task
submissions via the A2A protocol from any compliant framework
(Google ADK, AWS AgentCore, Azure Foundry).

The A2A agent card advertises scheduling capabilities. External agents
can submit tasks and query scheduling state via the A2A interface.

Note: A2A spec is v0.3 (preview). This implementation targets the
stable subset. Expect spec churn.

Usage:
    from loco.a2a import A2ASchedulerAgent

    a2a_agent = A2ASchedulerAgent(scheduler)
    card = a2a_agent.agent_card()  # JSON-serializable agent card
    result = await a2a_agent.handle_task(task_payload)
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task


class A2ASchedulerAgent:
    """LOCO-Agent exposed as an A2A protocol participant.

    Implements the A2A agent interface:
    - agent_card(): returns capabilities and metadata
    - handle_task(): accepts task submissions from external agents
    - get_status(): returns current scheduling state

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        name: Agent name in the A2A registry.
        description: Human-readable description.
        url: URL where this agent is reachable.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        name: str = "loco-scheduler",
        description: str = "Load-aware scheduling for multi-agent systems",
        url: str = "",
    ) -> None:
        self.scheduler = scheduler
        self.name = name
        self.description = description
        self.url = url

    def agent_card(self) -> dict[str, Any]:
        """Return an A2A-compliant agent card.

        The agent card advertises this agent's capabilities to other
        A2A participants. Follows the A2A AgentCard schema.
        """
        return {
            "name": self.name,
            "description": self.description,
            "url": self.url,
            "version": "0.2.0",
            "capabilities": {
                "scheduling": True,
                "cost_tracking": True,
                "multi_framework": True,
            },
            "skills": [
                {
                    "id": "schedule_task",
                    "name": "Schedule Task",
                    "description": "Submit a task to be scheduled via load-aware priority",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "agent_id": {"type": "string"},
                            "weight": {"type": "number"},
                            "task_type": {"type": "string"},
                        },
                        "required": ["agent_id"],
                    },
                },
                {
                    "id": "get_status",
                    "name": "Get Scheduling Status",
                    "description": "Query current scheduling state and metrics",
                },
            ],
        }

    async def handle_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Handle an incoming A2A task submission.

        Args:
            payload: A2A task payload with at least "agent_id".
                     Optional: "weight" (default 1.0), "task_type".

        Returns:
            A2A-compliant response with task status.
        """
        agent_id = payload.get("agent_id")
        if not agent_id:
            return {"status": "error", "message": "agent_id is required"}

        weight = payload.get("weight", 1.0)
        task_type = payload.get("task_type", "a2a")

        task = Task(weight=weight, task_type=task_type)
        await self.scheduler.submit_task(agent_id, task)

        return {
            "status": "accepted",
            "agent_id": agent_id,
            "task_id": task.task_id,
            "weight": weight,
            "queue_depth": self.scheduler.get_agent(agent_id).queue_depth_weighted,
        }

    def get_status(self) -> dict[str, Any]:
        """Return current scheduling status as A2A-compatible JSON.

        Includes: agent count, total tasks, resource utilization,
        cost summary, and current alpha.
        """
        return {
            "status": "running",
            "agents": len(self.scheduler.agents),
            "total_pending_tasks": sum(
                len(a.tasks) for a in self.scheduler.agents.values()
            ),
            "total_completed_tasks": sum(
                len(a.completed_tasks) for a in self.scheduler.agents.values()
            ),
            "resource_utilization": self.scheduler.resource.utilization,
            "alpha": self.scheduler.alpha,
            "logical_tick": self.scheduler.logical_tick,
            "cost_summary": {
                "total": self.scheduler.metrics.total_cost(),
                "by_agent": self.scheduler.metrics.cost_by_agent(),
            },
        }
