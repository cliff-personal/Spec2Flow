import type { PlatformObservabilityReadModel } from './platform-observability.js';
import type {
  PlatformProjectRecord,
  PlatformRunRecord,
  PlatformRunStateSnapshot,
  PlatformRunWorkspaceRecord,
  PlatformTaskRecord,
  PlatformWorkspacePolicy
} from './platform-persistence.js';

export interface PlatformControlPlaneRunListItem {
  runId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryRootPath: string;
  projectId?: string | null;
  projectName?: string | null;
  workspaceRootPath?: string | null;
  workflowName: string;
  requirement?: string | undefined;
  status: PlatformRunRecord['status'];
  paused: boolean;
  currentStage: PlatformRunRecord['currentStage'];
  riskLevel: PlatformRunRecord['riskLevel'];
  branchName?: string | null;
  baseBranch?: string | null;
  worktreeMode?: PlatformRunWorkspaceRecord['worktreeMode'] | null;
  worktreePath?: string | null;
  provisioningStatus?: PlatformRunWorkspaceRecord['provisioningStatus'] | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PlatformControlPlaneRunDetail {
  runState: PlatformRunStateSnapshot;
  platformObservability: PlatformObservabilityReadModel;
}

export interface PlatformControlPlaneProjectListItem {
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  repositoryRootPath: string;
  workspaceRootPath: string;
  projectPath?: string | null;
  topologyPath?: string | null;
  riskPath?: string | null;
  defaultBranch?: string | null;
  branchPrefix?: string | null;
  workspacePolicy: PlatformWorkspacePolicy;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PlatformControlPlaneProjectRegistrationRequest {
  repositoryRootPath: string;
  projectId?: string;
  projectName?: string;
  workspaceRootPath?: string;
  projectPath?: string;
  topologyPath?: string;
  riskPath?: string;
  repositoryId?: string;
  repositoryName?: string;
  defaultBranch?: string;
  branchPrefix?: string;
  workspacePolicy?: {
    allowedReadGlobs?: string[];
    allowedWriteGlobs?: string[];
    forbiddenWriteGlobs?: string[];
  };
}

export interface PlatformControlPlaneProjectRegistrationResult {
  schema: string;
  repository: {
    repositoryId: string;
    repositoryName: string;
    repositoryRootPath: string;
    defaultBranch?: string | null;
  };
  project: PlatformProjectRecord;
}

export interface PlatformControlPlaneTaskList {
  tasks: PlatformTaskRecord[];
}

export interface PlatformControlPlaneArtifactCatalogStore {
  mode: 'local' | 'remote-catalog';
  provider?: string;
  publicBaseUrl?: string;
  keyPrefix?: string;
  uploadConfigured?: boolean;
  uploadMethod?: 'PUT' | 'POST';
}

export interface PlatformControlPlaneArtifactCatalogArtifact {
  id: string;
  path: string;
  kind: string;
  category: string;
  contentType?: string;
  storage?: {
    mode: 'local' | 'remote-catalog';
    provider?: string;
    objectKey?: string;
    remoteUrl?: string;
  };
  upload?: {
    status: 'pending' | 'uploaded' | 'skipped' | 'failed';
    uploadedAt?: string;
    httpStatus?: number;
    error?: string;
  };
}

export interface PlatformControlPlaneArtifactCatalog {
  generatedAt?: string;
  taskId: string;
  stage: 'automated-execution';
  summary: string;
  store: PlatformControlPlaneArtifactCatalogStore;
  artifacts: PlatformControlPlaneArtifactCatalogArtifact[];
}

export interface PlatformControlPlaneTaskArtifactCatalog {
  runId: string;
  taskId: string;
  artifactId: string;
  path: string;
  catalog: PlatformControlPlaneArtifactCatalog;
}

export interface PlatformControlPlaneTaskActionResult {
  action: 'retry' | 'approve' | 'reject';
  runId: string;
  taskId: string;
  taskStatus: PlatformTaskRecord['status'];
  runStatus: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
  publicationId?: string | null;
  publicationStatus?: string | null;
}

export interface PlatformControlPlaneRunActionResult {
  action: 'pause' | 'resume';
  runId: string;
  runStatus: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
  paused: boolean;
}

export interface PlatformControlPlaneRunSubmissionRequest {
  repositoryRootPath: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  topologyPath?: string;
  riskPath?: string;
  workspaceRootPath?: string;
  branchPrefix?: string;
  worktreeRootPath?: string;
  worktreeMode?: 'managed' | 'none';
  workspacePolicy?: {
    allowedReadGlobs?: string[];
    allowedWriteGlobs?: string[];
    forbiddenWriteGlobs?: string[];
  };
  requirement?: string;
  requirementPath?: string;
  changedFiles?: string[];
  repositoryId?: string;
  repositoryName?: string;
  defaultBranch?: string;
  runId?: string;
}

export interface PlatformControlPlaneRunSubmissionResult {
  platformRun: {
    schema: string;
    projectId: string;
    projectName: string;
    repositoryId: string;
    repositoryName: string;
    repositoryRootPath: string;
    workspaceRootPath: string;
    runId: string;
    workflowName: string;
    taskCount: number;
    eventCount: number;
    artifactCount: number;
    status: PlatformRunRecord['status'];
    currentStage: PlatformRunRecord['currentStage'];
    riskLevel: PlatformRunRecord['riskLevel'];
    branchName?: string | null;
    baseBranch?: string | null;
    worktreeMode: 'managed' | 'none';
    worktreePath: string;
    provisioningStatus: 'provisioned' | 'skipped';
  };
  taskGraph: {
    graphId: string;
    routeSelectionMode: string | null;
    selectedRoutes: string[];
    changedFiles: string[];
    requirementPath: string | null;
  };
  validatorResult: {
    status: 'passed' | 'passed-with-warnings';
    summary: {
      passed: number;
      warnings: number;
      failed: number;
    };
  };
}

export interface PlatformControlPlaneRunListDocument {
  runs: PlatformControlPlaneRunListItem[];
}

export interface PlatformControlPlaneRunDetailDocument {
  run: PlatformControlPlaneRunDetail;
}

export interface PlatformControlPlaneTaskActionDocument {
  action: PlatformControlPlaneTaskActionResult;
}

export interface PlatformControlPlaneRunActionDocument {
  action: PlatformControlPlaneRunActionResult;
}

export interface PlatformControlPlaneRunSubmissionDocument {
  runSubmission: PlatformControlPlaneRunSubmissionResult;
}

export interface PlatformControlPlaneProjectListDocument {
  projects: PlatformControlPlaneProjectListItem[];
}

export interface PlatformControlPlaneProjectRegistrationDocument {
  projectRegistration: PlatformControlPlaneProjectRegistrationResult;
}

export interface PlatformControlPlaneTaskArtifactCatalogDocument {
  artifactCatalog: PlatformControlPlaneTaskArtifactCatalog;
}

export interface PlatformControlPlaneErrorDocument {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
