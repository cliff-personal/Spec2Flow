import type { ReviewPolicy } from './review-policy.js';

export type DeliverablePriority = 'low' | 'medium' | 'high' | 'critical';

export interface DeliverableGapItem {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface RequirementSummaryImpactedService {
  name: string;
  role?: string;
  impact?: string[];
}

export interface RequirementSummary {
  generatedAt?: string;
  taskId: string;
  stage: 'requirements-analysis';
  goal: string;
  routeName?: string;
  summary: string;
  sources: string[];
  scope?: {
    inScope?: string[];
    outOfScope?: string[];
  };
  impactedServices?: RequirementSummaryImpactedService[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  repositoryGaps?: DeliverableGapItem[];
}

export interface ImplementationSummaryChangedFile {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  summary?: string;
}

export interface ImplementationSummary {
  generatedAt?: string;
  taskId: string;
  stage: 'code-implementation';
  goal: string;
  summary: string;
  changedFiles: ImplementationSummaryChangedFile[];
  validationCommands?: string[];
  diffRefs?: string[];
  notes?: string[];
  repositoryGaps?: DeliverableGapItem[];
}

export interface TestPlanCase {
  id: string;
  title: string;
  level: 'smoke' | 'integration' | 'regression' | 'edge';
  priority: DeliverablePriority;
  objective?: string;
  targetFiles?: string[];
}

export interface TestPlan {
  generatedAt?: string;
  taskId: string;
  stage: 'test-design';
  goal: string;
  summary: string;
  strategy?: string;
  cases: TestPlanCase[];
  risks?: string[];
  notes?: string[];
}

export interface TestCaseItem {
  id: string;
  title: string;
  priority: DeliverablePriority;
  automationCandidate: boolean;
  preconditions?: string[];
  steps: string[];
  expectedResults: string[];
  targetFiles?: string[];
}

export interface TestCases {
  generatedAt?: string;
  taskId: string;
  stage: 'test-design';
  goal: string;
  cases: TestCaseItem[];
}

export interface ExecutionReportCommandResult {
  command: string;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  exitCode?: number;
  evidenceRefs?: string[];
}

export interface ExecutionReportEvidence {
  id: string;
  path: string;
  kind: string;
}

export interface ExecutionReport {
  generatedAt?: string;
  taskId: string;
  stage: 'automated-execution';
  goal: string;
  summary: string;
  outcome: 'passed' | 'failed' | 'blocked' | 'partial';
  commands: ExecutionReportCommandResult[];
  findings?: string[];
  evidence?: ExecutionReportEvidence[];
  repositoryGaps?: DeliverableGapItem[];
}

export interface DefectSummary {
  generatedAt?: string;
  taskId: string;
  stage: 'defect-feedback';
  summary: string;
  failureType: 'requirements' | 'implementation' | 'test-design' | 'execution' | 'collaboration' | 'unknown';
  severity: DeliverablePriority;
  evidenceRefs: string[];
  recommendedAction: 'fix-implementation' | 'clarify-requirements' | 'expand-tests' | 'rerun-execution' | 'handoff-review';
  bugDraftPath?: string;
  repositoryGaps?: DeliverableGapItem[];
}

export interface CollaborationHandoff {
  generatedAt?: string;
  taskId: string;
  stage: 'collaboration';
  summary: string;
  handoffType: 'pull-request' | 'issue' | 'review' | 'status-update';
  readiness: 'ready' | 'blocked' | 'awaiting-approval';
  approvalRequired: boolean;
  artifactRefs: string[];
  nextActions: string[];
  reviewPolicy: ReviewPolicy;
}

export interface EvaluationSummary {
  generatedAt?: string;
  taskId: string;
  stage: 'evaluation';
  summary: string;
  decision: 'accepted' | 'rejected' | 'needs-repair';
  repairTargetStage?: 'requirements-analysis' | 'code-implementation' | 'test-design' | 'automated-execution';
  artifactRefs: string[];
  findings?: string[];
  nextActions?: string[];
}

export interface PublicationRecord {
  generatedAt?: string;
  publicationId: string;
  taskId: string;
  stage: 'collaboration';
  status: 'published' | 'approval-required' | 'blocked';
  publishMode: 'auto-commit' | 'manual-handoff';
  summary: string;
  handoffType: CollaborationHandoff['handoffType'];
  approvalRequired: boolean;
  autoCommitEnabled: boolean;
  branchName?: string;
  commitSha?: string;
  commitMessage?: string;
  prTitle?: string;
  prDraftPath?: string;
  gateReason?:
    | 'human-approval-required'
    | 'auto-commit-disabled'
    | 'missing-implementation-summary'
    | 'no-scoped-changes'
    | 'staged-changes-outside-scope'
    | 'publish-command-failed';
  artifactRefs: string[];
  nextActions: string[];
}
