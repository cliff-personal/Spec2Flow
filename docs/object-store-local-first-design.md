# Local-First Object Store Design

- Status: active
- Source of truth: `packages/cli/src/runtime/execution-artifact-store-service.ts`, `packages/cli/src/runtime/execution-artifact-catalog-service.ts`, `packages/cli/src/runtime/deterministic-execution-service.ts`, `packages/cli/src/platform/platform-control-plane-service.ts`, `schemas/system-topology.schema.json`, `schemas/execution-artifact-catalog.schema.json`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`, `npm run web:build`
- Last verified: 2026-03-25

## Goal

Define a storage design that matches the product roadmap:

1. V1 is a locally deployed product that manages local agents.
2. V1 should default to local artifact storage with minimal operator setup.
3. V1.5 should support a production-shaped local upgrade path through MinIO.
4. V2 can extend the same contract into multi-tenant, permission-aware object storage.

This document is the design answer for execution artifacts, upload lifecycle, and task-scoped artifact retrieval in the local-first product shape.

## Decision Summary

Spec2Flow should use a layered storage model:

1. `local` is the default storage mode for V1.
2. `remote-catalog` remains the abstraction for remotely addressable object storage.
3. V1 should treat `local` as the operational default and `generic-http` as a thin bridge for integration tests and custom upload gateways.
4. The first production-shaped upgrade path should be `provider: s3` backed by local MinIO.
5. Control-plane retrieval should always flow through the task's `execution-artifact-catalog`, regardless of where the bytes are stored.

That gives us one stable control-plane story while allowing storage backends to evolve.

## Product Fit

### Why `local` first is the right V1 default

V1 is not a hosted SaaS control plane. It is a locally deployed product that manages local agents and local repositories.

That means the default artifact behavior should optimize for:

- zero cloud credentials
- zero Docker dependency for first run
- easy debugging from the filesystem
- predictable local paths for reports, logs, screenshots, traces, and videos
- low operator surprise

The local-first design matches that reality better than jumping straight into bucket semantics.

### Why MinIO is the right next step

MinIO gives us a local deployment target that behaves like S3. It is the cleanest bridge between:

- V1 local operator workflows
- V2 production object storage contracts
- future retention, signed URL, and remote retrieval policies

MinIO is not the default. It is the first upgrade path when a local deployment outgrows pure filesystem storage.

## Storage Modes

### Mode 1: `local`

Purpose:
- default V1 storage mode
- local development
- single-node deployments
- test and debug friendly output

Behavior:
- artifacts are written under repository-local execution output paths
- the task emits an `execution-artifact-catalog`
- catalog entries contain local paths
- no remote URL is required
- upload lifecycle is not required

Strengths:
- simplest setup
- easiest debugging
- zero external dependency

Tradeoffs:
- artifacts are tied to one machine
- retrieval is path-based instead of object-store based
- large artifacts remain local-disk concerns

### Mode 2: `remote-catalog` with `generic-http`

Purpose:
- bridge mode for custom upload endpoints
- integration tests for upload lifecycle behavior
- thin compatibility layer before vendor-native providers exist

Behavior:
- Spec2Flow writes artifacts locally first
- then uploads them through one configured HTTP endpoint template
- upload status is written back into the artifact catalog
- control-plane retrieval uses catalog metadata such as `remoteUrl`, `objectKey`, and upload status

Strengths:
- already implemented
- good for transitional integration

Tradeoffs:
- weak semantics compared with true vendor-native APIs
- presigned URL, multipart upload, checksum, and retention policies remain external concerns

### Mode 3: `remote-catalog` with `provider: s3` backed by MinIO

Purpose:
- first production-shaped upgrade path after `local`
- local object storage with stable bucket semantics
- prepare for AWS S3 or S3-compatible production backends later

Behavior:
- Spec2Flow still builds the same `execution-artifact-catalog`
- upload is performed through S3 semantics instead of a generic HTTP template
- local deployments point the S3 provider at MinIO
- future cloud deployments can point the same provider at AWS S3 or another S3-compatible service

Strengths:
- local-first but production-shaped
- strongest next-step fit for V1.5
- easiest path toward presigned URLs and richer retrieval policy

Tradeoffs:
- introduces Docker or local service management
- adds credential and bucket bootstrap concerns

## Control Plane Rule

The control plane must not care whether bytes live:

- on local disk
- in MinIO
- in a future cloud bucket

The control plane should only care about:

- the task's `execution-artifact-catalog`
- the artifact metadata persisted in the platform run state
- the retrieval descriptors exposed in the catalog

This keeps UI and operator tooling decoupled from storage implementation churn.

## V1 Architecture

### Runtime write path

For automated execution:

1. deterministic execution writes artifact files locally
2. the execution artifact store registers each artifact
3. if storage mode is remote-capable, upload lifecycle runs after local writes
4. upload status is captured per artifact
5. Spec2Flow emits `execution-evidence-index`
6. Spec2Flow emits `execution-artifact-catalog`
7. the worker persists artifact metadata into PostgreSQL

### Runtime read path

For operator inspection:

1. the control plane loads run state from PostgreSQL
2. the control plane identifies the task's `execution-artifact-catalog`
3. the control plane reads and validates that catalog
4. UI surfaces local path, remote URL, object key, and upload status from the catalog

This read path is already stronger than path-only artifact lookup because it centralizes retrieval truth per task.

For `local-fs`, the built-in control plane can now also serve bytes directly from the repository-local artifact path when `publicBaseUrl` points at its `/artifacts/` route. That keeps V1 local deployments simple while preserving the same catalog contract the UI uses for remote providers.

## Recommended V1 Configuration

Use this as the default deployment recommendation:

```yaml
artifactStore:
  mode: local
  provider: local-fs
  publicBaseUrl: http://127.0.0.1:4310/artifacts/
  keyPrefix: frontend-smoke/
