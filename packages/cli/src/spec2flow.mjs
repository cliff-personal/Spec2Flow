#!/usr/bin/env node

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
    risk: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/risk-policy.schema.json')))
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

function getChangedFiles(options) {
  const inlineFiles = (options['changed-files'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fileListPath = options['changed-files-file'];

  if (!fileListPath) {
    return inlineFiles.map(normalizePath);
  }

  const fileContent = readTextFile(fileListPath);
  const filePaths = fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return [...inlineFiles, ...filePaths].map(normalizePath);
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

  fail('usage: spec2flow <validate-onboarding|generate-task-graph> --project <file> --topology <file> --risk <file> [--changed-files <a,b>] [--changed-files-file <file>] [--output <file>]');
}

main();