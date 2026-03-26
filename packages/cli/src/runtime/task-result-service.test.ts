import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTaskResult } from './task-result-service.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];

function createRoleProfile(stage: TaskRoleProfile['specialistRole'], profileId: string, expectedArtifacts: string[], commandPolicy: TaskRoleProfile['commandPolicy']): TaskRoleProfile {
  return {
    profileId,
    specialistRole: stage,
    commandPolicy,
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts
  };
}

function createWorkflowDocuments(): { taskGraphPayload: TaskGraphDocument; executionStatePayload: ExecutionStateDocument; statePath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-task-result-'));
  tempDirs.push(tempDir);
  const statePath = path.join(tempDir, 'execution-state.json');

  return {
    statePath,
    taskGraphPayload: {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          {
            id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            title: 'Run checks',
            goal: 'Run checks',
            executorType: 'execution-agent',
            roleProfile: createRoleProfile('execution-agent', 'automated-execution-specialist', ['execution-report', 'verification-evidence'], 'verification-only'),
            status: 'ready'
          },
          {
            id: 'frontend-smoke--defect-feedback',
            stage: 'defect-feedback',
            title: 'Analyze defects',
            goal: 'Analyze defects',
            executorType: 'defect-agent',
            roleProfile: createRoleProfile('defect-agent', 'defect-feedback-specialist', ['defect-summary'], 'none'),
            status: 'pending',
            dependsOn: ['frontend-smoke--automated-execution']
          },
          {
            id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Collaborate',
            goal: 'Collaborate',
            executorType: 'collaboration-agent',
            roleProfile: createRoleProfile('collaboration-agent', 'collaboration-specialist', ['collaboration-handoff'], 'collaboration-only'),
            status: 'pending',
            dependsOn: ['frontend-smoke--defect-feedback']
          },
          {
            id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            title: 'Evaluate',
            goal: 'Evaluate',
            executorType: 'evaluator-agent',
            roleProfile: createRoleProfile('evaluator-agent', 'evaluation-specialist', ['evaluation-summary'], 'none'),
            status: 'pending',
            dependsOn: ['frontend-smoke--collaboration']
          }
        ]
      }
    },
    executionStatePayload: {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'running',
        tasks: [
          {
            taskId: 'frontend-smoke--automated-execution',
            status: 'ready',
            executor: 'execution-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--defect-feedback',
            status: 'pending',
            executor: 'defect-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--collaboration',
            status: 'pending',
            executor: 'collaboration-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--evaluation',
            status: 'pending',
            executor: 'evaluator-agent',
            artifactRefs: [],
            notes: []
          }
        ],
        artifacts: [],
        errors: []
      }
    }
  };
}

