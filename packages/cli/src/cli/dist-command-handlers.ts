import { buildDocsValidationReport } from '../docs/docs-validation-service.js';
import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { getDefaultPlatformMigrationsDir, migratePlatformDatabase } from '../platform/platform-migration-service.js';
import { createPlatformRunInitializationPlan, persistPlatformRunPlan } from '../platform/platform-repository.js';
import {
  expirePlatformLeases,
  getPlatformRunState,
  heartbeatPlatformTask,
  leaseNextPlatformTask,
  startPlatformTask
} from '../platform/platform-scheduler-service.js';
import { runClaimNextTask } from './claim-next-task-command.js';
import { runExpirePlatformLeases, type PlatformLeaseExpirationSweepDocument } from './expire-platform-leases-command.js';
import { runGenerateTaskGraph } from './generate-task-graph-command.js';
import { runGetPlatformRunState, type PlatformRunStateDocument } from './get-platform-run-state-command.js';
import { runHeartbeatPlatformTask, type PlatformTaskHeartbeatDocument } from './heartbeat-platform-task-command.js';
import { runInitPlatformRun, type PlatformRunInitDocument } from './init-platform-run-command.js';
import { runInitExecutionState } from './init-execution-state-command.js';
import { runLeaseNextPlatformTask, type PlatformTaskLeaseDocument } from './lease-next-platform-task-command.js';
import { runMigratePlatformDb, type PlatformMigrationReportDocument } from './migrate-platform-db-command.js';
import { runPreflightCopilotCli } from './preflight-copilot-cli-command.js';
import { runTaskWithAdapter, type AdapterTaskRunDocument } from './run-task-with-adapter-command.js';
import { runDeterministicTaskCommand } from './run-deterministic-task-command.js';
import { runStartPlatformTask, type PlatformTaskStartDocument } from './start-platform-task-command.js';
import { runUpdateExecutionState } from './update-execution-state-command.js';
import { runValidateDocs, type DocsValidationReportDocument } from './validate-docs-command.js';
import { runWorkflowLoop } from './run-workflow-loop-command.js';
import { runSimulateModelRun, type SimulatedModelRunDocument } from './simulate-model-run-command.js';
import { runSubmitTaskResult } from './submit-task-result-command.js';
import { runValidateOnboarding, type ValidateOnboardingResultDocument } from './validate-onboarding-command.js';
import type { CliOptions as PreflightCliOptions, CopilotPreflightReportDocument } from '../adapters/copilot-preflight.js';
import type { AdapterRunDocument, AdapterRuntimeDocument, ExecutionStateDocument, TaskClaimPayload, TaskGraphDocument, TaskResultDocument, WorkflowLoopSummaryDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface DistCommandHandlerDependencies {
  ensureAdapterPreflight: (options: CliOptions, adapterRuntimePayload: AdapterRuntimeDocument) => void;
  execFileSync: typeof import('node:child_process').execFileSync;
  fail: (message: string) => void;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: CopilotPreflightReportDocument | ValidateOnboardingResultDocument | DocsValidationReportDocument | TaskGraphDocument | ExecutionStateDocument | TaskResultDocument | TaskClaimPayload | SimulatedModelRunDocument | AdapterTaskRunDocument | AdapterRunDocument | WorkflowLoopSummaryDocument | PlatformMigrationReportDocument | PlatformRunInitDocument | PlatformTaskLeaseDocument | PlatformTaskHeartbeatDocument | PlatformTaskStartDocument | PlatformLeaseExpirationSweepDocument | PlatformRunStateDocument) => void;
  readStructuredFile: (filePath: string) => any;
  rootDir: string;
  sanitizeStageName: (stage: string) => string;
  setExitCode: (code: number) => void;
  validateAdapterRuntimePayload: (adapterRuntimePayload: AdapterRuntimeDocument, runtimePath: string) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function buildDistCommandHandlers(dependencies: DistCommandHandlerDependencies): Record<string, (options: CliOptions) => void | Promise<void>> {
  return {
    'preflight-copilot-cli': (options) =>
      runPreflightCopilotCli(options as PreflightCliOptions, {
        execFileSync: dependencies.execFileSync,
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: (filePath) => dependencies.readStructuredFile(filePath) as AdapterRuntimeDocument,
        setExitCode: dependencies.setExitCode,
        validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload
      }),
    'validate-onboarding': (options) =>
      runValidateOnboarding(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        setExitCode: dependencies.setExitCode,
        writeJson: dependencies.writeJson
      }),
    'validate-docs': (options) =>
      runValidateDocs(options, {
        buildDocsValidationReport,
        printJson: dependencies.printJson,
        rootDir: dependencies.rootDir,
        setExitCode: dependencies.setExitCode,
        writeJson: dependencies.writeJson
      }),
    'generate-task-graph': (options) =>
      runGenerateTaskGraph(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        writeJson: dependencies.writeJson
      }),
    'migrate-platform-db': (options) =>
      runMigratePlatformDb(options, {
        createPlatformPool,
        fail: dependencies.fail,
        getDefaultPlatformMigrationsDir,
        migratePlatformDatabase,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'lease-next-platform-task': (options) =>
      runLeaseNextPlatformTask(options, {
        createPlatformPool,
        fail: dependencies.fail,
        leaseNextPlatformTask,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'heartbeat-platform-task': (options) =>
      runHeartbeatPlatformTask(options, {
        createPlatformPool,
        fail: dependencies.fail,
        heartbeatPlatformTask,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'start-platform-task': (options) =>
      runStartPlatformTask(options, {
        createPlatformPool,
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        startPlatformTask,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'expire-platform-leases': (options) =>
      runExpirePlatformLeases(options, {
        createPlatformPool,
        expirePlatformLeases,
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'get-platform-run-state': (options) =>
      runGetPlatformRunState(options, {
        createPlatformPool,
        fail: dependencies.fail,
        getPlatformRunState,
        printJson: dependencies.printJson,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'init-platform-run': (options) =>
      runInitPlatformRun(options, {
        createPlatformPool,
        createPlatformRunInitializationPlan,
        fail: dependencies.fail,
        persistPlatformRunPlan,
        printJson: dependencies.printJson,
        readStructuredFile: (filePath) => dependencies.readStructuredFile(filePath) as TaskGraphDocument,
        resolvePlatformDatabaseConfig,
        withPlatformTransaction,
        writeJson: dependencies.writeJson
      }),
    'init-execution-state': (options) =>
      runInitExecutionState(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: (filePath) => dependencies.readStructuredFile(filePath) as TaskGraphDocument,
        writeJson: dependencies.writeJson
      }),
    'update-execution-state': (options) =>
      runUpdateExecutionState(options, {
        fail: dependencies.fail,
        parseCsvOption: dependencies.parseCsvOption,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        writeJson: dependencies.writeJson
      }),
    'claim-next-task': (options) =>
      runClaimNextTask(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        writeJson: dependencies.writeJson
      }),
    'simulate-model-run': (options) =>
      runSimulateModelRun(options, {
        fail: dependencies.fail,
        getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
        parseCsvOption: dependencies.parseCsvOption,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        sanitizeStageName: dependencies.sanitizeStageName,
        validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
        writeJson: dependencies.writeJson
      }),
    'run-task-with-adapter': (options) =>
      runTaskWithAdapter(options, {
        ensureAdapterPreflight: dependencies.ensureAdapterPreflight,
        fail: dependencies.fail,
        getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
        parseCsvOption: dependencies.parseCsvOption,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        sanitizeStageName: dependencies.sanitizeStageName,
        validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
        writeJson: dependencies.writeJson
      }),
    'run-deterministic-task': (options) =>
      runDeterministicTaskCommand(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        writeJson: dependencies.writeJson
      }),
    'run-workflow-loop': (options) =>
      runWorkflowLoop(options, {
        ensureAdapterPreflight: dependencies.ensureAdapterPreflight,
        fail: dependencies.fail,
        getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
        parseCsvOption: dependencies.parseCsvOption,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        sanitizeStageName: dependencies.sanitizeStageName,
        validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
        writeJson: dependencies.writeJson
      }),
    'submit-task-result': (options) =>
      runSubmitTaskResult(options, {
        fail: dependencies.fail,
        printJson: dependencies.printJson,
        readStructuredFile: dependencies.readStructuredFile,
        writeJson: dependencies.writeJson
      })
  };
}
