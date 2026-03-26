import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  getPlatformControlPlaneArtifactContent,
  getPlatformControlPlaneLocalArtifactContent,
  getPlatformControlPlaneRunDetail,
  getPlatformControlPlaneRunObservability,
  getPlatformControlPlaneTaskArtifactCatalog,
  getPlatformControlPlaneRunTasks,
  listPlatformRuns
} from '../platform/platform-control-plane-service.js';
import {
  listPlatformProjects as listPlatformProjectsService,
  registerPlatformProject as registerPlatformProjectService,
  updatePlatformProjectAdapterProfile as updatePlatformProjectAdapterProfileService
} from '../platform/platform-project-service.js';
import {
  approvePlatformControlPlaneTask as approvePlatformControlPlaneTaskAction,
  pausePlatformControlPlaneRun as pausePlatformControlPlaneRunAction,
  rejectPlatformControlPlaneTask as rejectPlatformControlPlaneTaskAction,
  resumePlatformControlPlaneRun as resumePlatformControlPlaneRunAction,
  retryPlatformControlPlaneTask as retryPlatformControlPlaneTaskAction
} from '../platform/platform-control-plane-action-service.js';
import { submitPlatformControlPlaneRun as submitPlatformControlPlaneRunService } from '../platform/platform-control-plane-run-submission-service.js';
import { startPlatformControlPlaneServer } from '../platform/platform-control-plane-server.js';
import { startPlatformAutoRunner } from '../platform/platform-auto-runner-service.js';
import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT } from '../platform/platform-scheduler-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface ServePlatformControlPlaneDependencies {
  createPlatformPool: typeof createPlatformPool;
  approvePlatformControlPlaneTask: typeof approvePlatformControlPlaneTaskAction;
  fail: (message: string) => void;
  getPlatformControlPlaneArtifactContent?: typeof getPlatformControlPlaneArtifactContent;
  getPlatformControlPlaneLocalArtifactContent: typeof getPlatformControlPlaneLocalArtifactContent;
  getPlatformControlPlaneRunDetail: typeof getPlatformControlPlaneRunDetail;
  getPlatformControlPlaneRunObservability: typeof getPlatformControlPlaneRunObservability;
  getPlatformControlPlaneTaskArtifactCatalog: typeof getPlatformControlPlaneTaskArtifactCatalog;
  getPlatformControlPlaneRunTasks: typeof getPlatformControlPlaneRunTasks;
  listPlatformProjects: typeof listPlatformProjectsService;
  listPlatformRuns: typeof listPlatformRuns;
  pausePlatformControlPlaneRun: typeof pausePlatformControlPlaneRunAction;
  rejectPlatformControlPlaneTask: typeof rejectPlatformControlPlaneTaskAction;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  resumePlatformControlPlaneRun: typeof resumePlatformControlPlaneRunAction;
  retryPlatformControlPlaneTask: typeof retryPlatformControlPlaneTaskAction;
  registerPlatformProject: typeof registerPlatformProjectService;
  updatePlatformProjectAdapterProfile: typeof updatePlatformProjectAdapterProfileService;
  submitPlatformControlPlaneRun: typeof submitPlatformControlPlaneRunService;
  startPlatformControlPlaneServer: typeof startPlatformControlPlaneServer;
  withPlatformTransaction: typeof withPlatformTransaction;
}

function parsePort(value: string | boolean | undefined, fail: (message: string) => void): number {
  if (typeof value !== 'string') {
    return 4310;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    fail('--port must be an integer between 0 and 65535');
    throw new Error('unreachable');
  }

  return parsed;
}

function parsePositiveInteger(value: string | boolean | undefined, optionName: string, fallback: number, fail: (message: string) => void): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    fail(`${optionName} must be a positive integer`);
    throw new Error('unreachable');
  }

  return parsed;
}

export async function runServePlatformControlPlane(
  options: CliOptions,
  dependencies: ServePlatformControlPlaneDependencies
): Promise<void> {
  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const host = typeof options.host === 'string' ? options.host : '127.0.0.1';
  const port = parsePort(options.port, dependencies.fail);
  const eventLimit = parsePositiveInteger(options['event-limit'], '--event-limit', DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, dependencies.fail);
  const pool = dependencies.createPlatformPool(config);

  const startedServer = await dependencies.startPlatformControlPlaneServer({
    host,
    port,
    eventLimit,
    listPlatformRuns: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.listPlatformRuns(client, config.schema, request)),
    listPlatformProjects: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.listPlatformProjects(client, config.schema, request)),
    getPlatformControlPlaneRunDetail: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformControlPlaneRunDetail(client, config.schema, request)),
    getPlatformControlPlaneRunTasks: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformControlPlaneRunTasks(client, config.schema, request)),
    getPlatformControlPlaneRunObservability: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformControlPlaneRunObservability(client, config.schema, request)),
    getPlatformControlPlaneTaskArtifactCatalog: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformControlPlaneTaskArtifactCatalog(client, config.schema, request)),
    getPlatformControlPlaneLocalArtifactContent: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformControlPlaneLocalArtifactContent(client, config.schema, request)),
    ...(dependencies.getPlatformControlPlaneArtifactContent
      ? {
          getPlatformControlPlaneArtifactContent: async (request: { artifactId: string }) =>
            dependencies.withPlatformTransaction(pool, async (client) =>
              dependencies.getPlatformControlPlaneArtifactContent?.(client, config.schema, request) ?? null)
        }
      : {}),
    submitPlatformRun: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.submitPlatformControlPlaneRun(client, config.schema, request)),
    registerPlatformProject: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.registerPlatformProject(client, config.schema, request)),
    updatePlatformProjectAdapterProfile: async (projectId, request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.updatePlatformProjectAdapterProfile(client, config.schema, projectId, request)),
    retryPlatformTask: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.retryPlatformControlPlaneTask(client, config.schema, request)),
    approvePlatformTask: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.approvePlatformControlPlaneTask(client, config.schema, request)),
    pausePlatformRun: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.pausePlatformControlPlaneRun(client, config.schema, request)),
    rejectPlatformTask: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.rejectPlatformControlPlaneTask(client, config.schema, request)),
    resumePlatformRun: async (request) =>
      dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.resumePlatformControlPlaneRun(client, config.schema, request))
  });

  console.log(`Platform control plane listening on http://${startedServer.host}:${startedServer.port}`);

  // Start background auto-runner: picks up pending runs and executes
  // deterministic tasks (environment-preparation, automated-execution) immediately.
  // AI-dependent stages are marked blocked until an adapter is configured.
  startPlatformAutoRunner({ pool, schema: config.schema });
  console.log(`Platform auto-runner started (polling every 6s)`);
}
