import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskGraphDocument } from '../types/task-graph.js';
import type {
  PlatformArtifactRecord,
  PlatformEventRecord,
  PlatformPublicationRecord,
  PlatformProjectRecord,
  PlatformRepositoryRecord,
  PlatformRunRecord,
  PlatformRunWorkspaceRecord,
  PlatformTaskRecord
} from '../types/platform-persistence.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';

export interface PlatformRunInitializationPlan {
  repository: PlatformRepositoryRecord;
  project?: PlatformProjectRecord | null;
  run: PlatformRunRecord;
  runWorkspace?: PlatformRunWorkspaceRecord | null;
  tasks: PlatformTaskRecord[];
  events: PlatformEventRecord[];
  artifacts: PlatformArtifactRecord[];
}

export interface CreatePlatformRunPlanOptions {
  repositoryId?: string;
  repositoryName?: string;
  repositoryRoot: string;
  defaultBranch?: string;
  runId?: string;
  requestText?: string;
  taskGraphRef?: string;
}

export interface AttachPlatformProjectContextOptions {
  project: PlatformProjectRecord;
  runWorkspace: PlatformRunWorkspaceRecord;
}

function toStableIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'spec2flow';
}

function inferCurrentStage(taskGraphPayload: TaskGraphDocument): PlatformRunRecord['currentStage'] {
  return taskGraphPayload.taskGraph.tasks.find((task) => task.status === 'ready')?.stage
    ?? taskGraphPayload.taskGraph.tasks[0]?.stage
    ?? null;
}

function inferRunRiskLevel(taskGraphPayload: TaskGraphDocument): PlatformRunRecord['riskLevel'] {
  const order = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  } as const;

  return taskGraphPayload.taskGraph.tasks.reduce<PlatformRunRecord['riskLevel']>((selected, task) => {
    const next = task.riskLevel ?? null;
    if (!next) {
      return selected;
    }

    if (!selected || order[next] > order[selected]) {
      return next;
    }

    return selected;
  }, null);
}

export function createPlatformRunInitializationPlan(
  taskGraphPayload: TaskGraphDocument,
  options: CreatePlatformRunPlanOptions
): PlatformRunInitializationPlan {
  const now = new Date().toISOString();
  const repositoryName = options.repositoryName ?? path.basename(options.repositoryRoot);
  const repositoryId = options.repositoryId ?? toStableIdentifier(repositoryName);
  const runId = options.runId ?? `${taskGraphPayload.taskGraph.workflowName}-${Date.now()}`;
  const requestText = options.requestText ?? taskGraphPayload.taskGraph.source?.requirementText ?? null;

  const repository: PlatformRepositoryRecord = {
    repositoryId,
    name: repositoryName,
    rootPath: options.repositoryRoot,
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
    metadata: {
      source: 'spec2flow-cli'
    }
  };

  const run: PlatformRunRecord = {
    runId,
    repositoryId,
    workflowName: taskGraphPayload.taskGraph.workflowName,
    requestText,
    status: 'pending',
    currentStage: inferCurrentStage(taskGraphPayload),
    riskLevel: inferRunRiskLevel(taskGraphPayload),
    requestPayload: {
      source: taskGraphPayload.taskGraph.source ?? {},
      graphId: taskGraphPayload.taskGraph.id
    },
    metadata: {
      createdBy: 'init-platform-run'
    }
  };

  const tasks: PlatformTaskRecord[] = taskGraphPayload.taskGraph.tasks.map((task) => ({
    runId,
    taskId: task.id,
    stage: task.stage,
    title: task.title,
    goal: task.goal,
    executorType: task.executorType,
    status: task.status,
    ...(task.riskLevel ? { riskLevel: task.riskLevel } : {}),
    dependsOn: task.dependsOn ?? [],
    targetFiles: task.targetFiles ?? [],
    verifyCommands: task.verifyCommands ?? [],
    inputs: task.inputs ?? {},
    roleProfile: task.roleProfile,
    ...(task.reviewPolicy ? { reviewPolicy: task.reviewPolicy } : {}),
    ...(task.artifactsDir ? { artifactsDir: task.artifactsDir } : {}),
    attempts: 0,
    retryCount: 0,
    maxRetries: task.reviewPolicy?.maxExecutionRetries ?? 3,
    autoRepairCount: 0,
    maxAutoRepairAttempts: task.reviewPolicy?.maxAutoRepairAttempts ?? 0
  }));

  const events: PlatformEventRecord[] = [
    {
      eventId: randomUUID(),
      runId,
      eventType: PLATFORM_EVENT_TYPES.RUN_CREATED,
      payload: {
        workflowName: run.workflowName,
        status: run.status,
        currentStage: run.currentStage
      }
    },
    {
      eventId: randomUUID(),
      runId,
      eventType: PLATFORM_EVENT_TYPES.PLANNING_COMPLETED,
      payload: {
        taskCount: tasks.length,
        selectedRoutes: taskGraphPayload.taskGraph.source?.selectedRoutes ?? []
      }
    },
    {
      eventId: randomUUID(),
      runId,
      eventType: PLATFORM_EVENT_TYPES.TASKS_PERSISTED,
      payload: {
        taskIds: tasks.map((task) => task.taskId)
      }
    }
  ];

  const artifacts: PlatformArtifactRecord[] = options.taskGraphRef
    ? [{
        artifactId: randomUUID(),
        runId,
        kind: 'report',
        path: options.taskGraphRef,
        schemaType: 'task-graph',
        metadata: {
          capturedAt: now
        }
      }]
    : [];

  if (artifacts.length > 0) {
    events.push({
      eventId: randomUUID(),
      runId,
      eventType: PLATFORM_EVENT_TYPES.ARTIFACT_ATTACHED,
      payload: {
        artifactIds: artifacts.map((artifact) => artifact.artifactId),
        count: artifacts.length
      }
    });
  }

  return {
    repository,
    project: null,
    run,
    runWorkspace: null,
    tasks,
    events,
    artifacts
  };
}

