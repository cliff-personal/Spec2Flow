#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { minimatch } from 'minimatch';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const riskWeight = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}

function readStructuredFile(filePath) {
  const resolvedPath = resolveFromCwd(filePath);
  const content = fs.readFileSync(resolvedPath, 'utf8');

  if (resolvedPath.endsWith('.json')) {
    return JSON.parse(content);
  }

  return yaml.load(content, { schema: yaml.JSON_SCHEMA });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextFile(filePath) {
  return fs.readFileSync(resolveFromCwd(filePath), 'utf8');
}

function readChangedFilesContent(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, data) {
  const resolvedPath = resolveFromCwd(filePath);
  ensureDirForFile(resolvedPath);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getSchemaValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  return {
    project: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/project-adapter.schema.json'))),
    topology: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/system-topology.schema.json'))),
    risk: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/risk-policy.schema.json'))),
    executionState: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/execution-state.schema.json'))),
    adapterRuntime: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/model-adapter-runtime.schema.json')))
  };
}

function pushCheck(checks, name, type, status, target, message, details = undefined) {
  const check = { name, type, status, target, message };
  if (details) {
    check.details = details;
  }
  checks.push(check);
}

function validateSchema(checks, validator, schemaName, payload, target) {
  const valid = validator(payload);
  if (valid) {
    pushCheck(checks, `${schemaName} schema`, 'schema-valid', 'passed', target, `${schemaName} schema validation passed`);
    return;
  }

  pushCheck(
    checks,
    `${schemaName} schema`,
    'schema-valid',
    'failed',
    target,
    `${schemaName} schema validation failed`,
    { errors: validator.errors ?? [] }
  );
}

function validateProjectDependencies(project, topologyServiceNames, checks, projectPath) {
  const knownServiceNames = new Set([...Object.keys(project.spec2flow.services), ...topologyServiceNames]);

  for (const [serviceName, service] of Object.entries(project.spec2flow.services)) {
    const dependencies = service.dependsOn ?? [];
    const missing = dependencies.filter((dependency) => !knownServiceNames.has(dependency));
    if (missing.length === 0) {
      pushCheck(
        checks,
        `project service dependencies: ${serviceName}`,
        'dependency-order',
        'passed',
        projectPath,
        `all dependencies declared for ${serviceName}`
      );
      continue;
    }

    pushCheck(
      checks,
      `project service dependencies: ${serviceName}`,
      'dependency-order',
      'failed',
      projectPath,
      `unknown dependencies for ${serviceName}`,
      { missing }
    );
  }
}

function validateTopologyDependencies(service, serviceNames, checks, topologyPath) {
  const dependencies = service.dependsOn ?? [];
  const missing = dependencies.filter((dependency) => !serviceNames.has(dependency));

  if (missing.length === 0) {
    pushCheck(
      checks,
      `topology dependencies: ${service.name}`,
      'dependency-order',
      'passed',
      topologyPath,
      `all topology dependencies declared for ${service.name}`
    );
    return;
  }

  pushCheck(
    checks,
    `topology dependencies: ${service.name}`,
    'dependency-order',
    'failed',
    topologyPath,
    `unknown topology dependencies for ${service.name}`,
    { missing }
  );
}

function getStartupProblems(service, dependencies, startupIndex) {
  const startupProblems = [];

  if (!startupIndex.has(service.name)) {
    startupProblems.push(`service ${service.name} missing from startupOrder`);
  }

  for (const dependency of dependencies) {
    if (!startupIndex.has(dependency)) {
      startupProblems.push(`dependency ${dependency} missing from startupOrder`);
      continue;
    }
    if (startupIndex.has(service.name) && startupIndex.get(dependency) > startupIndex.get(service.name)) {
      startupProblems.push(`dependency ${dependency} starts after ${service.name}`);
    }
  }

  return startupProblems;
}

function validateStartupOrder(service, dependencies, startupIndex, checks, topologyPath) {
  if (startupIndex.size === 0) {
    return;
  }

  const startupProblems = getStartupProblems(service, dependencies, startupIndex);
  if (startupProblems.length === 0) {
    pushCheck(
      checks,
      `startup order: ${service.name}`,
      'dependency-order',
      'passed',
      topologyPath,
      `startup order is valid for ${service.name}`
    );
    return;
  }

  pushCheck(
    checks,
    `startup order: ${service.name}`,
    'dependency-order',
    'failed',
    topologyPath,
    `startup order is invalid for ${service.name}`,
    { issues: startupProblems }
  );
}

function validateWorkflowRoutes(topology, serviceNames, checks, topologyPath) {
  for (const route of topology.topology.workflowRoutes ?? []) {
    const missingEntryServices = route.entryServices.filter((serviceName) => !serviceNames.has(serviceName));
    if (missingEntryServices.length === 0) {
      pushCheck(
        checks,
        `workflow route services: ${route.name}`,
        'path-exists',
        'passed',
        topologyPath,
        `workflow route ${route.name} references known services`
      );
      continue;
    }

    pushCheck(
      checks,
      `workflow route services: ${route.name}`,
      'path-exists',
      'failed',
      topologyPath,
      `workflow route ${route.name} references unknown services`,
      { missing: missingEntryServices }
    );
  }
}

function validateTopology(topology, checks, topologyPath) {
  const serviceNames = new Set(topology.topology.services.map((service) => service.name));
  const startupOrder = topology.topology.startupOrder ?? [];
  const startupIndex = new Map(startupOrder.map((name, index) => [name, index]));

  for (const service of topology.topology.services) {
    validateTopologyDependencies(service, serviceNames, checks, topologyPath);
    const dependencies = service.dependsOn ?? [];
    validateStartupOrder(service, dependencies, startupIndex, checks, topologyPath);
  }

  validateWorkflowRoutes(topology, serviceNames, checks, topologyPath);
  return serviceNames;
}

function validateRiskPolicy(risk, checks, riskPath) {
  const levels = new Set((risk.riskPolicy.automationLevels ?? []).map((level) => level.maxAutonomy));
  const defaultLevel = risk.riskPolicy.defaultLevel;

  if (!defaultLevel) {
    pushCheck(checks, 'risk default level', 'schema-valid', 'warning', riskPath, 'defaultLevel is not set');
    return;
  }

  if (levels.has(defaultLevel)) {
    pushCheck(checks, 'risk default level', 'schema-valid', 'passed', riskPath, 'defaultLevel matches an automation level');
    return;
  }

  pushCheck(
    checks,
    'risk default level',
    'schema-valid',
    'warning',
    riskPath,
    'defaultLevel does not match any maxAutonomy and is treated as repository policy metadata'
  );
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function runGitCommand(repoPath, args) {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    fail(`failed to collect changed files from git diff: ${stderr || stdout || error.message}`);
  }
}

function getChangedFilesFromGit(options) {
  if (!options['changed-files-from-git']) {
    return [];
  }

  const gitBase = options['git-base'];
  const gitHead = options['git-head'];
  const gitStaged = Boolean(options['git-staged']);

  if (gitHead && !gitBase) {
    fail('--git-head requires --git-base');
  }

  if (gitStaged && (gitBase || gitHead)) {
    fail('--git-staged cannot be combined with --git-base or --git-head');
  }

  const repoPath = resolveFromCwd(options['git-diff-repo'] ?? '.');
  const args = ['diff', '--name-only'];

  if (gitStaged) {
    args.push('--cached');
  } else if (gitBase && gitHead) {
    args.push(gitBase, gitHead);
  } else if (gitBase) {
    args.push(gitBase);
  } else {
    args.push('HEAD');
  }

  return readChangedFilesContent(runGitCommand(repoPath, args));
}

function getChangedFiles(options) {
  const inlineFiles = (options['changed-files'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fileListPath = options['changed-files-file'];
  const filePaths = fileListPath ? readChangedFilesContent(readTextFile(fileListPath)) : [];
  const gitPaths = getChangedFilesFromGit(options);

  return dedupe([...inlineFiles, ...filePaths, ...gitPaths].map(normalizePath));
}

function matchesAnyPathPattern(changedFiles, patterns) {
  if (patterns.length === 0) {
    return true;
  }

  return changedFiles.some((changedFile) =>
    patterns.some((pattern) => minimatch(changedFile, pattern, { dot: true }))
  );
}

function getRouteServiceKinds(route, project, topology) {
  const topologyServices = new Map(topology.topology.services.map((service) => [service.name, service]));
  return new Set(
    route.entryServices
      .map((serviceName) => topologyServices.get(serviceName)?.kind ?? project.spec2flow.services[serviceName]?.type)
      .filter(Boolean)
  );
}

function findRouteTargetFiles(route, project) {
  return dedupe(route.entryServices.map((serviceName) => project.spec2flow.services[serviceName]?.path));
}

function pathBelongsToTarget(filePath, targetPath) {
  return filePath === targetPath || filePath.startsWith(`${targetPath}/`);
}

function routeIsAffectedByChangedFiles(route, project, changedFiles) {
  if (changedFiles.length === 0) {
    return true;
  }

  const routeTargetFiles = findRouteTargetFiles(route, project);
  if (routeTargetFiles.length === 0) {
    return true;
  }

  return changedFiles.some((changedFile) =>
    routeTargetFiles.some((targetFile) => pathBelongsToTarget(changedFile, targetFile))
  );
}

function matchesServiceKinds(routeServiceKinds, serviceKindRules) {
  if (serviceKindRules.length === 0) {
    return true;
  }

  return serviceKindRules.some((kind) => routeServiceKinds.has(kind));
}

function matchesWorkflow(routeName, workflowRules) {
  if (workflowRules.length === 0) {
    return true;
  }

  return workflowRules.includes(routeName);
}

function getMatchingRiskRules(route, project, topology, risk, changedFiles) {
  const routeServiceKinds = getRouteServiceKinds(route, project, topology);
  const changedFileSet = changedFiles.map(normalizePath);
  const routeAffected = routeIsAffectedByChangedFiles(route, project, changedFileSet);

  if (!routeAffected) {
    return [];
  }

  return (risk.riskPolicy.rules ?? []).filter((rule) => {
    const pathRules = rule.match.paths ?? [];
    const workflowRules = rule.match.workflowNames ?? [];
    const serviceKindRules = rule.match.serviceKinds ?? [];

    return (
      matchesAnyPathPattern(changedFileSet, pathRules) &&
      matchesWorkflow(route.name, workflowRules) &&
      matchesServiceKinds(routeServiceKinds, serviceKindRules)
    );
  });
}

function getHighestRiskRule(matchingRules) {
  let selectedRule = null;

  for (const rule of matchingRules) {
    if (!selectedRule || riskWeight[rule.level] > riskWeight[selectedRule.level]) {
      selectedRule = rule;
    }
  }

  return selectedRule;
}

function buildValidatorResult(projectPayload, topologyPayload, riskPayload, paths) {
  const validators = getSchemaValidators();
  const checks = [];

  validateSchema(checks, validators.project, 'project-adapter', projectPayload, paths.project);
  validateSchema(checks, validators.topology, 'system-topology', topologyPayload, paths.topology);
  validateSchema(checks, validators.risk, 'risk-policy', riskPayload, paths.risk);

  const topologyServiceNames = validateTopology(topologyPayload, checks, paths.topology);
  validateProjectDependencies(projectPayload, topologyServiceNames, checks, paths.project);
  validateRiskPolicy(riskPayload, checks, paths.risk);

  const summary = {
    passed: checks.filter((check) => check.status === 'passed').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    failed: checks.filter((check) => check.status === 'failed').length
  };

  let status = 'passed';
  if (summary.failed > 0) {
    status = 'failed';
  } else if (summary.warnings > 0) {
    status = 'passed-with-warnings';
  }

  return {
    validatorResult: {
      status,
      projectAdapterRef: paths.project,
      topologyRef: paths.topology,
      riskPolicyRef: paths.risk,
      checks,
      summary
    }
  };
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildReviewPolicy(rule) {
  return {
    required: Boolean((rule?.requires?.reviewAgents ?? 0) > 0 || rule?.requires?.humanApproval),
    reviewAgentCount: rule?.requires?.reviewAgents ?? 0,
    requireHumanApproval: rule?.requires?.humanApproval ?? false
  };
}

function buildRouteTaskBundle(route, projectPayload, topologyPayload, riskPayload, changedFiles) {
  const project = projectPayload.spec2flow;
  const matchingRules = getMatchingRiskRules(route, projectPayload, topologyPayload, riskPayload, changedFiles);
  const matchedRule = getHighestRiskRule(matchingRules);
  const riskLevel = matchedRule?.level ?? 'low';
  const reviewPolicy = buildReviewPolicy(matchedRule);
  const routeTargetFiles = findRouteTargetFiles(route, projectPayload);
  const routeVerifyCommands = dedupe([
    ...(route.verifyCommands ?? []),
    ...((matchedRule?.requires?.mustRunCommands) ?? [])
  ]);
  const artifactsDir = route.artifactTargets?.[0] ?? `${project.artifacts?.executionDir ?? 'spec2flow/outputs/execution'}/${route.name}`;
  const matchedRuleNames = matchingRules.map((rule) => rule.name);

  const analyzeId = `${route.name}--requirements-analysis`;
  const implementId = `${route.name}--code-implementation`;
  const testId = `${route.name}--test-design`;
  const executeId = `${route.name}--automated-execution`;
  const defectId = `${route.name}--defect-feedback`;
  const collaborationId = `${route.name}--collaboration`;

  return [
    {
      id: analyzeId,
      stage: 'requirements-analysis',
      title: `Analyze ${route.name} requirements`,
      goal: `Summarize scope, impacted services, and acceptance criteria for ${route.name}`,
      executorType: 'requirements-agent',
      status: 'pending',
      riskLevel,
      dependsOn: ['environment-preparation'],
      inputs: {
        routeName: route.name,
        entryServices: route.entryServices,
        changedFiles,
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    },
    {
      id: implementId,
      stage: 'code-implementation',
      title: `Implement ${route.name} changes`,
      goal: `Apply code changes for ${route.name} within the declared service boundaries`,
      executorType: 'implementation-agent',
      status: 'pending',
      riskLevel,
      dependsOn: [analyzeId],
      inputs: {
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    },
    {
      id: testId,
      stage: 'test-design',
      title: `Design ${route.name} validation`,
      goal: `Produce route-specific smoke or regression coverage for ${route.name}`,
      executorType: 'test-design-agent',
      status: 'pending',
      riskLevel,
      dependsOn: [implementId],
      inputs: {
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      verifyCommands: routeVerifyCommands,
      artifactsDir,
      reviewPolicy
    },
    {
      id: executeId,
      stage: 'automated-execution',
      title: `Execute ${route.name} validation`,
      goal: `Run declared verification commands for ${route.name}`,
      executorType: 'execution-agent',
      status: 'pending',
      riskLevel,
      dependsOn: [testId],
      inputs: {
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      verifyCommands: routeVerifyCommands,
      artifactsDir,
      reviewPolicy
    },
    {
      id: defectId,
      stage: 'defect-feedback',
      title: `Summarize ${route.name} execution failures`,
      goal: `Generate structured bug drafts and evidence if ${route.name} validation fails`,
      executorType: 'defect-agent',
      status: 'pending',
      riskLevel,
      dependsOn: [executeId],
      inputs: {
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    },
    {
      id: collaborationId,
      stage: 'collaboration',
      title: `Prepare ${route.name} review handoff`,
      goal: `Prepare PR or issue-ready collaboration output for ${route.name}`,
      executorType: reviewPolicy.requireHumanApproval ? 'human' : 'review-agent',
      status: 'pending',
      riskLevel,
      dependsOn: [defectId],
      inputs: {
        matchedRiskRules: matchedRuleNames
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    }
  ];
}

function buildTaskGraph(projectPayload, topologyPayload, riskPayload, paths, changedFiles = []) {
  const project = projectPayload.spec2flow;
  const topology = topologyPayload.topology;

  const tasks = [
    {
      id: 'environment-preparation',
      stage: 'environment-preparation',
      title: 'Prepare repository environment',
      goal: `Load project adapter, topology, and risk policy for ${project.project.name}`,
      executorType: 'controller-agent',
      status: 'ready',
      riskLevel: 'low',
      verifyCommands: [project.infrastructure.bootstrap],
      artifactsDir: project.artifacts?.executionDir ?? 'spec2flow/outputs/execution',
      reviewPolicy: {
        required: false,
        reviewAgentCount: 0,
        requireHumanApproval: false
      }
    }
  ];

  for (const route of topology.workflowRoutes ?? []) {
    tasks.push(...buildRouteTaskBundle(route, projectPayload, topologyPayload, riskPayload, changedFiles));
  }

  return {
    taskGraph: {
      id: `${project.project.name}-task-graph`,
      workflowName: `${project.project.name}-workflow`,
      source: {
        projectAdapterRef: paths.project,
        topologyRef: paths.topology,
        riskPolicyRef: paths.risk,
        changeSet: changedFiles
      },
      tasks
    }
  };
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function parseCsvOption(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildExecutionArtifacts(taskGraphPayload, paths) {
  const source = taskGraphPayload.taskGraph.source ?? {};
  const artifacts = [];

  if (paths.taskGraph) {
    artifacts.push({
      id: 'task-graph',
      kind: 'report',
      path: paths.taskGraph
    });
  }

  if (source.projectAdapterRef) {
    artifacts.push({
      id: 'project-adapter',
      kind: 'other',
      path: source.projectAdapterRef
    });
  }

  if (source.topologyRef) {
    artifacts.push({
      id: 'topology',
      kind: 'other',
      path: source.topologyRef
    });
  }

  if (source.riskPolicyRef) {
    artifacts.push({
      id: 'risk-policy',
      kind: 'other',
      path: source.riskPolicyRef
    });
  }

  return artifacts;
}

function buildInitialTaskState(task) {
  const notes = dedupe([
    `stage:${task.stage}`,
    `risk:${task.riskLevel}`,
    task.reviewPolicy?.requireHumanApproval ? 'requires-human-approval' : null,
    task.reviewPolicy?.required ? `review-agents:${task.reviewPolicy.reviewAgentCount}` : null
  ]);

  return {
    taskId: task.id,
    status: task.status === 'ready' ? 'ready' : 'pending',
    executor: task.executorType,
    attempts: 0,
    artifactRefs: task.id === 'environment-preparation' ? ['task-graph'] : [],
    notes
  };
}

function buildExecutionState(taskGraphPayload, options, paths) {
  const now = new Date().toISOString();
  const workflowName = taskGraphPayload.taskGraph.workflowName;
  const taskStates = taskGraphPayload.taskGraph.tasks.map((task) => buildInitialTaskState(task));
  const provider = {
    adapter: options.adapter ?? 'spec2flow-cli'
  };

  if (options.model) {
    provider.model = options.model;
  }

  if (options['session-id']) {
    provider.sessionId = options['session-id'];
  }

  return {
    executionState: {
      runId: options['run-id'] ?? `${workflowName}-${Date.now()}`,
      workflowName,
      status: 'pending',
      currentStage: taskGraphPayload.taskGraph.tasks.find((task) => task.status === 'ready')?.stage ?? 'environment-preparation',
      provider,
      startedAt: now,
      updatedAt: now,
      tasks: taskStates,
      artifacts: buildExecutionArtifacts(taskGraphPayload, paths),
      errors: []
    }
  };
}

function getExecutionStateTaskIndex(executionStatePayload) {
  return new Map(executionStatePayload.executionState.tasks.map((task) => [task.taskId, task]));
}

function getTaskGraphTaskIndex(taskGraphPayload) {
  return new Map(taskGraphPayload.taskGraph.tasks.map((task) => [task.id, task]));
}

function inferExecutionStateStatus(taskStates) {
  if (taskStates.every((task) => ['completed', 'skipped'].includes(task.status))) {
    return 'completed';
  }

  if (taskStates.some((task) => task.status === 'failed')) {
    return 'failed';
  }

  if (taskStates.some((task) => task.status === 'blocked')) {
    return 'blocked';
  }

  if (taskStates.some((task) => task.status === 'in-progress')) {
    return 'running';
  }

  if (taskStates.some((task) => task.status === 'completed')) {
    return 'running';
  }

  return 'pending';
}

function inferCurrentStage(taskGraphPayload, executionStatePayload) {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);

  for (const preferredStatus of ['in-progress', 'ready', 'pending', 'blocked', 'failed', 'completed']) {
    const matchingTask = taskGraphPayload.taskGraph.tasks.find((task) => taskStateIndex.get(task.id)?.status === preferredStatus);
    if (matchingTask) {
      return matchingTask.stage;
    }
  }

  return undefined;
}

function setTaskTerminalTimestamp(taskState, status, now) {
  if (status === 'in-progress' && !taskState.startedAt) {
    taskState.startedAt = now;
  }

  if (['completed', 'failed', 'skipped'].includes(status)) {
    if (!taskState.startedAt) {
      taskState.startedAt = now;
    }
    taskState.completedAt = now;
  }
}

function promoteReadyTasks(taskGraphPayload, executionStatePayload) {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);

  for (const task of taskGraphPayload.taskGraph.tasks) {
    const taskState = taskStateIndex.get(task.id);
    if (taskState?.status !== 'pending') {
      continue;
    }

    const dependencies = task.dependsOn ?? [];
    const dependenciesSatisfied = dependencies.every((dependencyId) => {
      const dependencyState = taskStateIndex.get(dependencyId);
      return dependencyState && ['completed', 'skipped'].includes(dependencyState.status);
    });

    if (dependencies.length > 0 && dependenciesSatisfied) {
      taskState.status = 'ready';
    }
  }
}

function appendUniqueItems(target, values) {
  const combined = dedupe([...(target ?? []), ...values]);
  return combined.length > 0 ? combined : undefined;
}

function parseArtifactOption(value, defaultTaskId) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, kind, artifactPath, taskId] = entry.split('|');
      if (!id || !kind || !artifactPath) {
        fail('--add-artifacts entries must use id|kind|path or id|kind|path|taskId');
      }

      const artifact = { id, kind, path: artifactPath };
      if (taskId || defaultTaskId) {
        artifact.taskId = taskId || defaultTaskId;
      }
      return artifact;
    });
}

function parseErrorOption(value, defaultTaskId) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [code, message, taskId, recoverable] = entry.split('|');
      if (!code || !message) {
        fail('--add-errors entries must use code|message or code|message|taskId|recoverable');
      }

      const error = { code, message };
      if (taskId || defaultTaskId) {
        error.taskId = taskId || defaultTaskId;
      }
      if (recoverable) {
        error.recoverable = recoverable === 'true';
      }
      return error;
    });
}

function validateExecutionStatePayload(executionStatePayload, statePath) {
  const validators = getSchemaValidators();
  const valid = validators.executionState(executionStatePayload);
  if (!valid) {
    fail(`execution-state validation failed for ${statePath}: ${JSON.stringify(validators.executionState.errors ?? [])}`);
  }
}

function validateAdapterRuntimePayload(adapterRuntimePayload, runtimePath) {
  const validators = getSchemaValidators();
  const valid = validators.adapterRuntime(adapterRuntimePayload);
  if (!valid) {
    fail(`adapter runtime validation failed for ${runtimePath}: ${JSON.stringify(validators.adapterRuntime.errors ?? [])}`);
  }
}

function resolveMaybeFromCwd(value) {
  if (!value) {
    return null;
  }

  return resolveFromCwd(value);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function loadOptionalStructuredFile(filePath) {
  const resolvedPath = resolveMaybeFromCwd(filePath);
  if (!resolvedPath || !fileExists(resolvedPath)) {
    return null;
  }

  return readStructuredFile(filePath);
}

function flattenProjectDocRefs(projectPayload) {
  const docs = projectPayload?.spec2flow?.docs ?? {};
  return dedupe(Object.values(docs).flatMap((value) => value ?? []));
}

function findNextReadyTask(taskGraphPayload, executionStatePayload) {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  return taskGraphPayload.taskGraph.tasks.find((task) => taskStateIndex.get(task.id)?.status === 'ready') ?? null;
}

function getTaskArtifacts(executionStatePayload, taskId) {
  return (executionStatePayload.executionState.artifacts ?? []).filter((artifact) => artifact.taskId === taskId);
}

function getTaskErrors(executionStatePayload, taskId) {
  return (executionStatePayload.executionState.errors ?? []).filter((error) => error.taskId === taskId);
}

function buildTaskClaim(task, executionStatePayload, taskGraphPayload, projectPayload, adapterCapabilityPayload, paths) {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskState = taskStateIndex.get(task.id);
  const source = taskGraphPayload.taskGraph.source ?? {};

  return {
    taskClaim: {
      runId: executionStatePayload.executionState.runId,
      workflowName: executionStatePayload.executionState.workflowName,
      taskId: task.id,
      title: task.title,
      stage: task.stage,
      goal: task.goal,
      executorType: task.executorType,
      riskLevel: task.riskLevel,
      reviewPolicy: task.reviewPolicy,
      modelAdapterCapabilityRef: paths.adapterCapability ?? null,
      modelAdapterCapability: adapterCapabilityPayload?.adapter ?? null,
      repositoryContext: {
        projectAdapterRef: source.projectAdapterRef ?? null,
        topologyRef: source.topologyRef ?? null,
        riskPolicyRef: source.riskPolicyRef ?? null,
        docs: flattenProjectDocRefs(projectPayload),
        changedFiles: source.changeSet ?? [],
        targetFiles: task.targetFiles ?? [],
        verifyCommands: task.verifyCommands ?? [],
        taskInputs: task.inputs ?? {}
      },
      runtimeContext: {
        executionStateRef: paths.state,
        taskGraphRef: paths.taskGraph,
        currentRunStatus: executionStatePayload.executionState.status,
        currentStage: executionStatePayload.executionState.currentStage,
        attempt: taskState?.attempts ?? 0,
        artifactRefs: taskState?.artifactRefs ?? [],
        taskArtifacts: getTaskArtifacts(executionStatePayload, task.id),
        taskErrors: getTaskErrors(executionStatePayload, task.id),
        artifactsDir: task.artifactsDir ?? null,
        dependsOn: task.dependsOn ?? []
      },
      instructions: [
        `Execute only the task identified by ${task.id}.`,
        'Respect the declared target files, verification commands, and review policy.',
        'Persist outputs back into execution-state.json before moving to downstream tasks.'
      ]
    }
  };
}

function claimNextTaskPayload(statePath, taskGraphPath, options = {}) {
  const executionStatePayload = readStructuredFile(statePath);
  const taskGraphPayload = readStructuredFile(taskGraphPath);
  const projectPayload = loadOptionalStructuredFile(taskGraphPayload.taskGraph.source?.projectAdapterRef);
  const adapterCapabilityPayload = loadOptionalStructuredFile(options['adapter-capability']);
  const nextTask = findNextReadyTask(taskGraphPayload, executionStatePayload);

  if (!nextTask) {
    return {
      taskClaim: null,
      message: 'no ready task available for claiming',
      runId: executionStatePayload.executionState.runId,
      workflowName: executionStatePayload.executionState.workflowName,
      status: executionStatePayload.executionState.status
    };
  }

  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskState = taskStateIndex.get(nextTask.id);
  const now = new Date().toISOString();
  const shouldMarkInProgress = !options['no-mark-in-progress'];

  if (shouldMarkInProgress) {
    taskState.status = 'in-progress';
    taskState.attempts = (taskState.attempts ?? 0) + 1;
    taskState.executor = options.executor ?? taskState.executor;
    setTaskTerminalTimestamp(taskState, 'in-progress', now);
    executionStatePayload.executionState.status = 'running';
    executionStatePayload.executionState.currentStage = nextTask.stage;
    executionStatePayload.executionState.updatedAt = now;
    validateExecutionStatePayload(executionStatePayload, statePath);
    writeJson(statePath, executionStatePayload);
  }

  return buildTaskClaim(nextTask, executionStatePayload, taskGraphPayload, projectPayload, adapterCapabilityPayload, {
    state: statePath,
    taskGraph: taskGraphPath,
    adapterCapability: options['adapter-capability'] ?? null
  });
}

function getTaskIdFromClaim(claimPayload) {
  return claimPayload?.taskClaim?.taskId ?? null;
}

function buildTaskResultReceipt(taskId, status, statePath, notes, artifacts, errors) {
  return {
    taskResult: {
      taskId,
      status,
      executionStateRef: statePath,
      notes,
      artifacts,
      errors,
      submittedAt: new Date().toISOString()
    }
  };
}

function getRouteNameFromTaskId(taskId) {
  if (!taskId.includes('--')) {
    return taskId;
  }

  return taskId.split('--')[0];
}

function sanitizeStageName(stage) {
  return stage.replaceAll(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function applyTaskResult(executionStatePayload, taskGraphPayload, statePath, payload) {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskGraphTaskIndex = getTaskGraphTaskIndex(taskGraphPayload);
  const now = new Date().toISOString();
  const taskState = taskStateIndex.get(payload.taskId);
  const taskGraphTask = taskGraphTaskIndex.get(payload.taskId);

  if (!taskState || !taskGraphTask) {
    fail(`unknown task id: ${payload.taskId}`);
  }

  taskState.status = payload.taskStatus;
  taskState.notes = appendUniqueItems(taskState.notes, payload.notes);
  taskState.artifactRefs = appendUniqueItems(taskState.artifactRefs, payload.artifacts.map((artifact) => artifact.id));
  taskState.executor = payload.executor ?? taskState.executor;
  setTaskTerminalTimestamp(taskState, payload.taskStatus, now);

  if (payload.artifacts.length > 0) {
    executionStatePayload.executionState.artifacts = [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...payload.artifacts
    ];
  }

  if (payload.errors.length > 0) {
    executionStatePayload.executionState.errors = [
      ...(executionStatePayload.executionState.errors ?? []),
      ...payload.errors
    ];
  }

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = payload.workflowStatus ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  executionStatePayload.executionState.currentStage = payload.currentStage ?? inferCurrentStage(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.updatedAt = now;
  validateExecutionStatePayload(executionStatePayload, statePath);
  writeJson(statePath, executionStatePayload);

  return buildTaskResultReceipt(payload.taskId, payload.taskStatus, statePath, payload.notes, payload.artifacts, payload.errors);
}

function buildSimulatedAdapterOutput(claimPayload, adapterCapabilityPayload, options) {
  const claim = claimPayload.taskClaim;
  const stageName = sanitizeStageName(claim.stage);
  const routeName = getRouteNameFromTaskId(claim.taskId);
  const adapterName = adapterCapabilityPayload?.adapter?.name ?? options.adapter ?? 'simulated-adapter';
  const outputPath = `spec2flow/outputs/execution/${routeName}/${stageName}-output.json`;
  const artifactId = `${claim.taskId}-${stageName}-output`;
  const summary = options.summary ?? `simulated-${claim.stage}-completed`;

  return {
    adapterRun: {
      adapterName,
      provider: adapterCapabilityPayload?.adapter?.provider ?? 'simulation',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: options['result-status'] ?? 'completed',
      summary,
      notes: [
        `simulated-adapter:${adapterName}`,
        `simulated-stage:${claim.stage}`,
        ...(parseCsvOption(options.notes))
      ],
      artifacts: [
        {
          id: artifactId,
          kind: 'report',
          path: outputPath,
          taskId: claim.taskId
        }
      ],
      errors: []
    }
  };
}

function buildAdapterTemplateContext(claimPayload, statePath, taskGraphPath, options = {}) {
  const claim = claimPayload.taskClaim ?? {};
  const adapterRuntimePayload = options.adapterRuntimePayload ?? null;

  return {
    adapterCapabilityPath: options['adapter-capability'] ?? '',
    claimPath: options.claim ?? '',
    outputBase: options['output-base'] ?? '',
    outputPath: options['adapter-output'] ?? '',
    adapterModel: adapterRuntimePayload?.adapterRuntime?.model ?? '',
    runId: claim.runId ?? '',
    workflowName: claim.workflowName ?? '',
    taskId: claim.taskId ?? '',
    stage: claim.stage ?? '',
    goal: claim.goal ?? '',
    statePath,
    taskGraphPath
  };
}

function expandTemplateValue(value, context) {
  return value.replaceAll(/\$\{([^}]+)\}/g, (match, key) => {
    if (Object.hasOwn(context, key)) {
      return String(context[key] ?? '');
    }

    return match;
  });
}

function normalizeAdapterArtifacts(artifacts, taskId) {
  return (artifacts ?? []).map((artifact, index) => ({
    id: artifact.id ?? `${taskId}-artifact-${index + 1}`,
    kind: artifact.kind ?? 'report',
    path: artifact.path,
    taskId: artifact.taskId ?? taskId
  }));
}

function normalizeAdapterErrors(errors, taskId) {
  return (errors ?? []).map((error) => ({
    code: error.code ?? error.type ?? 'adapter-error',
    message: error.message,
    taskId: error.taskId ?? taskId,
    recoverable: error.recoverable
  }));
}

function extractJsonPayload(content) {
  const trimmed = content.trim();
  const firstObjectStart = trimmed.indexOf('{');
  const lastObjectEnd = trimmed.lastIndexOf('}');

  if (firstObjectStart === -1 || lastObjectEnd === -1 || lastObjectEnd < firstObjectStart) {
    return trimmed;
  }

  return trimmed.slice(firstObjectStart, lastObjectEnd + 1);
}

function runCommandCapture(command, args, execOptions = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...execOptions
    });

    return {
      ok: true,
      stdout,
      stderr: ''
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
      error
    };
  }
}

function normalizeAdapterRunPayload(payload, adapterRuntimePayload, claimPayload) {
  const claim = claimPayload.taskClaim;
  const adapterRun = payload.adapterRun ?? payload;

  if (!adapterRun || typeof adapterRun !== 'object') {
    fail('adapter output must be a JSON object or contain an adapterRun object');
  }

  return {
    adapterRun: {
      adapterName: adapterRun.adapterName ?? adapterRuntimePayload.adapterRuntime.name,
      provider: adapterRun.provider ?? adapterRuntimePayload.adapterRuntime.provider ?? 'external-adapter',
      taskId: adapterRun.taskId ?? claim.taskId,
      runId: adapterRun.runId ?? claim.runId,
      stage: adapterRun.stage ?? claim.stage,
      status: adapterRun.status ?? 'completed',
      summary: adapterRun.summary ?? `${claim.taskId}-completed`,
      notes: adapterRun.notes ?? [],
      artifacts: normalizeAdapterArtifacts(adapterRun.artifacts, claim.taskId),
      errors: normalizeAdapterErrors(adapterRun.errors, claim.taskId)
    }
  };
}

function runExternalAdapter(adapterRuntimePayload, claimPayload, statePath, taskGraphPath, options = {}) {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const templateContext = buildAdapterTemplateContext(claimPayload, statePath, taskGraphPath, {
    ...options,
    adapterRuntimePayload
  });
  const command = expandTemplateValue(adapterRuntime.command, templateContext);
  const args = (adapterRuntime.args ?? []).map((arg) => expandTemplateValue(arg, templateContext));
  const env = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(adapterRuntime.env ?? {}).map(([key, value]) => [key, expandTemplateValue(value, templateContext)])
    )
  };
  const cwd = adapterRuntime.cwd ? resolveFromCwd(expandTemplateValue(adapterRuntime.cwd, templateContext)) : process.cwd();

  let stdout = '';

  try {
    stdout = execFileSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      input: `${JSON.stringify(claimPayload, null, 2)}\n`,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdoutText = error.stdout?.toString().trim();
    fail(`adapter command failed: ${stderr || stdoutText || error.message}`);
  }

  let adapterOutputPayload;

  if (adapterRuntime.outputMode === 'stdout') {
    const trimmed = stdout.trim();
    if (!trimmed) {
      fail('adapter command returned empty stdout; expected JSON output');
    }

    try {
      adapterOutputPayload = JSON.parse(trimmed);
    } catch (error) {
      fail(`adapter stdout is not valid JSON: ${error.message}`);
    }
  } else {
    const outputPath = expandTemplateValue(adapterRuntime.outputPath ?? templateContext.outputPath, templateContext);
    if (!outputPath) {
      fail('adapter runtime with outputMode=file requires outputPath or --adapter-output');
    }
    const resolvedOutputPath = resolveFromCwd(outputPath);
    if (!fileExists(resolvedOutputPath)) {
      fail(`adapter output file was not written: ${outputPath}`);
    }
    adapterOutputPayload = readStructuredFile(outputPath);
  }

  return normalizeAdapterRunPayload(adapterOutputPayload, adapterRuntimePayload, claimPayload);
}

function buildCopilotPreflightPrompt() {
  return 'Respond with exactly this JSON and nothing else: {"status":"completed","summary":"ok","notes":[],"deliverable":{},"errors":[]}';
}

function getCommandResultMessage(commandResult, fallbackMessage) {
  return commandResult.stderr.trim() || commandResult.stdout.trim() || commandResult.error?.message || fallbackMessage;
}

function buildPreflightCheck(name, status, message) {
  return { name, status, message };
}

function getBlockingPreflightFailures(checks) {
  const blockingCheckNames = new Set(['gh copilot help', 'gh copilot prompt probe']);
  return checks.filter((check) => blockingCheckNames.has(check.name) && check.status === 'failed');
}

function buildCopilotProbeArgs(configuredModel) {
  const args = [
    'copilot',
    '--',
    '-p',
    buildCopilotPreflightPrompt(),
    '-s',
    '--stream',
    'off',
    '--no-color'
  ];

  if (configuredModel) {
    args.push('--model', configuredModel);
  }

  return args;
}

function evaluateCopilotProbe(probeResult) {
  if (!probeResult.ok) {
    return buildPreflightCheck('gh copilot prompt probe', 'failed', getCommandResultMessage(probeResult, 'gh copilot prompt failed'));
  }

  try {
    const payload = JSON.parse(extractJsonPayload(probeResult.stdout));
    if (payload.status === 'completed' && payload.summary === 'ok') {
      return buildPreflightCheck('gh copilot prompt probe', 'passed', 'gh copilot -p returned valid JSON');
    }

    return buildPreflightCheck('gh copilot prompt probe', 'failed', 'gh copilot -p returned JSON but not the expected probe payload');
  } catch (error) {
    return buildPreflightCheck('gh copilot prompt probe', 'failed', `gh copilot -p returned non-JSON output: ${error.message}`);
  }
}

function buildCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload) {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const configuredModel = adapterRuntime.model ?? '';
  const report = {
    preflight: {
      adapterRuntimeRef: adapterRuntimePath,
      provider: adapterRuntime.provider ?? 'unknown',
      configuredModel: configuredModel || null,
      effectiveModel: configuredModel || 'copilot-default',
      checks: []
    }
  };

  const helpResult = runCommandCapture('gh', ['copilot', '--', '--help']);
  report.preflight.checks.push(buildPreflightCheck(
    'gh copilot help',
    helpResult.ok ? 'passed' : 'failed',
    helpResult.ok ? 'gh copilot command is available' : getCommandResultMessage(helpResult, 'gh copilot help failed')
  ));

  const authResult = runCommandCapture('gh', ['auth', 'status']);
  report.preflight.checks.push(buildPreflightCheck(
    'gh auth status',
    authResult.ok ? 'passed' : 'failed',
    authResult.ok ? 'gh auth status succeeded' : getCommandResultMessage(authResult, 'gh auth status failed')
  ));

  const probeResult = runCommandCapture('gh', buildCopilotProbeArgs(configuredModel), {
    env: {
      ...process.env,
      COPILOT_ALLOW_ALL: 'true'
    }
  });
  report.preflight.checks.push(evaluateCopilotProbe(probeResult));

  const blockingFailures = getBlockingPreflightFailures(report.preflight.checks);
  report.preflight.status = blockingFailures.length === 0 ? 'passed' : 'failed';

  return { report, blockingFailures };
}

