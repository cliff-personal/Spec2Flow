import { describe, expect, it } from 'vitest';
import { getSchemaValidators } from './schema-registry.js';

describe('schema-registry', () => {
  it('accepts a valid adapter-run payload', () => {
    const validators = getSchemaValidators();

    const valid = validators.adapterRun({
      adapterRun: {
        adapterName: 'test-adapter',
        provider: 'test-provider',
        taskId: 'frontend-smoke--requirements-analysis',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'completed',
        summary: 'done',
        notes: [],
        activity: {
          commands: [],
          editedFiles: [],
          artifactFiles: ['tmp/requirements-summary.json'],
          collaborationActions: []
        },
        artifacts: [
          {
            id: 'requirements-summary',
            kind: 'report',
            path: 'tmp/requirements-summary.json',
            taskId: 'frontend-smoke--requirements-analysis'
          }
        ],
        errors: []
      }
    });

    expect(valid).toBe(true);
  });

  it('rejects adapter-run payloads that omit required activity', () => {
    const validators = getSchemaValidators();

    const valid = validators.adapterRun({
      adapterRun: {
        adapterName: 'test-adapter',
        provider: 'test-provider',
        taskId: 'frontend-smoke--requirements-analysis',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'completed',
        summary: 'done',
        notes: [],
        artifacts: [],
        errors: []
      }
    });

    expect(valid).toBe(false);
    expect(validators.adapterRun.errors?.some((error) => error.instancePath === '/adapterRun' && error.params.missingProperty === 'activity')).toBe(true);
  });

  it('rejects task-result payloads that omit artifact contracts', () => {
    const validators = getSchemaValidators();

    const valid = validators.taskResult({
      taskResult: {
        taskId: 'frontend-smoke--requirements-analysis',
        status: 'completed',
        executionStateRef: 'execution-state.json',
        notes: [],
        artifacts: [],
        errors: [],
        submittedAt: new Date().toISOString()
      }
    });

    expect(valid).toBe(false);
    expect(validators.taskResult.errors?.some((error) => error.instancePath === '/taskResult' && error.params.missingProperty === 'artifactContract')).toBe(true);
  });

  it('accepts schema-backed stage deliverables', () => {
    const validators = getSchemaValidators();

    expect(validators.requirementSummary({
      taskId: 'frontend-smoke--requirements-analysis',
      stage: 'requirements-analysis',
      goal: 'Summarize the frontend smoke route requirements',
      summary: 'The route needs a scoped requirement summary before implementation starts.',
      sources: ['docs/architecture.md']
    })).toBe(true);

    expect(validators.implementationSummary({
      taskId: 'frontend-smoke--code-implementation',
      stage: 'code-implementation',
      goal: 'Apply the approved frontend smoke change',
      summary: 'Updated the smoke route entrypoint and related docs.',
      changedFiles: [
        {
          path: 'apps/frontend/src/App.tsx',
          changeType: 'modified'
        }
      ]
    })).toBe(true);

    expect(validators.testPlan({
      taskId: 'frontend-smoke--test-design',
      stage: 'test-design',
      goal: 'Plan smoke validation coverage',
      summary: 'Focus on the happy path and one blocking edge.',
      cases: [
        {
          id: 'smoke-happy-path',
          title: 'Smoke happy path',
          level: 'smoke',
          priority: 'high'
        }
      ]
    })).toBe(true);

    expect(validators.testCases({
      taskId: 'frontend-smoke--test-design',
      stage: 'test-design',
      goal: 'Define executable smoke cases',
      cases: [
        {
          id: 'case-1',
          title: 'Render smoke page',
          priority: 'high',
          automationCandidate: true,
          steps: ['Open the smoke route'],
          expectedResults: ['The smoke page renders']
        }
      ]
    })).toBe(true);

    expect(validators.executionReport({
      taskId: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      goal: 'Run frontend smoke validation',
      summary: 'The smoke validation passed.',
      outcome: 'passed',
      commands: [
        {
          command: 'npm run test:unit',
          status: 'passed',
          exitCode: 0
        }
      ]
    })).toBe(true);

    expect(validators.executionEvidenceIndex({
      taskId: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      summary: 'Execution evidence index with service and browser coverage.',
      artifacts: [
        {
          id: 'execution-report',
          path: 'spec2flow/outputs/execution/frontend-smoke/execution-report.json',
          kind: 'report',
          category: 'artifact-index',
          contentType: 'application/json'
        }
      ],
      services: [
        {
          name: 'frontend',
          status: 'ready',
          healthTarget: 'http://127.0.0.1:4173/healthz'
        }
      ],
      browserChecks: [
        {
          id: 'smoke-home',
          url: 'http://127.0.0.1:4173/',
          status: 'passed',
          htmlSnapshotPath: 'spec2flow/outputs/execution/frontend-smoke/browser/smoke-home.html'
        }
      ],
      repositoryGaps: []
    })).toBe(true);

    expect(validators.executionArtifactCatalog({
      taskId: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      summary: 'Artifact catalog with remote storage refs.',
      store: {
        mode: 'remote-catalog',
        provider: 'generic-http',
        publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
        keyPrefix: 'frontend-smoke/'
      },
      artifacts: [
        {
          id: 'execution-report',
          path: 'spec2flow/outputs/execution/frontend-smoke/execution-report.json',
          kind: 'report',
          category: 'artifact-index',
          storage: {
            mode: 'remote-catalog',
            provider: 'generic-http',
            objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json',
            remoteUrl: 'https://artifacts.example.com/spec2flow/frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json'
          }
        }
      ]
    })).toBe(true);

    expect(validators.defectSummary({
      taskId: 'frontend-smoke--defect-feedback',
      stage: 'defect-feedback',
      summary: 'The execution failure points to a missing implementation guard.',
      failureType: 'implementation',
      severity: 'high',
      evidenceRefs: ['spec2flow/outputs/execution/frontend-smoke/execution-report.json'],
      recommendedAction: 'fix-implementation'
    })).toBe(true);

    expect(validators.collaborationHandoff({
      taskId: 'frontend-smoke--collaboration',
      stage: 'collaboration',
      summary: 'The change is ready for human review.',
      handoffType: 'review',
      readiness: 'ready',
      approvalRequired: true,
      artifactRefs: ['implementation-summary', 'execution-report'],
      nextActions: ['Request final review'],
      reviewPolicy: {
        required: true,
        reviewAgentCount: 1,
        requireHumanApproval: true
      }
    })).toBe(true);

    expect(validators.publicationRecord({
      publicationId: 'publication-1',
      taskId: 'frontend-smoke--collaboration',
      stage: 'collaboration',
      status: 'published',
      publishMode: 'auto-commit',
      summary: 'Published the frontend smoke collaboration handoff.',
      handoffType: 'pull-request',
      approvalRequired: false,
      autoCommitEnabled: true,
      branchName: 'spec2flow/frontend-smoke-20260324',
      commitSha: 'abc123',
      commitMessage: 'spec2flow: publish frontend smoke handoff',
      prTitle: 'Frontend smoke collaboration handoff',
      prDraftPath: 'spec2flow/outputs/collaboration/frontend-smoke/pr-draft.md',
      artifactRefs: ['implementation-summary', 'execution-report'],
      nextActions: ['Open the pull request handoff for review.']
    })).toBe(true);
  });

  it('accepts risk policy rules with auto-repair fields', () => {
    const validators = getSchemaValidators();

    expect(validators.risk({
      riskPolicy: {
        automationLevels: [
          {
            name: 'default',
            description: 'Default repository automation level.',
            maxAutonomy: 'execute-to-pr'
          }
        ],
        rules: [
          {
            name: 'frontend-medium',
            level: 'medium',
            match: {
              workflowNames: ['frontend-smoke']
            },
            requires: {
              humanApproval: false,
              reviewAgents: 1,
              maxAutoRepairAttempts: 2,
              maxExecutionRetries: 4,
              allowAutoCommit: false,
              blockedRiskLevels: ['critical']
            }
          }
        ],
        defaultLevel: 'default'
      }
    })).toBe(true);
  });
});