function createPhaseTwoWorkflowDocuments(): { taskGraphPayload: TaskGraphDocument; executionStatePayload: ExecutionStateDocument; statePath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-task-result-phase-two-'));
  tempDirs.push(tempDir);
  const statePath = path.join(tempDir, 'execution-state.json');

  return {
    statePath,
    taskGraphPayload: {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          {
            id: 'frontend-smoke--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze requirements',
            goal: 'Analyze requirements',
            executorType: 'requirements-agent',
            roleProfile: createRoleProfile('requirements-agent', 'requirements-analysis-specialist', ['requirements-summary'], 'none'),
            status: 'ready',
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--code-implementation',
            stage: 'code-implementation',
            title: 'Implement change',
            goal: 'Implement change',
            executorType: 'implementation-agent',
            roleProfile: createRoleProfile('implementation-agent', 'code-implementation-specialist', ['implementation-summary'], 'safe-repo-commands'),
            status: 'pending',
            dependsOn: ['frontend-smoke--requirements-analysis'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--test-design',
            stage: 'test-design',
            title: 'Design tests',
            goal: 'Design tests',
            executorType: 'test-design-agent',
            roleProfile: createRoleProfile('test-design-agent', 'test-design-specialist', ['test-plan', 'test-cases'], 'safe-repo-commands'),
            status: 'pending',
            dependsOn: ['frontend-smoke--code-implementation'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            title: 'Run checks',
            goal: 'Run checks',
            executorType: 'execution-agent',
            roleProfile: createRoleProfile('execution-agent', 'automated-execution-specialist', ['execution-report', 'verification-evidence'], 'verification-only'),
            status: 'pending',
            dependsOn: ['frontend-smoke--test-design'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--defect-feedback',
            stage: 'defect-feedback',
            title: 'Analyze defects',
            goal: 'Analyze defects',
            executorType: 'defect-agent',
            roleProfile: createRoleProfile('defect-agent', 'defect-feedback-specialist', ['defect-summary'], 'none'),
            status: 'pending',
            dependsOn: ['frontend-smoke--automated-execution'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Collaborate',
            goal: 'Collaborate',
            executorType: 'collaboration-agent',
            roleProfile: createRoleProfile('collaboration-agent', 'collaboration-specialist', ['collaboration-handoff'], 'collaboration-only'),
            status: 'pending',
            dependsOn: ['frontend-smoke--defect-feedback'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          },
          {
            id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            title: 'Evaluate delivery',
            goal: 'Evaluate delivery',
            executorType: 'evaluator-agent',
            roleProfile: createRoleProfile('evaluator-agent', 'evaluation-specialist', ['evaluation-summary'], 'none'),
            status: 'pending',
            dependsOn: ['frontend-smoke--collaboration'],
            reviewPolicy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true
            }
          }
        ]
      }
    },
    executionStatePayload: {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'running',
        tasks: [
          {
            taskId: 'frontend-smoke--requirements-analysis',
            status: 'ready',
            executor: 'requirements-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--code-implementation',
            status: 'pending',
            executor: 'implementation-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--test-design',
            status: 'pending',
            executor: 'test-design-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--automated-execution',
            status: 'pending',
            executor: 'execution-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--defect-feedback',
            status: 'pending',
            executor: 'defect-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--collaboration',
            status: 'pending',
            executor: 'collaboration-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--evaluation',
            status: 'pending',
            executor: 'evaluator-agent',
            artifactRefs: [],
            notes: []
          }
        ],
        artifacts: [],
        errors: []
      }
    }
  };
}

function writeEnvironmentPreparationReport(reportPath: string, repositoryRoot: string): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({
    environmentPreparationReport: {
      repository: {
        path: repositoryRoot,
        name: path.basename(repositoryRoot),
        type: 'repository'
      },
      summary: {
        status: 'ready',
        notes: ['sh scripts/local/setup_local_env.sh: failed (exit 127)']
      },
      detected: {
        docs: [],
        scripts: [],
        tests: [],
        ci: [],
        services: []
      },
      generated: [
        {
          path: 'spec2flow/outputs/execution/environment-preparation-report.json',
          kind: 'environment-preparation-report',
          generated: true
        }
      ],
      gaps: []
    }
  }, null, 2)}\n`, 'utf8');
}

function writeRequirementSummary(filePath: string, taskId: string): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'requirements-analysis',
    goal: 'Analyze requirements',
    summary: 'Requirements are scoped and summarized.',
    sources: ['docs/architecture.md']
  }, null, 2)}\n`, 'utf8');
}

function writeImplementationSummary(filePath: string, taskId: string, changedFilePath = 'packages/cli/src/runtime/task-result-service.ts'): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'code-implementation',
    goal: 'Implement change',
    summary: 'Applied the implementation update.',
    changedFiles: [
      {
        path: changedFilePath,
        changeType: 'modified'
      }
    ]
  }, null, 2)}\n`, 'utf8');
}

function writeTestPlan(filePath: string, taskId: string): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'test-design',
    goal: 'Design tests',
    summary: 'Covers the main smoke path.',
    cases: [
      {
        id: 'smoke-path',
        title: 'Smoke path',
        level: 'smoke',
        priority: 'high'
      }
    ]
  }, null, 2)}\n`, 'utf8');
}

function writeTestCases(filePath: string, taskId: string): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'test-design',
    goal: 'Design tests',
    cases: [
      {
        id: 'smoke-path',
        title: 'Smoke path',
        priority: 'high',
        automationCandidate: true,
        steps: [
          'Run the schema-backed test-design task.',
          'Collect the generated artifacts.'
        ],
        expectedResults: [
          'Both test-plan and test-cases artifacts are persisted.',
          'The automated-execution stage receives ready status.'
        ]
      }
    ]
  }, null, 2)}\n`, 'utf8');
}

function writeCollaborationHandoff(
  filePath: string,
  taskId: string,
  readiness: 'ready' | 'blocked' | 'awaiting-approval',
  options: {
    approvalRequired?: boolean;
    handoffType?: 'pull-request' | 'issue' | 'review' | 'status-update';
  } = {}
): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'collaboration',
    summary: 'The change is ready for a review handoff.',
    handoffType: options.handoffType ?? 'review',
    readiness,
    approvalRequired: options.approvalRequired ?? true,
    artifactRefs: ['implementation-summary', 'execution-report'],
    nextActions: ['Request human review'],
    reviewPolicy: {
      required: true,
      reviewAgentCount: 1,
      requireHumanApproval: options.approvalRequired ?? true
    }
  }, null, 2)}\n`, 'utf8');
}

