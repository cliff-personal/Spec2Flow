import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildValidatorResult: vi.fn(),
  buildTaskGraph: vi.fn(),
  getChangedFiles: vi.fn(),
  getRequirementText: vi.fn()
}));

vi.mock('../onboarding/validator-service.js', () => ({
  buildValidatorResult: mocks.buildValidatorResult
}));

vi.mock('../planning/task-graph-service.js', () => ({
  buildTaskGraph: mocks.buildTaskGraph,
  getChangedFiles: mocks.getChangedFiles,
  getRequirementText: mocks.getRequirementText
}));

import { runGenerateTaskGraph } from './generate-task-graph-command.js';

describe('generate-task-graph-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when required paths are missing', () => {
    const fail = vi.fn();

    expect(() => runGenerateTaskGraph({}, {
      fail,
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('generate-task-graph requires --project, --topology, and --risk');
  });

  it('writes the generated task graph to the requested output path', () => {
    const projectPayload = { spec2flow: { project: { name: 'demo' } } };
    const topologyPayload = { topology: { workflowRoutes: [] } };
    const riskPayload = { riskPolicy: { rules: [] } };
    const taskGraphPayload = {
      taskGraph: {
        id: 'graph',
        workflowName: 'workflow',
        source: {
          selectedRoutes: ['frontend-smoke']
        },
        tasks: [
          {
            id: 'frontend-smoke--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze requirements',
            goal: 'Summarize the request',
            executorType: 'requirements-agent',
            roleProfile: {
              profileId: 'requirements-analysis-specialist',
              specialistRole: 'requirements-agent',
              commandPolicy: 'none',
              canReadRepository: true,
              canEditFiles: false,
              canRunCommands: false,
              canWriteArtifacts: true,
              canOpenCollaboration: false,
              requiredAdapterSupports: ['toolCalling', 'jsonMode', 'longContext'],
              expectedArtifacts: ['requirements-summary']
            },
            status: 'ready'
          }
        ]
      }
    };
    const writeJson = vi.fn();
    const readStructuredFile = vi.fn((filePath: string) => {
      if (filePath === 'project.yaml') {
        return projectPayload;
      }
      if (filePath === 'topology.yaml') {
        return topologyPayload;
      }
      if (filePath === 'risk.yaml') {
        return riskPayload;
      }
      throw new Error(`unexpected file: ${filePath}`);
    });

    mocks.getChangedFiles.mockReturnValue(['apps/frontend/src/app.tsx']);
    mocks.getRequirementText.mockReturnValue('Update the frontend smoke flow.');
    mocks.buildValidatorResult.mockReturnValue({
      validatorResult: {
        status: 'passed'
      }
    });
    mocks.buildTaskGraph.mockReturnValue(taskGraphPayload);

    runGenerateTaskGraph({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml',
      output: 'generated/task-graph.json',
      'requirement-file': 'requirements/frontend.md'
    }, {
      fail: vi.fn(),
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    expect(mocks.buildValidatorResult).toHaveBeenCalledWith(projectPayload, topologyPayload, riskPayload, {
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    });
    expect(mocks.buildTaskGraph).toHaveBeenCalledWith(projectPayload, topologyPayload, riskPayload, {
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml',
      requirement: 'requirements/frontend.md'
    }, {
      changedFiles: ['apps/frontend/src/app.tsx'],
      requirementText: 'Update the frontend smoke flow.',
      routes: []
    });
    expect(writeJson).toHaveBeenCalledWith('generated/task-graph.json', taskGraphPayload);
  });

  it('fails when the generated task graph violates the schema contract', () => {
    const fail = vi.fn();

    mocks.getChangedFiles.mockReturnValue([]);
    mocks.getRequirementText.mockReturnValue('');
    mocks.buildValidatorResult.mockReturnValue({
      validatorResult: {
        status: 'passed'
      }
    });
    mocks.buildTaskGraph.mockReturnValue({
      taskGraph: {
        id: 'graph',
        workflowName: 'workflow',
        tasks: []
      }
    });

    expect(() => runGenerateTaskGraph({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    }, {
      fail,
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith(expect.stringContaining('task-graph validation failed'));
  });

  it('fails when onboarding validation fails', () => {
    const fail = vi.fn();

    mocks.getChangedFiles.mockReturnValue([]);
    mocks.getRequirementText.mockReturnValue('');
    mocks.buildValidatorResult.mockReturnValue({
      validatorResult: {
        status: 'failed'
      }
    });

    expect(() => runGenerateTaskGraph({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    }, {
      fail,
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('cannot generate task graph because onboarding validation failed');
    expect(mocks.buildTaskGraph).not.toHaveBeenCalled();
  });

  it('passes explicit route filters into task graph generation', () => {
    mocks.getChangedFiles.mockReturnValue([]);
    mocks.getRequirementText.mockReturnValue('');
    mocks.buildValidatorResult.mockReturnValue({
      validatorResult: {
        status: 'passed'
      }
    });
    mocks.buildTaskGraph.mockReturnValue({
      taskGraph: {
        id: 'graph',
        workflowName: 'workflow',
        source: {
          selectedRoutes: ['frontend-smoke']
        },
        tasks: [
          {
            id: 'frontend-smoke--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze frontend smoke requirements',
            goal: 'Summarize scope',
            executorType: 'requirements-agent',
            roleProfile: {
              profileId: 'requirements-analysis-specialist',
              specialistRole: 'requirements-agent',
              commandPolicy: 'none',
              canReadRepository: true,
              canEditFiles: false,
              canRunCommands: false,
              canWriteArtifacts: true,
              canOpenCollaboration: false,
              requiredAdapterSupports: ['toolCalling', 'jsonMode', 'longContext'],
              expectedArtifacts: ['requirements-summary']
            },
            status: 'ready'
          }
        ]
      }
    });
    const parseCsvOption = vi.fn(() => ['frontend-smoke']);

    runGenerateTaskGraph({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml',
      routes: 'frontend-smoke'
    }, {
      fail: vi.fn(),
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    });

    expect(parseCsvOption).toHaveBeenCalledWith('frontend-smoke');
    expect(mocks.buildTaskGraph).toHaveBeenCalledWith(
      {},
      {},
      {},
      {
        project: 'project.yaml',
        topology: 'topology.yaml',
        risk: 'risk.yaml',
        requirement: null
      },
      {
        changedFiles: [],
        requirementText: '',
        routes: ['frontend-smoke']
      }
    );
  });

  it('fails when requirement text does not map to any workflow route', () => {
    const fail = vi.fn();

    mocks.getChangedFiles.mockReturnValue([]);
    mocks.getRequirementText.mockReturnValue('Clear S');
    mocks.buildValidatorResult.mockReturnValue({
      validatorResult: {
        status: 'passed'
      }
    });
    mocks.buildTaskGraph.mockReturnValue({
      taskGraph: {
        id: 'graph',
        workflowName: 'workflow',
        source: {
          selectedRoutes: []
        },
        tasks: []
      }
    });

    expect(() => runGenerateTaskGraph({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    }, {
      fail,
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('generate-task-graph could not map the requirement to any workflow route');
  });
});
