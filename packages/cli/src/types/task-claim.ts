import type {
  ArtifactRef,
  ErrorItem,
  ExecutionStatus,
  ProviderSessionMetadata
} from './execution-state.js';
import type {
  RiskLevel,
  TaskExecutorType,
  TaskStage
} from './task-graph.js';
import type { ReviewPolicy } from './review-policy.js';

export interface AdapterCapabilitySupports {
  toolCalling?: boolean;
  jsonMode?: boolean;
  longContext?: boolean;
  multiAgentDispatch?: boolean;
  codeEditing?: boolean;
  browserAutomation?: boolean;
  streaming?: boolean;
  functionRetryHints?: boolean;
}

export interface AdapterCapabilityLimits {
  maxContextTokens?: number;
  maxParallelAgents?: number;
  maxToolCallsPerTurn?: number;
}

export interface ModelAdapterCapability {
  name: string;
  provider: string;
  supports?: AdapterCapabilitySupports;
  limits?: AdapterCapabilityLimits;
  fallbacks?: string[];
}

export interface TaskClaimRepositoryContext {
  requirementRef?: string | null;
  requirementText?: string | null;
  routeSelectionMode?: string | null;
  selectedRoutes?: string[];
  projectAdapterRef?: string | null;
  topologyRef?: string | null;
  riskPolicyRef?: string | null;
  docs: string[];
  changedFiles: string[];
  targetFiles: string[];
  verifyCommands: string[];
  taskInputs: Record<string, unknown>;
}

export interface TaskClaimRuntimeContext {
  executionStateRef: string;
  taskGraphRef: string;
  currentRunStatus: ExecutionStatus;
  currentStage?: TaskStage;
  provider?: ProviderSessionMetadata | null;
  attempt: number;
  artifactRefs: string[];
  taskArtifacts: ArtifactRef[];
  taskErrors: ErrorItem[];
  artifactsDir?: string | null;
  dependsOn: string[];
}

export interface TaskClaim {
  runId: string;
  workflowName: string;
  taskId: string;
  title: string;
  stage: TaskStage;
  goal: string;
  executorType: TaskExecutorType;
  riskLevel?: RiskLevel;
  reviewPolicy?: ReviewPolicy;
  modelAdapterCapabilityRef?: string | null;
  modelAdapterCapability?: ModelAdapterCapability | null;
  repositoryContext: TaskClaimRepositoryContext;
  runtimeContext: TaskClaimRuntimeContext;
  instructions: string[];
}

export interface TaskClaimPayload {
  taskClaim: TaskClaim | null;
  message?: string;
  runId?: string;
  workflowName?: string;
  status?: ExecutionStatus;
}