export function attachPlatformProjectContext(
  plan: PlatformRunInitializationPlan,
  options: AttachPlatformProjectContextOptions
): PlatformRunInitializationPlan {
  const requestPayload = plan.run.requestPayload ? { ...plan.run.requestPayload } : {};
  const metadata = plan.run.metadata ? { ...plan.run.metadata } : undefined;
  const nextMetadata = metadata
    ? {
        ...metadata,
        projectId: options.project.projectId,
        worktreePath: options.runWorkspace.worktreePath,
        branchName: options.runWorkspace.branchName ?? null
      }
    : {
        projectId: options.project.projectId,
        worktreePath: options.runWorkspace.worktreePath,
        branchName: options.runWorkspace.branchName ?? null
      };
  const nextRequestPayload = {
    ...requestPayload,
    project: {
      projectId: options.project.projectId,
      projectName: options.project.name,
      repositoryRootPath: options.project.repositoryRootPath,
      workspaceRootPath: options.project.workspaceRootPath,
      projectPath: options.project.projectPath ?? null,
      topologyPath: options.project.topologyPath ?? null,
      riskPath: options.project.riskPath ?? null,
      adapterProfile: options.project.adapterProfile ?? null
    },
    workspace: {
      worktreeMode: options.runWorkspace.worktreeMode,
      provisioningStatus: options.runWorkspace.provisioningStatus,
      branchName: options.runWorkspace.branchName ?? null,
      baseBranch: options.runWorkspace.baseBranch ?? null,
      worktreePath: options.runWorkspace.worktreePath,
      workspaceRootPath: options.runWorkspace.workspaceRootPath,
      workspacePolicy: options.runWorkspace.workspacePolicy
    }
  };

  return {
    ...plan,
    project: options.project,
    run: {
      ...plan.run,
      requestPayload: nextRequestPayload,
      metadata: nextMetadata
    },
    runWorkspace: options.runWorkspace
  };
}