function maybeWritePreflightReport(outputPath, report) {
  if (!outputPath) {
    return;
  }

  writeJson(outputPath, report);
  console.log(`Wrote Copilot CLI preflight report to ${outputPath}`);
}

function ensureAdapterPreflight(options, adapterRuntimePayload) {
  if (options['skip-preflight']) {
    return;
  }

  const adapterRuntimePath = options['adapter-runtime'];
  if (!adapterRuntimePath || adapterRuntimePayload?.adapterRuntime?.provider !== 'github-copilot-cli') {
    return;
  }

  const { report, blockingFailures } = buildCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload);
  maybeWritePreflightReport(options['preflight-output'], report);

  if (blockingFailures.length > 0) {
    fail(`copilot cli preflight failed: ${blockingFailures.map((check) => `${check.name}: ${check.message}`).join(' | ')}`);
  }
}

function runPreflightCopilotCli(options) {
  const adapterRuntimePath = options['adapter-runtime'];

  if (!adapterRuntimePath) {
    fail('preflight-copilot-cli requires --adapter-runtime');
  }

  const adapterRuntimePayload = readStructuredFile(adapterRuntimePath);
  validateAdapterRuntimePayload(adapterRuntimePayload, adapterRuntimePath);

  const { report, blockingFailures } = buildCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload);

  if (options.output) {
    maybeWritePreflightReport(options.output, report);
  } else {
    printJson(report);
  }

  if (blockingFailures.length > 0) {
    process.exitCode = 1;
  }
}

