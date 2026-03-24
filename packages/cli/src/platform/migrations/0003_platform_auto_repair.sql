ALTER TABLE __SPEC2FLOW_SCHEMA__.tasks
  ADD COLUMN IF NOT EXISTS auto_repair_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE __SPEC2FLOW_SCHEMA__.tasks
  ADD COLUMN IF NOT EXISTS max_auto_repair_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS __SPEC2FLOW_SCHEMA__.repair_attempts (
  repair_attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES __SPEC2FLOW_SCHEMA__.runs(run_id) ON DELETE CASCADE,
  source_task_id TEXT NOT NULL,
  trigger_task_id TEXT NOT NULL,
  source_stage TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  recommended_action TEXT,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT repair_attempts_source_task_fk
    FOREIGN KEY (run_id, source_task_id)
    REFERENCES __SPEC2FLOW_SCHEMA__.tasks(run_id, task_id)
    ON DELETE CASCADE,
  CONSTRAINT repair_attempts_trigger_task_fk
    FOREIGN KEY (run_id, trigger_task_id)
    REFERENCES __SPEC2FLOW_SCHEMA__.tasks(run_id, task_id)
    ON DELETE CASCADE,
  CONSTRAINT repair_attempts_run_source_attempt_unique
    UNIQUE (run_id, source_task_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS spec2flow_repair_attempts_run_idx
  ON __SPEC2FLOW_SCHEMA__.repair_attempts (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS spec2flow_repair_attempts_source_status_idx
  ON __SPEC2FLOW_SCHEMA__.repair_attempts (run_id, source_task_id, status, attempt_number DESC);