export async function upsertPlatformRepository(
  executor: SqlExecutor,
  schema: string,
  repository: PlatformRepositoryRecord
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  await executor.query(
    `
      INSERT INTO ${quotedSchema}.repositories (
        repository_id,
        name,
        root_path,
        default_branch,
        metadata
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (repository_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        root_path = EXCLUDED.root_path,
        default_branch = EXCLUDED.default_branch,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      repository.repositoryId,
      repository.name,
      repository.rootPath,
      repository.defaultBranch ?? null,
      JSON.stringify(repository.metadata ?? {})
    ]
  );
}

export async function insertPlatformRun(
  executor: SqlExecutor,
  schema: string,
  run: PlatformRunRecord
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  await executor.query(
    `
      INSERT INTO ${quotedSchema}.runs (
        run_id,
        repository_id,
        workflow_name,
        request_text,
        status,
        current_stage,
        risk_level,
        request_payload,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
    `,
    [
      run.runId,
      run.repositoryId,
      run.workflowName,
      run.requestText ?? null,
      run.status,
      run.currentStage ?? null,
      run.riskLevel ?? null,
      JSON.stringify(run.requestPayload ?? {}),
      JSON.stringify(run.metadata ?? {})
    ]
  );
}

export async function upsertPlatformProject(
  executor: SqlExecutor,
  schema: string,
  project: PlatformProjectRecord
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  await executor.query(
    `
      INSERT INTO ${quotedSchema}.projects (
        project_id,
        repository_id,
        name,
        repository_root_path,
        workspace_root_path,
        project_path,
        topology_path,
        risk_path,
        default_branch,
        branch_prefix,
        adapter_profile,
        workspace_policy,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
      ON CONFLICT (project_id)
      DO UPDATE SET
        repository_id = EXCLUDED.repository_id,
        name = EXCLUDED.name,
        repository_root_path = EXCLUDED.repository_root_path,
        workspace_root_path = EXCLUDED.workspace_root_path,
        project_path = EXCLUDED.project_path,
        topology_path = EXCLUDED.topology_path,
        risk_path = EXCLUDED.risk_path,
        default_branch = EXCLUDED.default_branch,
        branch_prefix = EXCLUDED.branch_prefix,
        adapter_profile = EXCLUDED.adapter_profile,
        workspace_policy = EXCLUDED.workspace_policy,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      project.projectId,
      project.repositoryId,
      project.name,
      project.repositoryRootPath,
      project.workspaceRootPath,
      project.projectPath ?? null,
      project.topologyPath ?? null,
      project.riskPath ?? null,
      project.defaultBranch ?? null,
      project.branchPrefix ?? null,
      JSON.stringify(project.adapterProfile ?? null),
      JSON.stringify(project.workspacePolicy),
      JSON.stringify(project.metadata ?? {})
    ]
  );
}

export async function upsertPlatformRunWorkspace(
  executor: SqlExecutor,
  schema: string,
  runWorkspace: PlatformRunWorkspaceRecord
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  await executor.query(
    `
      INSERT INTO ${quotedSchema}.run_workspaces (
        run_id,
        project_id,
        repository_id,
        worktree_mode,
        provisioning_status,
        branch_name,
        base_branch,
        workspace_root_path,
        worktree_path,
        workspace_policy,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      ON CONFLICT (run_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        repository_id = EXCLUDED.repository_id,
        worktree_mode = EXCLUDED.worktree_mode,
        provisioning_status = EXCLUDED.provisioning_status,
        branch_name = EXCLUDED.branch_name,
        base_branch = EXCLUDED.base_branch,
        workspace_root_path = EXCLUDED.workspace_root_path,
        worktree_path = EXCLUDED.worktree_path,
        workspace_policy = EXCLUDED.workspace_policy,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      runWorkspace.runId,
      runWorkspace.projectId,
      runWorkspace.repositoryId,
      runWorkspace.worktreeMode,
      runWorkspace.provisioningStatus,
      runWorkspace.branchName ?? null,
      runWorkspace.baseBranch ?? null,
      runWorkspace.workspaceRootPath,
      runWorkspace.worktreePath,
      JSON.stringify(runWorkspace.workspacePolicy),
      JSON.stringify(runWorkspace.metadata ?? {})
    ]
  );
}

export async function insertPlatformTasks(
  executor: SqlExecutor,
  schema: string,
  tasks: PlatformTaskRecord[]
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  for (const task of tasks) {
    await executor.query(
      `
        INSERT INTO ${quotedSchema}.tasks (
          run_id,
          task_id,
          stage,
          title,
          goal,
          executor_type,
          status,
          risk_level,
          depends_on,
          target_files,
          verify_commands,
          inputs,
          role_profile,
          review_policy,
          artifacts_dir,
          attempts,
          retry_count,
          max_retries,
          auto_repair_count,
          max_auto_repair_attempts,
          evaluation_decision,
          evaluation_summary,
          requested_repair_target_stage,
          evaluation_findings,
          evaluation_next_actions,
          current_lease_id,
          leased_by_worker_id,
          lease_expires_at,
          last_heartbeat_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24::jsonb, $25::jsonb, $26, $27, $28, $29
        )
      `,
      [
        task.runId,
        task.taskId,
        task.stage,
        task.title,
        task.goal,
        task.executorType,
        task.status,
        task.riskLevel ?? null,
        JSON.stringify(task.dependsOn),
        JSON.stringify(task.targetFiles),
        JSON.stringify(task.verifyCommands),
        JSON.stringify(task.inputs),
        JSON.stringify(task.roleProfile),
        JSON.stringify(task.reviewPolicy ?? null),
        task.artifactsDir ?? null,
        task.attempts ?? 0,
        task.retryCount ?? 0,
        task.maxRetries ?? 3,
        task.autoRepairCount ?? 0,
        task.maxAutoRepairAttempts ?? 0,
        task.evaluationDecision ?? null,
        task.evaluationSummary ?? null,
        task.requestedRepairTargetStage ?? null,
        JSON.stringify(task.evaluationFindings ?? []),
        JSON.stringify(task.evaluationNextActions ?? []),
        task.currentLeaseId ?? null,
        task.leasedByWorkerId ?? null,
        task.leaseExpiresAt ?? null,
        task.lastHeartbeatAt ?? null
      ]
    );
  }
}

export async function insertPlatformEvents(
  executor: SqlExecutor,
  schema: string,
  events: PlatformEventRecord[]
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  for (const event of events) {
    await executor.query(
      `
        INSERT INTO ${quotedSchema}.events (
          event_id,
          run_id,
          task_id,
          event_type,
          payload
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        event.eventId,
        event.runId,
        event.taskId ?? null,
        event.eventType,
        JSON.stringify(event.payload)
      ]
    );
  }
}

