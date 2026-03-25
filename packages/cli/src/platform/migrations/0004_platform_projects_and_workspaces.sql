CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.projects (
  project_id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.repositories(repository_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  repository_root_path TEXT NOT NULL,
  workspace_root_path TEXT NOT NULL,
  project_path TEXT,
  topology_path TEXT,
  risk_path TEXT,
  default_branch TEXT,
  branch_prefix TEXT,
  workspace_policy JSONB NOT NULL DEFAULT '{"allowedReadGlobs":["**/*"],"allowedWriteGlobs":["**/*"],"forbiddenWriteGlobs":[]}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.run_workspaces (
  run_id TEXT PRIMARY KEY REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.projects(project_id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.repositories(repository_id) ON DELETE CASCADE,
  worktree_mode TEXT NOT NULL,
  provisioning_status TEXT NOT NULL,
  branch_name TEXT,
  base_branch TEXT,
  workspace_root_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  workspace_policy JSONB NOT NULL DEFAULT '{"allowedReadGlobs":["**/*"],"allowedWriteGlobs":["**/*"],"forbiddenWriteGlobs":[]}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spec2flow_projects_repository_idx
  ON __SPEC2FLOW_SCHEMA__.projects (repository_id, created_at DESC);

CREATE INDEX IF NOT EXISTS spec2flow_run_workspaces_project_idx
  ON __SPEC2FLOW_SCHEMA__.run_workspaces (project_id, created_at DESC);
