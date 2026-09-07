# LOCO-Agent Threat Model

> Status: living document for the current open-source library. Monitoring-aware fleet control is a roadmap direction, not a shipped security guarantee.

## Security objective

LOCO should ensure that only policy-eligible work competes for shared capacity, enforce configured resource limits at the deployment boundary where LOCO runs, and produce enough evidence to explain its scheduling and policy decisions.

LOCO is not an agent sandbox, identity provider, network firewall, secret store, behavior classifier, or independent kill switch.

## Deployment boundary

The strength of enforcement depends on placement:

| Mode | What LOCO can enforce | Primary limitation |
|------|-----------------------|--------------------|
| **Library** | Cooperative scheduling and policy checks inside one Python process | Code can bypass LOCO by calling a provider or tool directly |
| **Gateway** | Mandatory checks for traffic whose credentials and route are controlled by the gateway | Traffic or capabilities outside that gateway remain out of scope |
| **Managed** | Central fleet enforcement | Roadmap only; not available today |

Production deployments that require mandatory enforcement should keep provider credentials away from agents and route calls through a controlled gateway. See the [enforcement model](docs/concepts/enforcement-model.md).

## Assets to protect

- Provider credentials, tool credentials, and delegated authority
- API, model, database, GPU, and network capacity
- Team, tenant, workflow, and campaign budgets
- Confidential task inputs and outputs
- Policy configuration and monitor requirements
- Scheduling events, policy decisions, and attribution records
- Availability of monitoring, evidence collection, and incident response

## Trust boundaries

LOCO assumes that agents, task content, model output, external tools, providers, and future monitor findings may be incorrect or adversarial. Operators, policy configuration, gateway identity, and the runtime hosting LOCO are trusted only to the extent documented by the deployment.

The core invariant is:

> Authorization determines eligibility. Scheduling ranks only eligible work. Queue depth, waiting age, cost, trust, or adaptive tuning must never turn denied work into eligible work.

## Threats and current controls

| Threat | Current control | Residual risk |
|--------|-----------------|---------------|
| Runaway concurrency exhausts a shared service | `SharedResource` capacity and waiter backpressure | Work that bypasses LOCO is not bounded |
| One agent monopolizes capacity | Grant-time rescoring and waiting-age contribution | Fairness depends on configuration and still needs broader baseline validation |
| A workload exceeds its budget or request rate | Budget and rate policies | Library-mode callers can bypass in-process checks |
| An agent requests data above its allowed label | Access policy and `SecurityLabel` checks | Labels are operator-supplied and do not provide information-flow tracking today |
| One tenant consumes another tenant's allocation | Tenant pools and cost ceilings | Tenant pools are application-level controls, not process or operating-system isolation; adversarial contention still needs broader validation |
| Unreliable agents receive preferential capacity | Bounded trust multiplier based on recorded outcomes | Trust signals can be incomplete, manipulated, or subject to Goodhart's law; trust is not authorization |
| Logs or attribution are altered by the workload | Structured events can be exported out of process | Tamper-evident storage and cryptographic provenance are not shipped |
| A compromised fleet uses LOCO to act faster | Policy checks precede scheduling | Campaign limits, reserved defensive capacity, trajectory state, and an independent circuit breaker are roadmap work |

## Explicit non-goals

The current project does not claim to:

- Determine whether a model is aligned, deceptive, or pursuing a hidden objective
- Reliably interpret chain of thought or model activations
- Prevent host, container, Kubernetes, credential, or network compromise
- Discover every action performed outside an integrated adapter or gateway
- Replace workload identity, least privilege, sandboxing, egress controls, admission control, or human incident authority
- Guarantee that a monitor is correct, independent, available, or resistant to collusion

## Monitoring-aware control direction

Future work may let independent monitors submit risk findings that affect eligibility and capacity. Before this becomes a product claim, LOCO must define and validate:

- Canonical proposed, allowed, denied, completed, and failed action events
- Trajectory and delegation lineage across agents and sessions
- Monitor identity, coverage health, freshness, confidence, and failure behavior
- Fail-closed behavior when required monitoring or containment disappears
- Campaign-level budgets, fan-out limits, destinations, and cumulative risk
- Proportional interventions: throttle, require approval, pause, quarantine, or terminate
- Reserved capacity for monitoring, evidence collection, and containment
- Independent stop mechanisms outside the agent-controlled runtime

Validation should measure time to detection, actions before intervention, unauthorized-action rate, monitor false positives and false negatives, throughput regression, recovery behavior, and resistance to monitor-agent collusion.

## Reporting security issues

Do not open a public issue for a vulnerability that could put users at risk. Use GitHub's private vulnerability reporting if enabled, or contact [ariel.smoliar@gmail.com](mailto:ariel.smoliar@gmail.com) with a minimal reproduction and impact assessment.

For threat-model questions that do not disclose an exploitable vulnerability, open a [GitHub Discussion](https://github.com/ArielSmoliar/loco-agent/discussions).