```

Repository effects:

- deterministic execution writes to `spec2flow/outputs/execution/...`
- `execution-artifact-catalog` is still produced
- catalog entries now explicitly declare `provider: local-fs`
- if `publicBaseUrl` is configured, catalog entries also expose a local retrieval URL
- `serve-platform-control-plane` can now serve those local retrieval URLs from `/artifacts/<objectKey>`
- control-plane task detail can inspect the catalog and open the local artifact directly

Operator guidance:

- start here unless there is a concrete need for shared object storage
- local mode is the expected default for local deployments
- point `publicBaseUrl` at the control-plane backend, for example `http://127.0.0.1:4310/artifacts/`

## Recommended V1.5 Configuration

Use this when a local deployment needs object-store semantics:

```yaml
artifactStore:
  mode: remote-catalog
  provider: s3
  publicBaseUrl: http://127.0.0.1:9000/spec2flow-artifacts/
  keyPrefix: frontend-smoke/
  s3:
    endpoint: http://127.0.0.1:9000
    region: us-east-1
    bucket: spec2flow-artifacts
    forcePathStyle: true
    accessKeyEnv: SPEC2FLOW_S3_ACCESS_KEY
    secretKeyEnv: SPEC2FLOW_S3_SECRET_KEY
```

Operational meaning:

- local bytes are still written first for deterministic execution safety
- MinIO becomes the object-store system of record for remotely addressed retrieval
- the same control-plane retrieval contract still works

## Provider Interface Direction

The storage contract should converge on one provider interface:

```ts
interface ObjectStoreProvider {
  putObject(input: {
    localPath: string;
    objectKey: string;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    remoteUrl?: string;
    etag?: string;
    versionId?: string;
  }>;

  getObjectUrl?(input: {
    objectKey: string;
    expiresInSeconds?: number;
  }): Promise<string | null>;
}
```

Provider implementations should be:

- `local`
- `generic-http`
- `s3`
- later `azure-blob`
- later `gcs`

The control plane and execution catalog should depend on the interface outcome, not on provider-specific SDK types.

## Rollout Plan

### Step 1. Stabilize `local`

Keep `local` as the documented default.

Required guarantees:

- local path writes stay deterministic
- artifact catalog always exists for execution tasks
- catalog retrieval works in the control plane even when no remote upload exists

### Step 2. Add vendor-native `s3`

Implement S3 semantics directly in the artifact store layer.

Target local backend:

- MinIO

Exit signal:

- one local deployment can push execution artifacts into MinIO
- catalog entries expose object keys and retrieval URLs
- the UI can inspect those remote descriptors

### Step 3. Add DB-native artifact indexing

Do not keep all artifact retrieval knowledge trapped in catalog files forever.

Persist selected catalog fields into PostgreSQL:

- provider
- object key
- remote URL
- upload status
- upload timestamp

That enables:

- richer control-plane filtering
- artifact health views
- later retention and cleanup policies

## Non-Goals For V1

These should not block local-first delivery:

- multi-tenant bucket partitioning
- per-user artifact ACLs
- object retention policy engines
- signed URL rotation services
- cross-repository artifact tenancy policies

Those belong to V2 and should build on the same catalog contract rather than replacing it.

## Risks

### Risk 1. Local mode becomes a second-class citizen

That would be a product mistake.

Mitigation:

- keep `local` documented as the default
- require tests to pass in local mode
- do not make MinIO mandatory for the first-run experience

### Risk 2. Generic HTTP becomes permanent architecture

That would freeze us in a thin compatibility layer.

Mitigation:

- treat `generic-http` as transitional
- prioritize `s3` as the first vendor-native provider
- keep provider logic isolated from control-plane read models

### Risk 3. Control plane depends on raw file paths forever

That would make storage migration painful.

Mitigation:

- keep retrieval centered on `execution-artifact-catalog`
- later persist catalog-derived retrieval fields into PostgreSQL

## Recommendation

Adopt this sequence:

1. ship V1 with `local` as the default and recommended mode
2. keep `generic-http` as a bridge for upload lifecycle testing
3. implement `provider: s3` next and validate it locally against MinIO
4. after S3 is stable, decide whether Azure Blob and GCS are worth productizing

That path matches the product truth:

- local-first now
- production-shaped next
- multi-tenant later