function executeTaskRun(statePath, taskGraphPath, claimPayload, options = {}) {
  const executionStatePayload = readStructuredFile(statePath);
  const taskGraphPayload = readStructuredFile(taskGraphPath);
  const adapterCapabilityPayload = loadOptionalStructuredFile(options['adapter-capability']);
  const adapterRuntimePayload = options['adapter-runtime'] ? readStructuredFile(options['adapter-runtime']) : null;

  if (adapterRuntimePayload) {
    validateAdapterRuntimePayload(adapterRuntimePayload, options['adapter-runtime']);
  }

  const runOutput = adapterRuntimePayload
    ? runExternalAdapter(adapterRuntimePayload, claimPayload, statePath, taskGraphPath, options)
    : buildSimulatedAdapterOutput(claimPayload, adapterCapabilityPayload, options);

  const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
    taskId: claimPayload.taskClaim.taskId,
    taskStatus: runOutput.adapterRun.status,
    notes: [`summary:${runOutput.adapterRun.summary}`, ...runOutput.adapterRun.notes],
    artifacts: runOutput.adapterRun.artifacts,
    errors: runOutput.adapterRun.errors,
    executor: options.executor ?? claimPayload.taskClaim.executorType,
    workflowStatus: options.status,
    currentStage: options.stage
  });

  return {
    adapterRun: runOutput.adapterRun,
    receipt: receipt.taskResult,
    mode: adapterRuntimePayload ? 'external-adapter' : 'simulation'
  };
}