export async function insertPlatformArtifacts(
  executor: SqlExecutor,
  schema: string,
  artifacts: PlatformArtifactRecord[]
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  for (const artifact of artifacts) {
    await executor.query(
      `
        INSERT INTO ${quotedSchema}.artifacts (
          artifact_id,
          run_id,
          task_id,
          kind,
          path,
          schema_type,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        artifact.artifactId,
        artifact.runId,
        artifact.taskId ?? null,
        artifact.kind,
        artifact.path,
        artifact.schemaType ?? null,
        JSON.stringify(artifact.metadata ?? {})
      ]
    );
  }
}

export async function insertPlatformPublications(
  executor: SqlExecutor,
  schema: string,
  publications: PlatformPublicationRecord[]
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  for (const publication of publications) {
    await executor.query(
      `
        INSERT INTO ${quotedSchema}.publications (
          publication_id,
          run_id,
          branch_name,
          commit_sha,
          pr_url,
          publish_mode,
          status,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (publication_id)
        DO NOTHING
      `,
      [
        publication.publicationId,
        publication.runId,
        publication.branchName ?? null,
        publication.commitSha ?? null,
        publication.prUrl ?? null,
        publication.publishMode,
        publication.status,
        JSON.stringify(publication.metadata ?? {})
      ]
    );
  }
}

export async function persistPlatformRunPlan(
  executor: SqlExecutor,
  schema: string,
  plan: PlatformRunInitializationPlan
): Promise<void> {
  await upsertPlatformRepository(executor, schema, plan.repository);
  if (plan.project) {
    await upsertPlatformProject(executor, schema, plan.project);
  }
  await insertPlatformRun(executor, schema, plan.run);
  if (plan.runWorkspace) {
    await upsertPlatformRunWorkspace(executor, schema, plan.runWorkspace);
  }
  await insertPlatformTasks(executor, schema, plan.tasks);
  await insertPlatformArtifacts(executor, schema, plan.artifacts);
  await insertPlatformEvents(executor, schema, plan.events);
}