function writeEvaluationSummary(
  filePath: string,
  taskId: string,
  decision: 'accepted' | 'rejected' | 'needs-repair',
  options: {
    findings?: string[];
    nextActions?: string[];
    repairTargetStage?: 'requirements-analysis' | 'code-implementation' | 'test-design' | 'automated-execution';
  } = {}
): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'evaluation',
    summary: decision === 'accepted'
      ? 'The route is accepted for workflow completion.'
      : 'The route cannot be accepted yet.',
    decision,
    artifactRefs: ['implementation-summary', 'execution-report', 'collaboration-handoff'],
    ...(options.repairTargetStage ? { repairTargetStage: options.repairTargetStage } : {}),
    ...(options.findings ? { findings: options.findings } : {}),
    nextActions: options.nextActions ?? (decision === 'accepted' ? ['Finalize the run.'] : ['Address the evaluation findings and resubmit.'])
  }, null, 2)}\n`, 'utf8');
}

function initGitRepo(repositoryRoot: string): void {
  fs.mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'spec2flow@example.com'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Spec2Flow Tests'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['add', 'src/app.ts'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot, encoding: 'utf8' });
}

function writeExecutionReport(filePath: string, taskId: string): void {
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'automated-execution',
    goal: 'Run checks',
    summary: 'Executed the validation path and collected evidence.',
    outcome: 'partial',
    commands: [
      {
        command: 'npm run test:unit',
        status: 'passed',
        exitCode: 0
      }
    ]
  }, null, 2)}\n`, 'utf8');
}

function writeDefectSummary(filePath: string, taskId: string, recommendedAction: 'fix-implementation' | 'clarify-requirements' | 'expand-tests' | 'rerun-execution' = 'fix-implementation'): void {
  let failureType: 'requirements' | 'test-design' | 'execution' | 'implementation' = 'implementation';
  if (recommendedAction === 'clarify-requirements') {
    failureType = 'requirements';
  } else if (recommendedAction === 'expand-tests') {
    failureType = 'test-design';
  } else if (recommendedAction === 'rerun-execution') {
    failureType = 'execution';
  }

  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'defect-feedback',
    summary: 'The defect can be auto-repaired by rerunning the owning stage.',
    failureType,
    severity: 'medium',
    evidenceRefs: ['execution-report'],
    recommendedAction
  }, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

function getTaskState(executionStatePayload: ExecutionStateDocument, index: number) {
  const taskState = executionStatePayload.executionState.tasks[index];
  if (!taskState) {
    throw new Error(`missing task state at index ${index}`);
  }

  return taskState;
}

