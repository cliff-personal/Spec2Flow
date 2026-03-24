import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskGraphDocument } from '../types/task-graph.js';
import type {
  PlatformArtifactRecord,
  PlatformEventRecord,
  PlatformRepositoryRecord,
  PlatformRunRecord,
  PlatformTaskRecord
} from '../types/platform-persistence.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';

export interface PlatformRunInitializationPlan {
  repository: PlatformRepositoryRecord;
  run: PlatformRunRecord;
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
    attempts: 0
  }));

  const events: PlatformEventRecord[] = [
    {
      eventId: randomUUID(),
      runId,
      eventType: 'run.created',
      payload: {
        workflowName: run.workflowName,
        status: run.status,
        currentStage: run.currentStage
      }
    },
    {
      eventId: randomUUID(),
      runId,
      eventType: 'planning.completed',
      payload: {
        taskCount: tasks.length,
        selectedRoutes: taskGraphPayload.taskGraph.source?.selectedRoutes ?? []
      }
    },
    {
      eventId: randomUUID(),
      runId,
      eventType: 'tasks.persisted',
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
      eventType: 'artifact.attached',
      payload: {
        artifactIds: artifacts.map((artifact) => artifact.artifactId),
        count: artifacts.length
      }
    });
  }

  return {
    repository,
    run,
    tasks,
    events,
    artifacts
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
          attempts
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
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
        task.attempts ?? 0
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

export async function persistPlatformRunPlan(
  executor: SqlExecutor,
  schema: string,
  plan: PlatformRunInitializationPlan
): Promise<void> {
  await upsertPlatformRepository(executor, schema, plan.repository);
  await insertPlatformRun(executor, schema, plan.run);
  await insertPlatformTasks(executor, schema, plan.tasks);
  await insertPlatformArtifacts(executor, schema, plan.artifacts);
  await insertPlatformEvents(executor, schema, plan.events);
}