function runValidate(options) {
  const projectPath = options.project;
  const topologyPath = options.topology;
  const riskPath = options.risk;

  if (!projectPath || !topologyPath || !riskPath) {
    fail('validate-onboarding requires --project, --topology, and --risk');
  }

  const projectPayload = readStructuredFile(projectPath);
  const topologyPayload = readStructuredFile(topologyPath);
  const riskPayload = readStructuredFile(riskPath);
  const result = buildValidatorResult(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  });

  if (options.output) {
    writeJson(options.output, result);
    console.log(`Wrote validator result to ${options.output}`);
  } else {
    printJson(result);
  }

  if (result.validatorResult.status === 'failed') {
    process.exitCode = 1;
  }
}

function runGenerate(options) {
  const projectPath = options.project;
  const topologyPath = options.topology;
  const riskPath = options.risk;

  if (!projectPath || !topologyPath || !riskPath) {
    fail('generate-task-graph requires --project, --topology, and --risk');
  }

  const projectPayload = readStructuredFile(projectPath);
  const topologyPayload = readStructuredFile(topologyPath);
  const riskPayload = readStructuredFile(riskPath);
  const changedFiles = getChangedFiles(options);
  const validatorResult = buildValidatorResult(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  });

  if (validatorResult.validatorResult.status === 'failed') {
    fail('cannot generate task graph because onboarding validation failed');
  }

  const taskGraph = buildTaskGraph(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  }, changedFiles);

  if (options.output) {
    writeJson(options.output, taskGraph);
    console.log(`Wrote task graph to ${options.output}`);
  } else {
    printJson(taskGraph);
  }
}

