# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could put users at risk.

Send a minimal reproduction, affected version, expected impact, and any suggested mitigation to [ariel.smoliar@gmail.com](mailto:ariel.smoliar@gmail.com). You should receive an acknowledgment within five business days.

For non-sensitive architecture questions, use [GitHub Discussions](https://github.com/ArielSmoliar/loco-agent/discussions).

## Scope and guarantees

LOCO's enforcement strength depends on where it is deployed. Library mode is cooperative and can be bypassed by code that calls a provider directly. Mandatory controls require a gateway or another boundary that owns credentials and routes all relevant calls through LOCO.

Read the project [threat model](../THREAT_MODEL.md) for assets, trust boundaries, current controls, residual risks, and explicit non-goals.
