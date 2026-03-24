# Self Dogfood Request

Goal: use Spec2Flow on the Spec2Flow repository itself.

Requirement:
- tighten repository-level documentation governance
- keep active docs small and current
- push repeated documentation rules into validate:docs instead of prose-only guidance
- preserve the architecture boundary that Spec2Flow is the orchestrator, not the coding agent

Expected output:
- a task graph that prefers the docs-governance route
- execution state that can be claimed and progressed by the workflow loop
- validation evidence written under `.spec2flow/generated/`