function runInitExecutionState(options) {
  const taskGraphPath = options['task-graph'];

  if (!taskGraphPath) {
    fail('init-execution-state requires --task-graph');
  }

  const taskGraphPayload = readStructuredFile(taskGraphPath);
  const executionStatePayload = buildExecutionState(taskGraphPayload, options, {
    taskGraph: taskGraphPath
  });

  validateExecutionStatePayload(executionStatePayload, taskGraphPath);

  if (options.output) {
    writeJson(options.output, executionStatePayload);
    console.log(`Wrote execution state to ${options.output}`);
  } else {
    printJson(executionStatePayload);
  }
}

function runUpdateExecutionState(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (!statePath || !taskGraphPath) {
    fail('update-execution-state requires --state and --task-graph');
  }

  const executionStatePayload = readStructuredFile(statePath);
  const taskGraphPayload = readStructuredFile(taskGraphPath);
  const taskGraphTaskIndex = getTaskGraphTaskIndex(taskGraphPayload);
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskId = options['task-id'];
  const taskStatus = options['task-status'];
  const now = new Date().toISOString();

  if (taskId) {
    const taskState = taskStateIndex.get(taskId);
    const taskGraphTask = taskGraphTaskIndex.get(taskId);

    if (!taskState || !taskGraphTask) {
      fail(`unknown task id: ${taskId}`);
    }

    if (taskStatus) {
      taskState.status = taskStatus;
      if ((taskStatus === 'in-progress' || options['increment-attempts']) && typeof taskState.attempts === 'number') {
        taskState.attempts += 1;
      }
      setTaskTerminalTimestamp(taskState, taskStatus, now);
    }

    if (options.executor) {
      taskState.executor = options.executor;
    }

    taskState.notes = appendUniqueItems(taskState.notes, parseCsvOption(options.notes));
    taskState.artifactRefs = appendUniqueItems(taskState.artifactRefs, parseCsvOption(options['artifact-refs']));
  }

  const artifactsToAdd = parseArtifactOption(options['add-artifacts'], taskId);
  const errorsToAdd = parseErrorOption(options['add-errors'], taskId);

  if (artifactsToAdd.length > 0) {
    executionStatePayload.executionState.artifacts = [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...artifactsToAdd
    ];
  }

  if (errorsToAdd.length > 0) {
    executionStatePayload.executionState.errors = [
      ...(executionStatePayload.executionState.errors ?? []),
      ...errorsToAdd
    ];
  }

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = options.status ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  executionStatePayload.executionState.currentStage = options.stage ?? inferCurrentStage(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.updatedAt = now;

  validateExecutionStatePayload(executionStatePayload, statePath);

  if (options.output) {
    writeJson(options.output, executionStatePayload);
    console.log(`Wrote execution state to ${options.output}`);
    return;
  }

  writeJson(statePath, executionStatePayload);
  console.log(`Updated execution state at ${statePath}`);
}

function runClaimNextTask(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (!statePath || !taskGraphPath) {
    fail('claim-next-task requires --state and --task-graph');
  }
  const claimPayload = claimNextTaskPayload(statePath, taskGraphPath, options);

  if (options.output) {
    writeJson(options.output, claimPayload);
    console.log(`Wrote task claim to ${options.output}`);
    return;
  }

  printJson(claimPayload);
}

function runSubmitTaskResult(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (!statePath || !taskGraphPath) {
    fail('submit-task-result requires --state and --task-graph');
  }

  const executionStatePayload = readStructuredFile(statePath);
  const taskGraphPayload = readStructuredFile(taskGraphPath);
  const claimPayload = loadOptionalStructuredFile(options.claim);
  const taskId = options['task-id'] ?? getTaskIdFromClaim(claimPayload);
  const taskStatus = options['result-status'] ?? options['task-status'] ?? 'completed';

  if (!taskId) {
    fail('submit-task-result requires --task-id or --claim');
  }

  const notes = parseCsvOption(options.notes);
  if (options.summary) {
    notes.unshift(`summary:${options.summary}`);
  }

  const artifactsToAdd = parseArtifactOption(options['add-artifacts'], taskId);
  const errorsToAdd = parseErrorOption(options['add-errors'], taskId);

  const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
    taskId,
    taskStatus,
    notes,
    artifacts: artifactsToAdd,
    errors: errorsToAdd,
    executor: options.executor,
    workflowStatus: options.status,
    currentStage: options.stage
  });

  if (options.output) {
    writeJson(options.output, receipt);
    console.log(`Wrote task result to ${options.output}`);
    return;
  }

  printJson(receipt);
}

