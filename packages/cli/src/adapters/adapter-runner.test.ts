import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { executeTaskRun } from './adapter-runner.js';
import type { TaskClaimPayload } from '../types/task-claim.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];

function createRoleProfile(commandPolicy: TaskRoleProfile['commandPolicy'], canRunCommands: boolean, canEditFiles: boolean): TaskRoleProfile {
  return {
    profileId: 'requirements-analysis-specialist',
    specialistRole: 'requirements-agent',
    commandPolicy,
    canReadRepository: true,
    canEditFiles,
    canRunCommands,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts: ['requirements-summary']
  };
}

function writeRequirementSummaryArtifact(filePath: string, taskId: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId,
    stage: 'requirements-analysis',
    goal: 'Analyze',
    summary: 'Summarize the scope and acceptance criteria for the claimed task.',
    sources: ['docs/architecture.md']
  }, null, 2)}\n`, 'utf8');
}

function createTestFiles(commandPolicy: TaskRoleProfile['commandPolicy'], canRunCommands: boolean): {
  statePath: string;
  taskGraphPath: string;
  claimPayload: TaskClaimPayload;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-adapter-runner-'));
  tempDirs.push(tempDir);

  const executionStatePayload: ExecutionStateDocument = {
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
        }
      ],
      artifacts: [],
      errors: []
    }
  };
  const taskGraphPayload: TaskGraphDocument = {
    taskGraph: {
      id: 'workflow',
      workflowName: 'workflow',
      tasks: [
        {
          id: 'frontend-smoke--requirements-analysis',
          stage: 'requirements-analysis',
          title: 'Analyze',
          goal: 'Analyze',
          executorType: 'requirements-agent',
          roleProfile: createRoleProfile(commandPolicy, canRunCommands, false),
          status: 'ready'
        }
      ]
    }
  };
  const statePath = path.join(tempDir, 'execution-state.json');
  const taskGraphPath = path.join(tempDir, 'task-graph.json');

  fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

  return {
    statePath,
    taskGraphPath,
    claimPayload: {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--requirements-analysis',
        title: 'Analyze',
        stage: 'requirements-analysis',
        goal: 'Analyze',
        executorType: 'requirements-agent',
        roleProfile: createRoleProfile(commandPolicy, canRunCommands, false),
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: ['npm run validate:synapse-example'],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          dependsOn: []
        },
        instructions: []
      }
    }
  };
}

function createEnvironmentPreparationTestFiles(): {
  statePath: string;
  taskGraphPath: string;
  claimPayload: TaskClaimPayload;
  repositoryRoot: string;
  reportPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-environment-preparation-'));
  const repositoryRoot = path.join(tempDir, 'repo');
  const artifactsDir = path.join(repositoryRoot, 'spec2flow', 'outputs', 'execution');
  const reportPath = path.join(artifactsDir, 'environment-preparation-report.json');
  tempDirs.push(tempDir);

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({
    environmentPreparationReport: {
      repository: {
        path: repositoryRoot,
        name: 'repo',
        type: 'repository'
      },
      summary: {
        status: 'ready',
        notes: ['sh scripts/local/setup_local_env.sh: passed']
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
          path: reportPath,
          kind: 'environment-preparation-report',
          generated: true
        }
      ],
      gaps: []
    }
  }, null, 2)}\n`, 'utf8');

  const executionStatePayload: ExecutionStateDocument = {
    executionState: {
      runId: 'run-1',
      workflowName: 'workflow',
      status: 'running',
      tasks: [
        {
          taskId: 'environment-preparation',
          status: 'ready',
          executor: 'controller-agent',
          artifactRefs: [],
          notes: []
        }
      ],
      artifacts: [],
      errors: []
    }
  };
  const taskGraphPayload: TaskGraphDocument = {
    taskGraph: {
      id: 'workflow',
      workflowName: 'workflow',
      tasks: [
        {
          id: 'environment-preparation',
          stage: 'environment-preparation',
          title: 'Prepare environment',
          goal: 'Prepare environment',
          executorType: 'controller-agent',
          roleProfile: {
            profileId: 'environment-preparation-controller',
            specialistRole: 'controller-agent',
            commandPolicy: 'bootstrap-only',
            canReadRepository: true,
            canEditFiles: false,
            canRunCommands: true,
            canWriteArtifacts: true,
            canOpenCollaboration: false,
            requiredAdapterSupports: [],
            expectedArtifacts: ['environment-preparation-report']
          },
          status: 'ready',
          verifyCommands: ['sh scripts/local/setup_local_env.sh']
        }
      ]
    }
  };
  const statePath = path.join(repositoryRoot, 'execution-state.json');
  const taskGraphPath = path.join(repositoryRoot, 'task-graph.json');

  fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

  return {
    statePath,
    taskGraphPath,
    repositoryRoot,
    reportPath,
    claimPayload: {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'environment-preparation',
        title: 'Prepare environment',
        stage: 'environment-preparation',
        goal: 'Prepare environment',
        executorType: 'controller-agent',
        roleProfile: {
          profileId: 'environment-preparation-controller',
          specialistRole: 'controller-agent',
          commandPolicy: 'bootstrap-only',
          canReadRepository: true,
          canEditFiles: false,
          canRunCommands: true,
          canWriteArtifacts: true,
          canOpenCollaboration: false,
          requiredAdapterSupports: [],
          expectedArtifacts: ['environment-preparation-report']
        },
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: ['sh scripts/local/setup_local_env.sh'],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          dependsOn: []
        },
        instructions: []
      }
    }
  };
}

