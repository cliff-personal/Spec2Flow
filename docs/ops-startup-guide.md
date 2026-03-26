# Ops Startup Guide

- Status: active
- Source of truth: `package.json`, `packages/cli/src/cli/serve-platform-control-plane-command.ts`, `packages/cli/src/platform/platform-auto-runner-service.ts`, `packages/cli/src/platform/platform-database.ts`, `packages/web/vite.config.ts`, `packages/web/src/lib/control-plane-api.ts`
- Verified with: `npm run build`, `npm run serve:platform-control-plane`
- Last verified: 2026-03-25

## Overview

Spec2Flow has two runtime processes:

| Process | Default port | Purpose |
|---|---|---|
| API server (`serve-platform-control-plane`) | `4310` | REST API, project registry, run management, background auto-runner |
| Web frontend (`web:dev` / `web:preview`) | `4311` | Control-plane UI |

Both require a PostgreSQL database. Run migration once before first startup.

---

## Prerequisites

- Node.js ≥ 20
- PostgreSQL — local Homebrew install **or** Docker container (see below)
- `npm install` completed at repo root

```sh
npm install
npm run build
```

### Docker PostgreSQL (current setup)

The project currently uses the `synapse-postgres` Docker container (shared with Synapse-Network):

```sh
# Container is already running; verify:
docker ps | grep synapse-postgres

# Create the spec2flow database once:
docker exec synapse-postgres psql -U synapse -d synapse_gateway -c "CREATE DATABASE spec2flow;"
```

Connection string: `postgresql://synapse:12345678@localhost:5432/spec2flow`

---

## 1. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SPEC2FLOW_DATABASE_URL` | Yes* | — | PostgreSQL connection string |
| `DATABASE_URL` | Yes* | — | Fallback if `SPEC2FLOW_DATABASE_URL` is not set |
| `SPEC2FLOW_DATABASE_SCHEMA` | No | `public` | PostgreSQL schema name |
| `VITE_CONTROL_PLANE_BASE_URL` | No | `http://127.0.0.1:4310` | API base URL used by the web frontend |

\* One of the two database URL variables must be present. The `pg` library also reads standard `PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE` env vars if no URL is set.

Example `.env` (Docker setup):

```sh
SPEC2FLOW_DATABASE_URL=postgresql://synapse:12345678@localhost:5432/spec2flow
```

---

## 2. Database Migration

Run once before first startup, and again after any schema update:

```sh
npm run migrate:platform-db
```

Equivalent direct command:

```sh
node packages/cli/dist/cli/spec2flow-dist-entrypoint.js migrate-platform-db \
  --database-url postgresql://synapse:12345678@localhost:5432/spec2flow
```

The migration is idempotent — safe to re-run.

---

## 3. Start the API Server

```sh
npm run serve:platform-control-plane
```

Equivalent direct command with all options:

```sh
node packages/cli/dist/cli/spec2flow-dist-entrypoint.js serve-platform-control-plane \
  --host 127.0.0.1 \
  --port 4310 \
  --database-url postgresql://synapse:12345678@localhost:5432/spec2flow
```

**CLI flags:**

| Flag | Default | Description |
|---|---|---|
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `4310` | Listen port |
| `--database-url` | `$SPEC2FLOW_DATABASE_URL` | PostgreSQL connection string |
| `--database-schema` | `public` | PostgreSQL schema |
| `--event-limit` | `200` | Max run events returned per query |

On success:

```
Platform control plane listening on http://127.0.0.1:4310
Platform auto-runner started (polling every 6s)
```

The auto-runner is embedded in the API server process. It polls the database every 6 seconds for pending or running platform runs and automatically executes each ready task:

- **`environment-preparation`** and **`automated-execution`** run immediately via the deterministic execution engine. No AI adapter required.
- All other stages (`requirements-analysis`, `code-implementation`, `test-design`, `defect-feedback`, `collaboration`) require an AI adapter runtime. Without one configured, tasks are marked `blocked` with code `no-adapter-configured` and the run pauses there.

