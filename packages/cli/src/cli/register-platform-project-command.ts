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

  try {
    projectRegistration = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.registerPlatformProject(client, config.schema, {
        repositoryRootPath,
        ...(typeof options['project-id'] === 'string' ? { projectId: options['project-id'] } : {}),
        ...(typeof options['project-name'] === 'string' ? { projectName: options['project-name'] } : {}),
        ...(typeof options['workspace-root'] === 'string' ? { workspaceRootPath: resolveFromCwd(options['workspace-root']) } : {}),
        ...(typeof options.project === 'string' ? { projectPath: resolveFromCwd(options.project) } : {}),
        ...(typeof options.topology === 'string' ? { topologyPath: resolveFromCwd(options.topology) } : {}),
        ...(typeof options.risk === 'string' ? { riskPath: resolveFromCwd(options.risk) } : {}),
        ...(typeof options['repository-id'] === 'string' ? { repositoryId: options['repository-id'] } : {}),
        ...(typeof options['repository-name'] === 'string' ? { repositoryName: options['repository-name'] } : {}),
        ...(typeof options['default-branch'] === 'string' ? { defaultBranch: options['default-branch'] } : {}),
        ...(typeof options['branch-prefix'] === 'string' ? { branchPrefix: options['branch-prefix'] } : {}),
        workspacePolicy: {
          allowedReadGlobs: dependencies.parseCsvOption(typeof options['allowed-read-globs'] === 'string' ? options['allowed-read-globs'] : undefined),
          allowedWriteGlobs: dependencies.parseCsvOption(typeof options['allowed-write-globs'] === 'string' ? options['allowed-write-globs'] : undefined),
          forbiddenWriteGlobs: dependencies.parseCsvOption(typeof options['forbidden-write-globs'] === 'string' ? options['forbidden-write-globs'] : undefined)
        }
      })
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