describe('task-result-service', () => {
  it('routes to defect feedback when automated execution artifacts are missing', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createWorkflowDocuments();
    const executionReportPath = path.join(path.dirname(statePath), 'execution-report.json');
    writeExecutionReport(executionReportPath, 'frontend-smoke--automated-execution');

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--automated-execution',
      taskStatus: 'completed',
      notes: ['summary:execution-finished'],
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: executionReportPath,
          taskId: 'frontend-smoke--automated-execution'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('route-trigger:automated-execution');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('pending');
  });

  it('auto-skips defect feedback when automated execution artifact contract is satisfied', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createWorkflowDocuments();
    const executionReportPath = path.join(path.dirname(statePath), 'execution-report.json');
    writeExecutionReport(executionReportPath, 'frontend-smoke--automated-execution');

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--automated-execution',
      taskStatus: 'completed',
      notes: ['summary:execution-finished'],
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: executionReportPath,
          taskId: 'frontend-smoke--automated-execution'
        },
        {
          id: 'verification-evidence',
          kind: 'report',
          path: 'tmp/verification-evidence.json',
          taskId: 'frontend-smoke--automated-execution'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('route-auto-skip:defect-feedback');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('ready');
  });

  it('fails when a schema-backed artifact payload does not match its contract', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createWorkflowDocuments();
    const invalidExecutionReportPath = path.join(path.dirname(statePath), 'execution-report.json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fs.writeFileSync(invalidExecutionReportPath, '{"not":"an execution report"}\n', 'utf8');

    expect(() => applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--automated-execution',
      taskStatus: 'completed',
      notes: ['summary:execution-finished'],
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: invalidExecutionReportPath,
          taskId: 'frontend-smoke--automated-execution'
        }
      ],
      errors: []
    })).toThrow('artifact schema validation failed');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('routes requirements-analysis failures into defect-feedback and skips downstream implementation stages', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--requirements-analysis',
      taskStatus: 'failed',
      notes: ['summary:requirements-failed'],
      artifacts: [],
      errors: [
        {
          code: 'requirements-conflict',
          message: 'The requirement scope is inconsistent.',
          taskId: 'frontend-smoke--requirements-analysis'
        }
      ]
    });

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.notes).toContain('route-class:requirement-misunderstanding');
  });

  it('routes implementation failures into defect-feedback and skips downstream execution stages', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const implementationSummaryPath = path.join(path.dirname(statePath), 'implementation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'ready';
    writeImplementationSummary(implementationSummaryPath, 'frontend-smoke--code-implementation', 'src/app.ts');

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--code-implementation',
      taskStatus: 'blocked',
      notes: ['summary:implementation-blocked'],
      artifacts: [
        {
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: 'frontend-smoke--code-implementation'
        }
      ],
      errors: [
        {
          code: 'implementation-defect',
          message: 'The implementation failed validation.',
          taskId: 'frontend-smoke--code-implementation'
        }
      ]
    });

    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.notes).toContain('route-class:implementation-defect');
  });

  it('routes weak test-design outputs into defect-feedback when the test artifact contract is incomplete', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const testPlanPath = path.join(path.dirname(statePath), 'test-plan.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'ready';
    writeTestPlan(testPlanPath, 'frontend-smoke--test-design');

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--test-design',
      taskStatus: 'completed',
      notes: ['summary:test-design-partial'],
      artifacts: [
        {
          id: 'test-plan',
          kind: 'report',
          path: testPlanPath,
          taskId: 'frontend-smoke--test-design'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.notes).toContain('route-class:missing-or-weak-test-coverage');
  });

  it('advances test-design to automated-execution when both schema-backed test artifacts are valid', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const testPlanPath = path.join(path.dirname(statePath), 'test-plan.json');
    const testCasesPath = path.join(path.dirname(statePath), 'test-cases.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'ready';
    writeTestPlan(testPlanPath, 'frontend-smoke--test-design');
    writeTestCases(testCasesPath, 'frontend-smoke--test-design');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--test-design',
      taskStatus: 'completed',
      notes: ['summary:test-design-complete'],
      artifacts: [
        {
          id: 'test-plan',
          kind: 'report',
          path: testPlanPath,
          taskId: 'frontend-smoke--test-design'
        },
        {
          id: 'test-cases',
          kind: 'report',
          path: testCasesPath,
          taskId: 'frontend-smoke--test-design'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('completed');
    expect(receipt.taskResult.artifactContract.status).toBe('satisfied');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('pending');
    expect(executionStatePayload.executionState.currentStage).toBe('automated-execution');
  });

  it('rejects invalid test-cases artifacts before persisting a test-design result', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const testPlanPath = path.join(path.dirname(statePath), 'test-plan.json');
    const invalidTestCasesPath = path.join(path.dirname(statePath), 'test-cases.json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'ready';
    writeTestPlan(testPlanPath, 'frontend-smoke--test-design');
    fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(invalidTestCasesPath, `${JSON.stringify({
      taskId: 'frontend-smoke--test-design',
      stage: 'test-design',
      goal: 'Design tests',
      cases: [
        {
          id: 'missing-expected-results',
          title: 'Missing expected results',
          priority: 'critical',
          automationCandidate: true,
          steps: ['Submit an invalid test-cases artifact.']
        }
      ]
    }, null, 2)}\n`, 'utf8');

    expect(() => applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--test-design',
      taskStatus: 'completed',
      notes: ['summary:test-design-invalid'],
      artifacts: [
        {
          id: 'test-plan',
          kind: 'report',
          path: testPlanPath,
          taskId: 'frontend-smoke--test-design'
        },
        {
          id: 'test-cases',
          kind: 'report',
          path: invalidTestCasesPath,
          taskId: 'frontend-smoke--test-design'
        }
      ],
      errors: []
    })).toThrow('artifact schema validation failed');

    const persistedState = JSON.parse(fs.readFileSync(statePath, 'utf8')) as ExecutionStateDocument;
    expect(persistedState.executionState.tasks[2]?.status).toBe('ready');
    expect(persistedState.executionState.tasks[3]?.status).toBe('pending');
    expect(persistedState.executionState.artifacts).toHaveLength(0);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('blocks collaboration completion when human approval is still pending', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const collaborationHandoffPath = path.join(path.dirname(statePath), 'collaboration-handoff.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'ready';
    writeCollaborationHandoff(collaborationHandoffPath, 'frontend-smoke--collaboration', 'awaiting-approval');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--collaboration',
      taskStatus: 'completed',
      notes: ['summary:collaboration-handoff-prepared'],
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[5]?.notes).toContain('approval-gate:human-approval-required');
    expect(executionStatePayload.executionState.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('pending');
  });

  it('keeps publication side effects deferred until evaluator acceptance lands', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const repoRoot = path.dirname(statePath);
    const implementationSummaryPath = path.join(repoRoot, 'implementation-summary.json');
    const collaborationHandoffPath = path.join(repoRoot, 'collaboration-handoff.json');

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');
    writeImplementationSummary(implementationSummaryPath, 'frontend-smoke--code-implementation', 'src/app.ts');
    writeCollaborationHandoff(collaborationHandoffPath, 'frontend-smoke--collaboration', 'ready', {
      approvalRequired: false,
      handoffType: 'pull-request'
    });

    taskGraphPayload.taskGraph.tasks[5]!.reviewPolicy = {
      ...taskGraphPayload.taskGraph.tasks[5]!.reviewPolicy,
      requireHumanApproval: false,
      allowAutoCommit: true
    };

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'ready';
    executionStatePayload.executionState.artifacts = [
      {
        id: 'implementation-summary',
        kind: 'report',
        path: implementationSummaryPath,
        taskId: 'frontend-smoke--code-implementation'
      }
    ];

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--collaboration',
      taskStatus: 'completed',
      notes: ['summary:collaboration-handoff-prepared'],
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('ready');
    expect(executionStatePayload.executionState.status).toBe('running');
    expect(executionStatePayload.executionState.currentStage).toBe('evaluation');

    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).not.toMatch(/^spec2flow\//);
    const publicationRecordPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'publication-record.json');
    const prDraftPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'pr-draft.md');
    expect(fs.existsSync(publicationRecordPath)).toBe(false);
    expect(fs.existsSync(prDraftPath)).toBe(false);
  });

  it('publishes only after evaluator acceptance when auto-commit is allowed', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const repoRoot = path.dirname(statePath);
    const implementationSummaryPath = path.join(repoRoot, 'implementation-summary.json');
    const collaborationHandoffPath = path.join(repoRoot, 'collaboration-handoff.json');
    const evaluationSummaryPath = path.join(repoRoot, 'evaluation-summary.json');

    initGitRepo(repoRoot);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');
    writeImplementationSummary(implementationSummaryPath, 'frontend-smoke--code-implementation', 'src/app.ts');
    writeCollaborationHandoff(collaborationHandoffPath, 'frontend-smoke--collaboration', 'ready', {
      approvalRequired: false,
      handoffType: 'pull-request'
    });
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'accepted');

    taskGraphPayload.taskGraph.tasks[5]!.reviewPolicy = {
      ...taskGraphPayload.taskGraph.tasks[5]!.reviewPolicy,
      requireHumanApproval: false,
      allowAutoCommit: true
    };

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    executionStatePayload.executionState.artifacts = [
      {
        id: 'implementation-summary',
        kind: 'report',
        path: implementationSummaryPath,
        taskId: 'frontend-smoke--code-implementation'
      },
      {
        id: 'collaboration-handoff',
        kind: 'report',
        path: collaborationHandoffPath,
        taskId: 'frontend-smoke--collaboration'
      }
    ];

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-accepted'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('completed');
    expect(receipt.taskResult.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(['publication-record', 'pr-draft']));
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('evaluation-gate:accepted');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('publication-status:published');
    expect(executionStatePayload.executionState.status).toBe('completed');

    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).toMatch(/^spec2flow\/frontend-smoke-/);
    const publicationRecordPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'publication-record.json');
    const prDraftPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'pr-draft.md');
    expect(fs.existsSync(publicationRecordPath)).toBe(true);
    expect(fs.existsSync(prDraftPath)).toBe(true);
  });

  it('requeues the owning implementation stage after defect-feedback completes when auto-repair policy allows it', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const implementationSummaryPath = path.join(path.dirname(statePath), 'implementation-summary.json');
    const defectSummaryPath = path.join(path.dirname(statePath), 'defect-summary.json');

    taskGraphPayload.taskGraph.tasks.forEach((task) => {
      if (!task.reviewPolicy) {
        throw new Error('missing review policy');
      }
      task.reviewPolicy = {
        ...task.reviewPolicy,
        maxAutoRepairAttempts: 2
      };
    });

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'blocked';
    getTaskState(executionStatePayload, 2).status = 'skipped';
    getTaskState(executionStatePayload, 3).status = 'skipped';
    getTaskState(executionStatePayload, 4).status = 'ready';
    getTaskState(executionStatePayload, 4).notes = [
      'route-trigger:code-implementation',
      'route-class:implementation-defect',
      'route-origin:frontend-smoke--code-implementation'
    ];
    getTaskState(executionStatePayload, 5).status = 'pending';

    writeImplementationSummary(implementationSummaryPath, 'frontend-smoke--code-implementation');
    writeDefectSummary(defectSummaryPath, 'frontend-smoke--defect-feedback', 'fix-implementation');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--defect-feedback',
      taskStatus: 'completed',
      notes: ['summary:defect-analysis-complete'],
      artifacts: [
        {
          id: 'defect-summary',
          kind: 'report',
          path: defectSummaryPath,
          taskId: 'frontend-smoke--defect-feedback'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('auto-repair-attempt:1');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('pending');
    expect(executionStatePayload.executionState.currentStage).toBe('code-implementation');
  });

  it('escalates to collaboration when the auto-repair budget is exhausted', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const defectSummaryPath = path.join(path.dirname(statePath), 'defect-summary.json');

    taskGraphPayload.taskGraph.tasks.forEach((task) => {
      if (!task.reviewPolicy) {
        throw new Error('missing review policy');
      }
      task.reviewPolicy = {
        ...task.reviewPolicy,
        maxAutoRepairAttempts: 1
      };
    });

    getTaskState(executionStatePayload, 1).status = 'blocked';
    getTaskState(executionStatePayload, 1).notes = ['auto-repair-attempt:1'];
    getTaskState(executionStatePayload, 2).status = 'skipped';
    getTaskState(executionStatePayload, 3).status = 'skipped';
    getTaskState(executionStatePayload, 4).status = 'ready';
    getTaskState(executionStatePayload, 4).notes = [
      'route-trigger:code-implementation',
      'route-class:implementation-defect',
      'route-origin:frontend-smoke--code-implementation'
    ];
    getTaskState(executionStatePayload, 5).status = 'pending';
    writeDefectSummary(defectSummaryPath, 'frontend-smoke--defect-feedback', 'fix-implementation');

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--defect-feedback',
      taskStatus: 'completed',
      notes: ['summary:defect-analysis-complete'],
      artifacts: [
        {
          id: 'defect-summary',
          kind: 'report',
          path: defectSummaryPath,
          taskId: 'frontend-smoke--defect-feedback'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[4]?.notes).toContain('auto-repair-escalated:budget-exhausted');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[5]?.notes).toContain('auto-repair-escalated:budget-exhausted');
    expect(executionStatePayload.executionState.currentStage).toBe('collaboration');
  });

  it('reroutes evaluator needs-repair back into defect-feedback automatically', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'needs-repair');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-requested-repair'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.notes).toContain('route-trigger:evaluation');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[5]?.notes).toContain('evaluation-reset:frontend-smoke--evaluation');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('evaluation-gate:needs-repair-rerouted');
    expect(executionStatePayload.executionState.status).toBe('running');
    expect(executionStatePayload.executionState.currentStage).toBe('defect-feedback');
  });

  it('maps evaluator nextActions to code-implementation as a precise repair target', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'needs-repair', {
      nextActions: ['Return to code implementation and fix the validation bug before resubmitting.']
    });

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-requested-code-fix'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('route-trigger:evaluation');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('route-target-stage:code-implementation');
    expect(executionStatePayload.executionState.status).toBe('running');
    expect(executionStatePayload.executionState.currentStage).toBe('code-implementation');
  });

  it('prefers explicit repairTargetStage over keyword inference when evaluator requests repair', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'needs-repair', {
      repairTargetStage: 'automated-execution',
      nextActions: ['Return to code implementation and fix the validation bug before resubmitting.'],
      findings: ['Coverage is weak, but the main issue is an execution failure.']
    });

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-requested-explicit-execution-rerun'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('route-target-stage:automated-execution');
    expect(executionStatePayload.executionState.currentStage).toBe('automated-execution');
  });

  it('maps evaluator findings to test-design when coverage expansion is requested', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'needs-repair', {
      findings: ['Coverage is weak around the failure path and assertions are incomplete.']
    });

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-requested-test-expansion'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[3]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('pending');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('route-target-stage:test-design');
    expect(executionStatePayload.executionState.status).toBe('running');
    expect(executionStatePayload.executionState.currentStage).toBe('test-design');
  });

  it('blocks workflow completion when evaluator rejects the route outright', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'rejected');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-rejected'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[4]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[5]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('evaluation-gate:not-accepted');
    expect(executionStatePayload.executionState.status).toBe('blocked');
  });

  it('completes the workflow only after evaluator acceptance lands', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createPhaseTwoWorkflowDocuments();
    const evaluationSummaryPath = path.join(path.dirname(statePath), 'evaluation-summary.json');

    getTaskState(executionStatePayload, 0).status = 'completed';
    getTaskState(executionStatePayload, 1).status = 'completed';
    getTaskState(executionStatePayload, 2).status = 'completed';
    getTaskState(executionStatePayload, 3).status = 'completed';
    getTaskState(executionStatePayload, 4).status = 'completed';
    getTaskState(executionStatePayload, 5).status = 'completed';
    getTaskState(executionStatePayload, 6).status = 'ready';
    writeEvaluationSummary(evaluationSummaryPath, 'frontend-smoke--evaluation', 'accepted');

    const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--evaluation',
      taskStatus: 'completed',
      notes: ['summary:evaluation-accepted'],
      artifacts: [
        {
          id: 'evaluation-summary',
          kind: 'report',
          path: evaluationSummaryPath,
          taskId: 'frontend-smoke--evaluation'
        }
      ],
      errors: []
    });

    expect(receipt.taskResult.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[6]?.status).toBe('completed');
    expect(executionStatePayload.executionState.tasks[6]?.notes).toContain('evaluation-gate:accepted');
    expect(executionStatePayload.executionState.status).toBe('completed');
  });

  it('resolves schema-backed artifact paths from the repository root for nested .spec2flow worker state', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-platform-worker-state-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'repo');
    const statePath = path.join(repoRoot, '.spec2flow', 'runtime', 'platform-workers', 'run-1', 'environment-preparation', 'execution-state.json');
    const reportPath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'environment-preparation-report.json');

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    writeEnvironmentPreparationReport(reportPath, repoRoot);

    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'platform-worker-graph',
        workflowName: 'platform-worker-flow',
        tasks: [
          {
            id: 'environment-preparation',
            stage: 'environment-preparation',
            title: 'Prepare repository environment',
            goal: 'Bootstrap the repository',
            executorType: 'controller-agent',
            roleProfile: createRoleProfile('controller-agent', 'environment-preparation-controller', ['environment-preparation-report'], 'bootstrap-only'),
            status: 'ready'
          }
        ]
      }
    };
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'platform-worker-flow',
        status: 'running',
        tasks: [
          {
            taskId: 'environment-preparation',
            status: 'in-progress',
            executor: 'controller-agent',
            artifactRefs: [],
            notes: []
          }
        ],
        artifacts: [],
        errors: []
      }
    };

    expect(() => applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'environment-preparation',
      taskStatus: 'blocked',
      notes: ['summary:bootstrap-blocked'],
      artifacts: [
        {
          id: 'environment-preparation-report',
          kind: 'report',
          path: 'spec2flow/outputs/execution/environment-preparation-report.json',
          taskId: 'environment-preparation'
        }
      ],
      errors: []
    })).not.toThrow();

    expect(executionStatePayload.executionState.tasks[0]?.status).toBe('blocked');
    expect(executionStatePayload.executionState.artifacts).toHaveLength(1);
  });
});
