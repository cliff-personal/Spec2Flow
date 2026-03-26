import { fail } from './fs-utils.js';
import type { ModelAdapterCapability } from '../types/task-claim.js';
import type {
  AdapterSupportName,
  TaskExecutorType,
  TaskRoleProfile,
  TaskStage
} from '../types/task-graph.js';

const supportedStageExecutors: Record<TaskStage, TaskExecutorType[]> = {
  'environment-preparation': ['controller-agent'],
  'requirements-analysis': ['requirements-agent'],
  'code-implementation': ['implementation-agent'],
  'test-design': ['test-design-agent'],
  'automated-execution': ['execution-agent'],
  'defect-feedback': ['defect-agent'],
  'collaboration': ['collaboration-agent'],
  'evaluation': ['evaluator-agent']
};

function assertStageExecutorPair(stage: TaskStage, executorType: TaskExecutorType): void {
  const allowedExecutors = supportedStageExecutors[stage];
  if (!allowedExecutors.includes(executorType)) {
    fail(`invalid stage to executor mapping: ${stage} cannot use ${executorType}`);
  }
}

export function buildTaskRoleProfile(stage: TaskStage, executorType: TaskExecutorType): TaskRoleProfile {
  assertStageExecutorPair(stage, executorType);

  switch (stage) {
    case 'environment-preparation':
      return {
        profileId: 'environment-preparation-controller',
        specialistRole: executorType,
        commandPolicy: 'bootstrap-only',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: true,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode'],
        expectedArtifacts: ['environment-preparation-report']
      };
    case 'requirements-analysis':
      return {
        profileId: 'requirements-analysis-specialist',
        specialistRole: executorType,
        commandPolicy: 'none',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: false,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode', 'longContext'],
        expectedArtifacts: ['requirements-summary']
      };
    case 'code-implementation':
      return {
        profileId: 'code-implementation-specialist',
        specialistRole: executorType,
        commandPolicy: 'safe-repo-commands',
        canReadRepository: true,
        canEditFiles: true,
        canRunCommands: true,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode', 'codeEditing'],
        expectedArtifacts: ['implementation-summary', 'code-diff']
      };
    case 'test-design':
      return {
        profileId: 'test-design-specialist',
        specialistRole: executorType,
        commandPolicy: 'safe-repo-commands',
        canReadRepository: true,
        canEditFiles: true,
        canRunCommands: true,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode', 'codeEditing'],
        expectedArtifacts: ['test-plan', 'test-cases']
      };
    case 'automated-execution':
      return {
        profileId: 'automated-execution-specialist',
        specialistRole: executorType,
        commandPolicy: 'verification-only',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: true,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode'],
        expectedArtifacts: ['execution-report', 'verification-evidence']
      };
    case 'defect-feedback':
      return {
        profileId: 'defect-feedback-specialist',
        specialistRole: executorType,
        commandPolicy: 'none',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: false,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode', 'longContext'],
        expectedArtifacts: ['defect-summary', 'bug-draft']
      };
    case 'collaboration':
      return {
        profileId: 'collaboration-specialist',
        specialistRole: executorType,
        commandPolicy: 'collaboration-only',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: false,
        canWriteArtifacts: true,
        canOpenCollaboration: true,
        requiredAdapterSupports: ['toolCalling', 'jsonMode'],
        expectedArtifacts: ['collaboration-handoff']
      };
    case 'evaluation':
      return {
        profileId: 'evaluation-specialist',
        specialistRole: executorType,
        commandPolicy: 'none',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: false,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling', 'jsonMode', 'longContext'],
        expectedArtifacts: ['evaluation-summary']
      };
  }
}

export function getMissingRequiredAdapterSupports(
  roleProfile: TaskRoleProfile,
  adapterCapability: ModelAdapterCapability | null | undefined
): AdapterSupportName[] {
  if (!adapterCapability) {
    return [];
  }

  const supports = adapterCapability.supports ?? {};
  return roleProfile.requiredAdapterSupports.filter((supportName) => supports[supportName] !== true);
}