See [Section 6 — Configuring an AI Adapter](#6-configuring-an-ai-adapter) to unblock those stages.

---

## 4. Start the Web Frontend

**Development (hot reload):**

```sh
npm run web:dev
```

Opens at `http://127.0.0.1:4311`. The frontend calls the API at `http://127.0.0.1:4310` by default. Override with:

```sh
VITE_CONTROL_PLANE_BASE_URL=http://my-server:4310 npm run web:dev
```

**Preview built assets:**

```sh
npm run web:build
npm run web:preview
```

Also serves at `http://127.0.0.1:4311`.

---

## 5. Typical Local Startup Sequence

```sh
# Terminal 1 — API server (includes background auto-runner)
export SPEC2FLOW_DATABASE_URL=postgresql://synapse:12345678@localhost:5432/spec2flow
npm run migrate:platform-db
npm run serve:local

# Terminal 2 — Web UI
npm run web:dev
```

Open `http://127.0.0.1:4311`.

`serve:local` reads `SPEC2FLOW_DATABASE_URL` from `.env.local`. If you use a different env file, use `serve:prod` (reads `.env.prod`) or pass `--database-url` directly.

---

## 6. Configuring an AI Adapter

Once a run is submitted through the web UI (or `POST /api/runs`), the auto-runner executes `environment-preparation` automatically. After that, the next stage is `requirements-analysis`, which requires an AI adapter.

Without an adapter the run enters `blocked` status. The web UI shows:

> ⚠ 等待 AI 适配器 — 配置 adapter-runtime 以继续执行（当前阶段：需求分析）

### Option A — GitHub Copilot CLI (bundled adapter)

1. Install and authenticate:

   ```sh
   gh auth login
   gh copilot login   # or: gh extension install github/gh-copilot
   gh auth status     # verify
   ```

2. Run a preflight check:

   ```sh
   npm run preflight:copilot-cli
   ```

3. Ensure `.spec2flow/runtime/model-adapter-runtime.json` exists in the target project. The scaffold (`scaffoldSpec2flowFiles`) writes a minimal version automatically. It must point at the Copilot CLI adapter command:

   ```json
   {
     "adapterRuntime": {
       "name": "github-copilot-cli-adapter",
       "provider": "github-copilot-cli",
       "command": "node",
       "args": [
         "docs/examples/synapse-network/example-command-adapter.mjs",
         "--claim",
         "${claimPath}"
       ],
       "outputMode": "stdout"
     }
   }
   ```

4. Re-submit the run or retry the blocked task from the web UI. The auto-runner will pick it up within 6 seconds and dispatch it to the adapter.

### Option B — Custom adapter (OpenAI, Claude, Azure OpenAI, internal)

Replace `command` / `args` with any script that reads `--claim <claimPath>` and writes a normalized `AdapterRunDocument` JSON to stdout. See [docs/runtime-config-reference.md](runtime-config-reference.md) for the full field reference.

### How the auto-runner dispatches

1. Polls every 6 seconds for runs with `pending` or `running` status.
2. **Expired lease sweep**: before leasing new tasks, runs `expirePlatformLeases` across all running runs. Any task whose lease TTL has elapsed (default 600 s) is reset to `ready` (up to `maxRetries`) or `blocked` (budget exhausted). This means a crashed adapter process can never permanently block a run.
3. Leases the next `ready` task (`FOR UPDATE SKIP LOCKED`).
4. For deterministic stages: runs in-process without an adapter.
5. For AI stages: calls `executePlatformWorkerMaterialization` which invokes the configured adapter runtime command as a child process.
6. Persists task result, promotes downstream tasks, and emits events back to PostgreSQL.

When an expired lease is recovered you will see a log line like:

```
[auto-runner] recovered 1 expired lease(s) for run <runId> (requeued: 1, blocked: 0)
```

---

## 7. Legacy Manual Worker

The auto-runner replaces the need to run `run:platform-worker-task` manually in most cases. The manual command remains available for debugging individual tasks:

```sh
npm run run:platform-worker-task -- \
  --run-id <runId> \
  --task-id <taskId> \
  --worker-id debug-worker-1 \
  --adapter-runtime .spec2flow/runtime/model-adapter-runtime.json
```

---

## 8. Verify

```sh
# API server health — should return JSON
curl http://127.0.0.1:4310/api/projects

# Confirm no TypeScript errors
npm run typecheck
```
