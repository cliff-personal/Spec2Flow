import process from 'node:process';
import { resolveFromCwd } from '../shared/fs-utils.js';
import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { registerPlatformProject } from '../platform/platform-project-service.js';
import type { PlatformControlPlaneProjectRegistrationResult } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformProjectRegistrationDocument {
  projectRegistration: PlatformControlPlaneProjectRegistrationResult;
}

export interface RegisterPlatformProjectDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: PlatformProjectRegistrationDocument) => void;
  registerPlatformProject: typeof registerPlatformProject;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

function assignStringOption<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: string | boolean | undefined,
  transform?: (next: string) => T[K]
): void {
  if (typeof value !== 'string') {
    return;
  }

  target[key] = (transform ? transform(value) : value as T[K]);
}

function buildProjectRegistrationRequest(
  options: CliOptions,
  parseCsvOption: RegisterPlatformProjectDependencies['parseCsvOption'],
  repositoryRootPath: string
): Parameters<RegisterPlatformProjectDependencies['registerPlatformProject']>[2] {
  const request: Parameters<RegisterPlatformProjectDependencies['registerPlatformProject']>[2] = {
    repositoryRootPath,
    workspacePolicy: {
      allowedReadGlobs: parseCsvOption(typeof options['allowed-read-globs'] === 'string' ? options['allowed-read-globs'] : undefined),
      allowedWriteGlobs: parseCsvOption(typeof options['allowed-write-globs'] === 'string' ? options['allowed-write-globs'] : undefined),
      forbiddenWriteGlobs: parseCsvOption(typeof options['forbidden-write-globs'] === 'string' ? options['forbidden-write-globs'] : undefined)
    }
  };

  assignStringOption(request, 'projectId', options['project-id']);
  assignStringOption(request, 'projectName', options['project-name']);
  assignStringOption(request, 'workspaceRootPath', options['workspace-root'], resolveFromCwd);
  assignStringOption(request, 'projectPath', options.project, resolveFromCwd);
  assignStringOption(request, 'topologyPath', options.topology, resolveFromCwd);
  assignStringOption(request, 'riskPath', options.risk, resolveFromCwd);
  assignStringOption(request, 'repositoryId', options['repository-id']);
  assignStringOption(request, 'repositoryName', options['repository-name']);
  assignStringOption(request, 'defaultBranch', options['default-branch']);
  assignStringOption(request, 'branchPrefix', options['branch-prefix']);

  if (typeof options['adapter-runtime'] === 'string' || typeof options['adapter-capability'] === 'string') {
    request.adapterProfile = {};
    assignStringOption(request.adapterProfile, 'runtimePath', options['adapter-runtime']);
    assignStringOption(request.adapterProfile, 'capabilityPath', options['adapter-capability']);
  }

  return request;
}

export async function runRegisterPlatformProject(
  options: CliOptions,
  dependencies: RegisterPlatformProjectDependencies
): Promise<void> {
  const repositoryRootPath = typeof options['repo-root'] === 'string'
    ? resolveFromCwd(options['repo-root'])
    : process.cwd();
  const config = dependencies.resolvePlatformDatabaseConfig(options);

  if (!config.connectionString && !process.env.PGHOST && !process.env.PGDATABASE) {
    dependencies.fail('register-platform-project requires --database-url or standard PG* environment variables');
    throw new Error('unreachable');
  }

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  const pool = dependencies.createPlatformPool(config);
  let projectRegistration: PlatformControlPlaneProjectRegistrationResult;
  const request = buildProjectRegistrationRequest(options, dependencies.parseCsvOption, repositoryRootPath);

  try {
    projectRegistration = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.registerPlatformProject(client, config.schema, request, undefined, process.cwd())
    );
  } finally {
    await pool.end();
  }

  const payload: PlatformProjectRegistrationDocument = {
    projectRegistration
  };

  if (outputPath) {
    dependencies.writeJson(outputPath, payload);
    console.log(`Wrote project registration receipt to ${outputPath}`);
    return;
  }

  dependencies.printJson(payload);
}