function createCodeImplementationTestFiles(): {
  statePath: string;
  taskGraphPath: string;
  claimPayload: TaskClaimPayload;
  repositoryRoot: string;
  editedFilePath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-implementation-runner-'));
  const repositoryRoot = path.join(tempDir, 'repo');
  const editedFilePath = path.join(repositoryRoot, 'src', 'app.ts');
  const artifactsDir = path.join(repositoryRoot, '.spec2flow', 'generated', 'execution', 'schema-contracts');
  tempDirs.push(tempDir);

  fs.mkdirSync(path.dirname(editedFilePath), { recursive: true });
  fs.writeFileSync(editedFilePath, 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'spec2flow@example.com'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Spec2Flow Tests'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['add', 'src/app.ts'], { cwd: repositoryRoot, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot, encoding: 'utf8' });
  fs.writeFileSync(editedFilePath, 'export const value = 2;\n', 'utf8');

  const executionStatePayload: ExecutionStateDocument = {
    executionState: {
      runId: 'run-1',
      workflowName: 'workflow',
      status: 'running',
      tasks: [
        {
          taskId: 'frontend-smoke--code-implementation',
          status: 'ready',
          executor: 'implementation-agent',
          artifactRefs: [],
          notes: []
        }
      ],
      artifacts: [],
      errors: []
    }
  };
  const taskGraphPayload: TaskGraphDocument = {
    taskGraph: {
      id: 'workflow',
      workflowName: 'workflow',
      tasks: [
        {
          id: 'frontend-smoke--code-implementation',
          stage: 'code-implementation',
          title: 'Implement',
          goal: 'Implement',
          executorType: 'implementation-agent',
          roleProfile: {
            profileId: 'code-implementation-specialist',
            specialistRole: 'implementation-agent',
            commandPolicy: 'safe-repo-commands',
            canReadRepository: true,
            canEditFiles: true,
            canRunCommands: true,
            canWriteArtifacts: true,
            canOpenCollaboration: false,
            requiredAdapterSupports: [],
            expectedArtifacts: ['implementation-summary', 'code-diff']
          },
          status: 'ready'
        }
      ]
    }
  };
  const statePath = path.join(repositoryRoot, 'execution-state.json');
  const taskGraphPath = path.join(repositoryRoot, 'task-graph.json');

  fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

  return {
    statePath,
    taskGraphPath,
    repositoryRoot,
    editedFilePath,
    claimPayload: {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--code-implementation',
        title: 'Implement',
        stage: 'code-implementation',
        goal: 'Implement',
        executorType: 'implementation-agent',
        roleProfile: {
          profileId: 'code-implementation-specialist',
          specialistRole: 'implementation-agent',
          commandPolicy: 'safe-repo-commands',
          canReadRepository: true,
          canEditFiles: true,
          canRunCommands: true,
          canWriteArtifacts: true,
          canOpenCollaboration: false,
          requiredAdapterSupports: [],
          expectedArtifacts: ['implementation-summary', 'code-diff']
        },
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: ['src/app.ts'],
          verifyCommands: [],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          artifactsDir,
          dependsOn: []
        },
        instructions: []
      }
    }
  };
}