function runSimulateModelRun(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];
  const claimPath = options.claim;

  if (!statePath || !taskGraphPath || !claimPath) {
    fail('simulate-model-run requires --state, --task-graph, and --claim');
  }

  const claimPayload = readStructuredFile(claimPath);
  const result = executeTaskRun(statePath, taskGraphPath, claimPayload, options);
  const outputPayload = {
    simulatedRun: result.adapterRun,
    receipt: result.receipt
  };

  if (options.output) {
    writeJson(options.output, outputPayload);
    console.log(`Wrote simulated model run to ${options.output}`);
    return;
  }

  printJson(outputPayload);
}

function runTaskWithAdapter(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];
  const claimPath = options.claim;

  if (!statePath || !taskGraphPath || !claimPath || !options['adapter-runtime']) {
    fail('run-task-with-adapter requires --state, --task-graph, --claim, and --adapter-runtime');
  }

  const adapterRuntimePayload = readStructuredFile(options['adapter-runtime']);
  validateAdapterRuntimePayload(adapterRuntimePayload, options['adapter-runtime']);
  ensureAdapterPreflight(options, adapterRuntimePayload);

  const claimPayload = readStructuredFile(claimPath);
  const result = executeTaskRun(statePath, taskGraphPath, claimPayload, options);
  const outputPayload = {
    adapterRun: result.adapterRun,
    receipt: result.receipt
  };

  if (options.output) {
    writeJson(options.output, outputPayload);
    console.log(`Wrote adapter run result to ${options.output}`);
    return;
  }

  printJson(outputPayload);
}

