---
applyTo: "schemas/**/*.json"
description: "Use when editing Spec2Flow schemas. Keeps JSON schema contracts aligned with TypeScript types, validation registry, and example fixtures."
---

# Schema Rules

- Schemas are contract files, not documentation only.
- Keep schema names, required fields, and enums aligned with the corresponding TypeScript types.
- When adding a new schema, register it in the schema registry if the runtime consumes it.
- When changing a schema-backed contract, update the relevant example fixtures and validation paths.
- Prefer explicit `required` and `additionalProperties` behavior over implicit acceptance.