function createCollaborationTestFiles(): {
  statePath: string;
  taskGraphPath: string;
  claimPayload: TaskClaimPayload;
  repositoryRoot: string;
  artifactsDir: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-collaboration-runner-'));
  const repositoryRoot = path.join(tempDir, 'repo');
  const artifactsDir = path.join(repositoryRoot, '.spec2flow', 'generated', 'execution', 'schema-contracts');
  tempDirs.push(tempDir);

  fs.mkdirSync(repositoryRoot, { recursive: true });

  const executionStatePayload: ExecutionStateDocument = {
    executionState: {
      runId: 'run-1',
      workflowName: 'workflow',
      status: 'running',
      tasks: [
        {
          taskId: 'frontend-smoke--collaboration',
          status: 'ready',
          executor: 'collaboration-agent',
          artifactRefs: [],
          notes: []
        }
      ],
      artifacts: [],
      errors: []
    }
  };
  const taskGraphPayload: TaskGraphDocument = {
    taskGraph: {
      id: 'workflow',
      workflowName: 'workflow',
      tasks: [
        {
          id: 'frontend-smoke--collaboration',
          stage: 'collaboration',
          title: 'Collaborate',
          goal: 'Prepare review handoff',
          executorType: 'collaboration-agent',
          roleProfile: {
            profileId: 'collaboration-specialist',
            specialistRole: 'collaboration-agent',
            commandPolicy: 'collaboration-only',
            canReadRepository: true,
            canEditFiles: false,
            canRunCommands: false,
            canWriteArtifacts: true,
            canOpenCollaboration: true,
            requiredAdapterSupports: [],
            expectedArtifacts: ['collaboration-handoff']
          },
          reviewPolicy: {
            required: true,
            reviewAgentCount: 1,
            requireHumanApproval: true
          },
          status: 'ready'
        }
      ]
    }
  };
  const statePath = path.join(repositoryRoot, 'execution-state.json');
  const taskGraphPath = path.join(repositoryRoot, 'task-graph.json');

  fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

  return {
    statePath,
    taskGraphPath,
    repositoryRoot,
    artifactsDir,
    claimPayload: {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--collaboration',
        title: 'Collaborate',
        stage: 'collaboration',
        goal: 'Prepare review handoff',
        executorType: 'collaboration-agent',
        roleProfile: {
          profileId: 'collaboration-specialist',
          specialistRole: 'collaboration-agent',
          commandPolicy: 'collaboration-only',
          canReadRepository: true,
          canEditFiles: false,
          canRunCommands: false,
          canWriteArtifacts: true,
          canOpenCollaboration: true,
          requiredAdapterSupports: [],
          expectedArtifacts: ['collaboration-handoff']
        },
        reviewPolicy: {
          required: true,
          reviewAgentCount: 1,
          requireHumanApproval: true
        },
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: [],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          artifactsDir,
          dependsOn: []
        },
        instructions: []
      }
    }
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('adapter-runner', () => {
  it('keeps simulated requirements-analysis output completed when no forbidden activity is reported', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    writeRequirementSummaryArtifact(requirementsArtifactPath, 'frontend-smoke--requirements-analysis');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      summary: 'requirements-ready',
      'add-artifacts': `requirements-summary|report|${requirementsArtifactPath}`
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('completed');
  });

  it('ignores non-repository edited files when enforcing role policy', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const externalPlanPath = path.join(os.homedir(), '.copilot', 'session-state', 'session-1', 'plan.md');
    const adapterScript = `process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"requirements-ready",notes:[],activity:{commands:[],editedFiles:[${JSON.stringify(externalPlanPath)}],artifactFiles:[${JSON.stringify(requirementsArtifactPath)}],collaborationActions:[]},artifacts:[{id:"requirements-summary",kind:"report",path:${JSON.stringify(requirementsArtifactPath)}}],errors:[]}}))`;
    writeRequirementSummaryArtifact(requirementsArtifactPath, 'frontend-smoke--requirements-analysis');
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'external-plan-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: tempDir,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('completed');
    expect(result.adapterRun.activity.editedFiles).toEqual([]);
  });

  it('treats activity artifact files as artifact refs for contract satisfaction', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterScript = `process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"requirements-ready",notes:[],activity:{commands:[],editedFiles:[],artifactFiles:[${JSON.stringify(requirementsArtifactPath)}],collaborationActions:[]},artifacts:[],errors:[]}}))`;
    writeRequirementSummaryArtifact(requirementsArtifactPath, 'frontend-smoke--requirements-analysis');
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'artifact-file-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'requirements-summary',
        kind: 'report',
        path: requirementsArtifactPath
      })
    ]));
    expect(result.receipt.artifactContract.status).toBe('satisfied');
    expect(result.receipt.artifactContract.presentArtifacts).toEqual(['requirements-summary']);
  });

  it('synthesizes requirements-summary from model output deliverable when the adapter omits the artifact file', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const modelOutputPath = path.join(tempDir, 'requirements-analysis-copilot-cli-output.json');
    if (claimPayload.taskClaim?.runtimeContext) {
      claimPayload.taskClaim.runtimeContext.artifactsDir = tempDir;
    }
    const adapterScript = `const fs=require('node:fs'); const path=require('node:path'); const modelOutputPath=${JSON.stringify(modelOutputPath)}; fs.mkdirSync(path.dirname(modelOutputPath), { recursive: true }); fs.writeFileSync(modelOutputPath, JSON.stringify({ deliverable: { taskId: 'frontend-smoke--requirements-analysis', stage: 'requirements-analysis', goal: 'Analyze', summary: 'Summarize the scope and acceptance criteria for the claimed task.', sources: ['docs/architecture.md'] } }, null, 2)); process.stdout.write(JSON.stringify({adapterRun:{status:'completed',summary:'requirements-ready',notes:[],activity:{commands:[],editedFiles:[],artifactFiles:[],collaborationActions:[]},artifacts:[{id:'frontend-smoke--requirements-analysis-requirements-analysis-model-output',kind:'report',path:modelOutputPath,taskId:'frontend-smoke--requirements-analysis'}],errors:[]}}));`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'requirements-deliverable-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: tempDir,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    const requirementsSummaryArtifact = result.adapterRun.artifacts.find((artifact) => artifact.id === 'requirements-summary');

    expect(requirementsSummaryArtifact?.path).toBeTruthy();
    expect(result.adapterRun.notes).toContain('controller-generated:requirements-summary');
    expect(result.receipt.artifactContract.status).toBe('satisfied');
    expect(result.receipt.artifactContract.presentArtifacts).toEqual(['requirements-summary']);

    const requirementsSummaryPayload = JSON.parse(fs.readFileSync(requirementsSummaryArtifact?.path ?? '', 'utf8')) as {
      summary: string;
      stage: string;
    };
    expect(requirementsSummaryPayload.stage).toBe('requirements-analysis');
    expect(requirementsSummaryPayload.summary).toBe('Summarize the scope and acceptance criteria for the claimed task.');
  });

  it('synthesizes a schema-valid requirements-summary when the adapter only writes a markdown summary artifact', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const modelOutputPath = path.join(tempDir, 'requirements-analysis-copilot-cli-output.json');
    const markdownSummaryPath = path.join(tempDir, 'requirements-summary.md');
    if (claimPayload.taskClaim?.runtimeContext) {
      claimPayload.taskClaim.runtimeContext.artifactsDir = tempDir;
    }
    const adapterScript = `const fs=require('node:fs'); const path=require('node:path'); const modelOutputPath=${JSON.stringify(modelOutputPath)}; const markdownSummaryPath=${JSON.stringify(markdownSummaryPath)}; fs.mkdirSync(path.dirname(modelOutputPath), { recursive: true }); fs.writeFileSync(modelOutputPath, JSON.stringify({ deliverable: { artifactPath: markdownSummaryPath, routeName: 'frontend-smoke', scope: { summary: 'Frontend smoke needs a concise contract-aligned handoff.' }, impactedServices: [{ service: 'frontend', impact: 'Owns the smoke route rendering and happy-path load sequence.' }], acceptanceCriteria: ['The smoke route scope stays isolated.', 'Implementation can proceed without rediscovering route intent.'], risks: ['Route details were inferred from draft docs.'] } }, null, 2)); fs.writeFileSync(markdownSummaryPath, ${JSON.stringify('# Requirements Summary\n')}, 'utf8'); process.stdout.write(JSON.stringify({adapterRun:{status:'completed',summary:'requirements-ready',notes:[],activity:{commands:[],editedFiles:[],artifactFiles:[markdownSummaryPath],collaborationActions:[]},artifacts:[{id:'frontend-smoke--requirements-analysis-requirements-analysis-model-output',kind:'report',path:modelOutputPath,taskId:'frontend-smoke--requirements-analysis'}],errors:[]}}));`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'markdown-requirements-deliverable-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: tempDir,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    const requirementsSummaryArtifact = result.adapterRun.artifacts.find((artifact) => artifact.id === 'requirements-summary');

    expect(requirementsSummaryArtifact?.path).toBe(path.join(tempDir, 'requirements-summary.json'));
    expect(result.adapterRun.notes).toContain('controller-generated:requirements-summary');
    expect(result.receipt.artifactContract.status).toBe('satisfied');
    expect(result.receipt.artifactContract.presentArtifacts).toEqual(['requirements-summary']);

    const requirementsSummaryPayload = JSON.parse(fs.readFileSync(requirementsSummaryArtifact?.path ?? '', 'utf8')) as {
      taskId: string;
      stage: string;
      goal: string;
      routeName: string;
      summary: string;
      sources: string[];
      impactedServices: Array<{ name: string; impact?: string[] }>;
      acceptanceCriteria: string[];
    };
    expect(requirementsSummaryPayload.taskId).toBe('frontend-smoke--requirements-analysis');
    expect(requirementsSummaryPayload.stage).toBe('requirements-analysis');
    expect(requirementsSummaryPayload.goal).toBe(claimPayload.taskClaim?.goal);
    expect(requirementsSummaryPayload.routeName).toBe('frontend-smoke');
    expect(requirementsSummaryPayload.summary).toBe('Frontend smoke needs a concise contract-aligned handoff.');
    expect(requirementsSummaryPayload.sources.length).toBeGreaterThan(0);
    expect(requirementsSummaryPayload.sources).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(requirementsSummaryPayload.impactedServices).toEqual([
      {
        name: 'frontend',
        impact: ['Owns the smoke route rendering and happy-path load sequence.']
      }
    ]);
    expect(requirementsSummaryPayload.acceptanceCriteria).toEqual([
      'The smoke route scope stays isolated.',
      'Implementation can proceed without rediscovering route intent.'
    ]);
  });

  it('normalizes an invalid adapter-provided requirements-summary JSON artifact from the model deliverable', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const modelOutputPath = path.join(tempDir, 'requirements-analysis-copilot-cli-output.json');
    const requirementsSummaryPath = path.join(tempDir, 'requirements-summary.json');
    if (claimPayload.taskClaim?.runtimeContext) {
      claimPayload.taskClaim.runtimeContext.artifactsDir = tempDir;
    }
    const adapterScript = `const fs=require('node:fs'); const path=require('node:path'); const modelOutputPath=${JSON.stringify(modelOutputPath)}; const requirementsSummaryPath=${JSON.stringify(requirementsSummaryPath)}; fs.mkdirSync(path.dirname(modelOutputPath), { recursive: true }); fs.writeFileSync(modelOutputPath, JSON.stringify({ deliverable: { routeName: 'frontend-smoke', scope: { summary: 'Frontend smoke needs a concise contract-aligned handoff.' }, impactedServices: [{ service: 'frontend', impact: 'Owns the smoke route rendering and happy-path load sequence.' }], acceptanceCriteria: ['The smoke route scope stays isolated.', 'Implementation can proceed without rediscovering route intent.'] } }, null, 2)); fs.writeFileSync(requirementsSummaryPath, JSON.stringify({ taskId: 'frontend-smoke--requirements-analysis', route: 'frontend-smoke', acceptanceCriteria: [] }, null, 2)); process.stdout.write(JSON.stringify({adapterRun:{status:'completed',summary:'requirements-ready',notes:[],activity:{commands:[],editedFiles:[],artifactFiles:[requirementsSummaryPath],collaborationActions:[]},artifacts:[{id:'frontend-smoke--requirements-analysis-requirements-analysis-model-output',kind:'report',path:modelOutputPath,taskId:'frontend-smoke--requirements-analysis'},{id:'requirements-summary',kind:'report',path:requirementsSummaryPath,taskId:'frontend-smoke--requirements-analysis'}],errors:[]}}));`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'invalid-json-requirements-deliverable-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: tempDir,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.notes).toContain('controller-normalized:requirements-summary');
    expect(result.receipt.artifactContract.status).toBe('satisfied');

    const requirementsSummaryPayload = JSON.parse(fs.readFileSync(requirementsSummaryPath, 'utf8')) as {
      taskId: string;
      stage: string;
      routeName: string;
      summary: string;
      acceptanceCriteria: string[];
    };
    expect(requirementsSummaryPayload.taskId).toBe('frontend-smoke--requirements-analysis');
    expect(requirementsSummaryPayload.stage).toBe('requirements-analysis');
    expect(requirementsSummaryPayload.routeName).toBe('frontend-smoke');
    expect(requirementsSummaryPayload.summary).toBe('Frontend smoke needs a concise contract-aligned handoff.');
    expect(requirementsSummaryPayload.acceptanceCriteria).toEqual([
      'The smoke route scope stays isolated.',
      'Implementation can proceed without rediscovering route intent.'
    ]);
  });

  it('writes relative requirements-summary artifacts under the adapter repository root', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-relative-artifacts-'));
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-relative-artifacts-sandbox-'));
    const repositoryRoot = path.join(tempDir, 'repo');
    const statePath = path.join(repositoryRoot, 'execution-state.json');
    const taskGraphPath = path.join(repositoryRoot, 'task-graph.json');
    const runtimePath = path.join(repositoryRoot, 'adapter-runtime.json');
    const projectAdapterPath = path.join(repositoryRoot, '.spec2flow', 'project.yaml');
    const modelOutputPath = path.join(repositoryRoot, 'tmp', 'requirements-analysis-copilot-cli-output.json');
    const expectedRequirementsSummaryPath = path.join(repositoryRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'requirements-summary.json');
    const unexpectedRequirementsSummaryPath = path.join(sandboxDir, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'requirements-summary.json');
    tempDirs.push(tempDir, sandboxDir);

    fs.mkdirSync(path.dirname(projectAdapterPath), { recursive: true });
    fs.writeFileSync(projectAdapterPath, 'spec2flow:\n  project:\n    name: repo\n', 'utf8');
    fs.mkdirSync(repositoryRoot, { recursive: true });

    const executionStatePayload: ExecutionStateDocument = {
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
          }
        ],
        artifacts: [],
        errors: []
      }
    };
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          {
            id: 'frontend-smoke--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze',
            goal: 'Analyze',
            executorType: 'requirements-agent',
            roleProfile: createRoleProfile('none', false, false),
            status: 'ready'
          }
        ]
      }
    };
    const claimPayload: TaskClaimPayload = {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--requirements-analysis',
        title: 'Analyze',
        stage: 'requirements-analysis',
        goal: 'Analyze',
        executorType: 'requirements-agent',
        roleProfile: createRoleProfile('none', false, false),
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: [],
          taskInputs: {},
          projectAdapterRef: projectAdapterPath
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          artifactsDir: 'spec2flow/outputs/execution/frontend-smoke',
          dependsOn: []
        },
        instructions: []
      }
    };

    fs.mkdirSync(repositoryRoot, { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

    const adapterScript = `const fs=require('node:fs'); const path=require('node:path'); const modelOutputPath=${JSON.stringify(modelOutputPath)}; fs.mkdirSync(path.dirname(modelOutputPath), { recursive: true }); fs.writeFileSync(modelOutputPath, JSON.stringify({ deliverable: { routeName: 'frontend-smoke', scope: { summary: 'Relative requirements-summary artifacts should follow the adapter cwd.' }, acceptanceCriteria: ['Write the requirements-summary artifact into the repository outputs tree.'] } }, null, 2)); process.stdout.write(JSON.stringify({adapterRun:{status:'completed',summary:'requirements-ready',notes:[],activity:{commands:[],editedFiles:[],artifactFiles:[],collaborationActions:[]},artifacts:[{id:'frontend-smoke--requirements-analysis-requirements-analysis-model-output',kind:'report',path:modelOutputPath,taskId:'frontend-smoke--requirements-analysis'}],errors:[]}}));`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'relative-requirements-artifact-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: repositoryRoot,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const originalCwd = process.cwd();
    process.chdir(sandboxDir);

    try {
      const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
        'adapter-runtime': runtimePath
      }, {
        validateAdapterRuntimePayload: () => undefined,
        sanitizeStageName: (stage) => stage,
        getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
        parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
      });

      expect(result.adapterRun.notes).toContain('controller-generated:requirements-summary');
      expect(fs.existsSync(expectedRequirementsSummaryPath)).toBe(true);
      expect(fs.existsSync(unexpectedRequirementsSummaryPath)).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('fails external adapter output that violates the role policy', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterScript = `process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"requirements-ready",notes:[],activity:{commands:["npm test"],editedFiles:[],artifactFiles:[${JSON.stringify(requirementsArtifactPath)}],collaborationActions:[]},artifacts:[{id:"requirements-summary",kind:"report",path:${JSON.stringify(requirementsArtifactPath)}}],errors:[]}}))`;
    writeRequirementSummaryArtifact(requirementsArtifactPath, 'frontend-smoke--requirements-analysis');
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'policy-test-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('failed');
    expect(result.adapterRun.errors.map((error) => error.code)).toContain('role-policy-violation');
  });

  it('accepts bootstrap commands with cwd wrappers and artifact report writes', () => {
    const { statePath, taskGraphPath, claimPayload, repositoryRoot, reportPath } = createEnvironmentPreparationTestFiles();
    const runtimePath = path.join(repositoryRoot, 'adapter-runtime.json');
    const relativeReportPath = 'spec2flow/outputs/execution/environment-preparation-report.json';
    const adapterScript = `process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"environment-ready",notes:[],activity:{commands:[${JSON.stringify(`cd ${repositoryRoot} && sh scripts/local/setup_local_env.sh`)},${JSON.stringify(`cd ${repositoryRoot} && mkdir -p spec2flow/outputs/execution && cat > ${relativeReportPath} <<'EOF'\n{}\nEOF`)}],editedFiles:[],artifactFiles:[${JSON.stringify(relativeReportPath)}],collaborationActions:[]},artifacts:[{id:"environment-preparation-report",kind:"report",path:${JSON.stringify(reportPath)}}],errors:[]}}))`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'bootstrap-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: repositoryRoot,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('completed');
    expect(result.adapterRun.errors).toEqual([]);
    expect(result.receipt.artifactContract.status).toBe('satisfied');
  });

  it('synthesizes implementation-summary and code-diff for code-implementation runs', () => {
    const { statePath, taskGraphPath, claimPayload, repositoryRoot } = createCodeImplementationTestFiles();
    const runtimePath = path.join(repositoryRoot, 'adapter-runtime.json');
    const adapterScript = 'process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"implemented-change",notes:[],activity:{commands:["npm run build"],editedFiles:["src/app.ts"],artifactFiles:[],collaborationActions:[]},artifacts:[],errors:[]}}))';
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'implementation-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          adapterScript
        ],
        cwd: repositoryRoot,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    const implementationSummaryArtifact = result.adapterRun.artifacts.find((artifact) => artifact.id === 'implementation-summary');
    const codeDiffArtifact = result.adapterRun.artifacts.find((artifact) => artifact.id === 'code-diff');
    expect(implementationSummaryArtifact?.path).toBeTruthy();
    expect(codeDiffArtifact?.path).toBeTruthy();
    expect(result.adapterRun.notes).toContain('controller-generated:implementation-summary');
    expect(result.adapterRun.notes).toContain('controller-generated:code-diff');
    expect(result.receipt.artifactContract.status).toBe('satisfied');

    const implementationSummaryPayload = JSON.parse(fs.readFileSync(implementationSummaryArtifact?.path ?? '', 'utf8')) as {
      changedFiles: Array<{ path: string; changeType: string }>;
      summary: string;
    };
    expect(implementationSummaryPayload.summary).toBe('implemented-change');
    expect(implementationSummaryPayload.changedFiles).toEqual([
      {
        path: 'src/app.ts',
        changeType: 'modified'
      }
    ]);

    const codeDiffPayload = fs.readFileSync(codeDiffArtifact?.path ?? '', 'utf8');
    expect(codeDiffPayload).toContain('src/app.ts');
    expect(codeDiffPayload).toContain('-export const value = 1;');
    expect(codeDiffPayload).toContain('+export const value = 2;');
  });

  it('returns a structured failed receipt when the adapter runtime times out', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const runtimePath = path.join(tempDir, 'timeout-adapter-runtime.json');
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'timeout-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          'setTimeout(() => {}, 1000)'
        ],
        outputMode: 'stdout',
        timeoutMs: 50
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('failed');
    expect(result.adapterRun.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'adapter-runtime-timeout'
      })
    ]));
    expect(result.receipt.status).toBe('failed');
  });

  it('synthesizes collaboration-handoff from model output and blocks on approval gate', () => {
    const { statePath, taskGraphPath, claimPayload, repositoryRoot, artifactsDir } = createCollaborationTestFiles();
    const runtimePath = path.join(repositoryRoot, 'adapter-runtime.json');
    const modelOutputPath = path.join(artifactsDir, 'collaboration-copilot-cli-output.json');
    const adapterScript = `const fs=require('node:fs'); const path=require('node:path'); const modelOutputPath=${JSON.stringify(modelOutputPath)}; fs.mkdirSync(path.dirname(modelOutputPath), { recursive: true }); fs.writeFileSync(modelOutputPath, JSON.stringify({ deliverable: { handoffArtifactPath: ${JSON.stringify(path.join(artifactsDir, 'collaboration-handoff.json'))}, handoff: { generatedAt: '2026-03-24T00:00:00.000Z', taskId: 'frontend-smoke--collaboration', stage: 'collaboration', summary: 'Ready for review with human approval pending.', handoffType: 'review', readiness: 'awaiting-approval', approvalRequired: true, artifactRefs: ['execution-report'], nextActions: ['Request approval'], reviewPolicy: { required: true, reviewAgentCount: 1, requireHumanApproval: true } } } }, null, 2)); process.stdout.write(JSON.stringify({adapterRun:{status:'blocked',summary:'artifact write blocked',notes:['collaboration-stage artifact pending'],activity:{commands:[],editedFiles:[],artifactFiles:[],collaborationActions:['Prepared review handoff']},artifacts:[{id:'frontend-smoke--collaboration-collaboration-model-output',kind:'report',path:modelOutputPath,taskId:'frontend-smoke--collaboration'}],errors:[{code:'artifact-write-blocked',message:'write denied',taskId:'frontend-smoke--collaboration',recoverable:true}]}}));`;
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'collaboration-artifact-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: ['-e', adapterScript],
        cwd: repositoryRoot,
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'collaboration-handoff' })
    ]));
    expect(result.adapterRun.errors).toEqual([]);
    expect(result.receipt.artifactContract.status).toBe('satisfied');
    expect(result.receipt.status).toBe('blocked');
  });
});