function runWorkflowLoop(options) {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (!statePath || !taskGraphPath) {
    fail('run-workflow-loop requires --state and --task-graph');
  }

  const maxSteps = Number.parseInt(options['max-steps'] ?? '100', 10);
  if (Number.isNaN(maxSteps) || maxSteps < 1) {
    fail('--max-steps must be a positive integer');
  }

  const adapterRuntimePayload = options['adapter-runtime'] ? readStructuredFile(options['adapter-runtime']) : null;
  if (adapterRuntimePayload) {
    validateAdapterRuntimePayload(adapterRuntimePayload, options['adapter-runtime']);
    ensureAdapterPreflight(options, adapterRuntimePayload);
  }

  const outputBase = options['output-base'] ?? 'docs/examples/synapse-network/generated';
  const loopSummary = {
    workflowLoop: {
      runId: null,
      workflowName: null,
      maxSteps,
      stepsExecuted: 0,
      stopReason: 'max-steps-reached',
      claimedTaskIds: [],
      receipts: []
    }
  };

  for (let step = 1; step <= maxSteps; step += 1) {
    const claimPayload = claimNextTaskPayload(statePath, taskGraphPath, {
      ...options,
      output: undefined
    });

    if (!loopSummary.workflowLoop.runId) {
      loopSummary.workflowLoop.runId = claimPayload.runId ?? claimPayload.taskClaim?.runId ?? readStructuredFile(statePath).executionState.runId;
      loopSummary.workflowLoop.workflowName = claimPayload.workflowName ?? claimPayload.taskClaim?.workflowName ?? readStructuredFile(statePath).executionState.workflowName;
    }

    if (!claimPayload.taskClaim) {
      loopSummary.workflowLoop.stopReason = claimPayload.status ?? 'no-ready-task';
      break;
    }

    const claimFile = path.join(outputBase, `task-claim-step-${step}.json`);
    writeJson(claimFile, claimPayload);

    const adapterFile = path.join(
      outputBase,
      `${options['adapter-runtime'] ? 'adapter-run' : 'simulated-model-run'}-step-${step}.json`
    );
    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      ...options,
      claim: claimFile,
      'adapter-output': adapterFile
    });
    writeJson(adapterFile, {
      adapterRun: result.adapterRun,
      receipt: result.receipt
    });

    loopSummary.workflowLoop.stepsExecuted = step;
    loopSummary.workflowLoop.claimedTaskIds.push(claimPayload.taskClaim.taskId);
    loopSummary.workflowLoop.receipts.push({
      taskId: result.receipt.taskId,
      status: result.receipt.status,
      claimRef: claimFile,
      adapterRunRef: adapterFile,
      executionMode: result.mode
    });

    const updatedState = readStructuredFile(statePath);
    if (updatedState.executionState.status === 'completed') {
      loopSummary.workflowLoop.stopReason = 'completed';
      break;
    }
  }

  if (options.output) {
    writeJson(options.output, loopSummary);
    console.log(`Wrote workflow loop summary to ${options.output}`);
    return;
  }

  printJson(loopSummary);
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'validate-onboarding') {
    runValidate(options);
    return;
  }

  if (command === 'generate-task-graph') {
    runGenerate(options);
    return;
  }

  if (command === 'init-execution-state') {
    runInitExecutionState(options);
    return;
  }

  if (command === 'update-execution-state') {
    runUpdateExecutionState(options);
    return;
  }

  if (command === 'claim-next-task') {
    runClaimNextTask(options);
    return;
  }

  if (command === 'submit-task-result') {
    runSubmitTaskResult(options);
    return;
  }

  if (command === 'simulate-model-run') {
    runSimulateModelRun(options);
    return;
  }

  if (command === 'preflight-copilot-cli') {
    runPreflightCopilotCli(options);
    return;
  }

  if (command === 'run-task-with-adapter') {
    runTaskWithAdapter(options);
    return;
  }

  if (command === 'run-workflow-loop') {
    runWorkflowLoop(options);
    return;
  }

  fail('usage: spec2flow <validate-onboarding|generate-task-graph|init-execution-state|update-execution-state|claim-next-task|submit-task-result|simulate-model-run|preflight-copilot-cli|run-task-with-adapter|run-workflow-loop> --project <file> --topology <file> --risk <file> [--changed-files <a,b>] [--changed-files-file <file>] [--changed-files-from-git] [--git-diff-repo <path>] [--git-base <ref>] [--git-head <ref>] [--git-staged] [--task-graph <file>] [--state <file>] [--task-id <id>] [--task-status <status>] [--result-status <status>] [--claim <file>] [--adapter-capability <file>] [--adapter-runtime <file>] [--adapter-output <file>] [--preflight-output <file>] [--skip-preflight] [--max-steps <n>] [--output-base <dir>] [--output <file>]');
}

main();