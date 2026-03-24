CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.repositories (
  repository_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  default_branch TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.runs (
  run_id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.repositories(repository_id),
  workflow_name TEXT NOT NULL,
  request_text TEXT,
  status TEXT NOT NULL,
  current_stage TEXT,
  risk_level TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.tasks (
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  executor_type TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level TEXT,
  depends_on JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  verify_commands JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  role_profile JSONB NOT NULL,
  review_policy JSONB,
  artifacts_dir TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  current_lease_id TEXT,
  leased_by_worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, task_id)
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.task_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  worker_id TEXT,
  adapter_name TEXT,
  provider_name TEXT,
  model_name TEXT,
  session_key TEXT,
  leased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT task_attempts_task_fk
    FOREIGN KEY (run_id, task_id)
    REFERENCES __SPEC2FLOW_SCHEMA__.tasks(run_id, task_id)
    ON DELETE CASCADE,
  CONSTRAINT task_attempts_run_task_attempt_unique
    UNIQUE (run_id, task_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  task_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  schema_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.review_gates (
  gate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  task_id TEXT,
  reason TEXT NOT NULL,
  required_approver_type TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.publications (
  publication_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  branch_name TEXT,
  commit_sha TEXT,
  pr_url TEXT,
  publish_mode TEXT,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spec2flow_runs_repository_idx
  ON __SPEC2FLOW_SCHEMA__.runs (repository_id, created_at DESC);

CREATE INDEX IF NOT EXISTS spec2flow_tasks_status_idx
  ON __SPEC2FLOW_SCHEMA__.tasks (run_id, status, stage);

CREATE INDEX IF NOT EXISTS spec2flow_tasks_lease_expiry_idx
  ON __SPEC2FLOW_SCHEMA__.tasks (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS spec2flow_events_run_idx
  ON __SPEC2FLOW_SCHEMA__.events (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS spec2flow_artifacts_run_idx
  ON __SPEC2FLOW_SCHEMA__.artifacts (run_id, created_at ASC);
