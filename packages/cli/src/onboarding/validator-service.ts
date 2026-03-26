import { getSchemaValidators } from '../shared/schema-registry.js';

export interface ValidatorCheck {
  name: string;
  type: string;
  status: 'passed' | 'failed' | 'warning';
  target: string;
  message: string;
  details?: unknown;
}

export interface ValidatorSummary {
  passed: number;
  warnings: number;
  failed: number;
}

export interface ValidatorPaths {
  project: string;
  topology: string;
  risk: string;
}

export interface ValidateOnboardingResultDocument {
  validatorResult: {
    status: 'passed' | 'failed' | 'passed-with-warnings';
    projectAdapterRef: string;
    topologyRef: string;
    riskPolicyRef: string;
    checks: ValidatorCheck[];
    summary: ValidatorSummary;
  };
}

interface ProjectService {
  dependsOn?: string[];
}

interface ProjectPayload {
  spec2flow: {
    services: Record<string, ProjectService>;
  };
}

interface TopologyService {
  name: string;
  dependsOn?: string[];
}

interface WorkflowRoute {
  name: string;
  entryServices: string[];
  reviewPolicy?: {
    required?: boolean;
    reviewAgentCount?: number;
    requireHumanApproval?: boolean;
    allowAutoCommit?: boolean;
  };
}

interface TopologyPayload {
  topology: {
    services: TopologyService[];
    startupOrder?: string[];
    workflowRoutes?: WorkflowRoute[];
  };
}

interface AutomationLevel {
  maxAutonomy: string;
}

interface RiskPayload {
  riskPolicy: {
    defaultLevel?: string;
    automationLevels?: AutomationLevel[];
  };
}

function pushCheck(
  checks: ValidatorCheck[],
  name: string,
  type: string,
  status: ValidatorCheck['status'],
  target: string,
  message: string,
  details: unknown = undefined
): void {
  const check: ValidatorCheck = { name, type, status, target, message };
  if (details !== undefined) {
    check.details = details;
  }
  checks.push(check);
}

function validateSchema(
  checks: ValidatorCheck[],
  validator: { (payload: unknown): boolean; errors?: unknown[] | null },
  schemaName: string,
  payload: unknown,
  target: string
): void {
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

function validateProjectDependencies(
  project: ProjectPayload,
  topologyServiceNames: Set<string>,
  checks: ValidatorCheck[],
  projectPath: string
): void {
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

function validateTopologyDependencies(
  service: TopologyService,
  serviceNames: Set<string>,
  checks: ValidatorCheck[],
  topologyPath: string
): void {
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

function getStartupProblems(service: TopologyService, dependencies: string[], startupIndex: Map<string, number>): string[] {
  const startupProblems: string[] = [];

  if (!startupIndex.has(service.name)) {
    startupProblems.push(`service ${service.name} missing from startupOrder`);
  }

  for (const dependency of dependencies) {
    if (!startupIndex.has(dependency)) {
      startupProblems.push(`dependency ${dependency} missing from startupOrder`);
      continue;
    }
    if (startupIndex.has(service.name) && startupIndex.get(dependency)! > startupIndex.get(service.name)!) {
      startupProblems.push(`dependency ${dependency} starts after ${service.name}`);
    }
  }

  return startupProblems;
}

function validateStartupOrder(
  service: TopologyService,
  dependencies: string[],
  startupIndex: Map<string, number>,
  checks: ValidatorCheck[],
  topologyPath: string
): void {
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

function validateWorkflowRoutes(topology: TopologyPayload, serviceNames: Set<string>, checks: ValidatorCheck[], topologyPath: string): void {
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

function validateTopology(topology: TopologyPayload, checks: ValidatorCheck[], topologyPath: string): Set<string> {
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

function validateRiskPolicy(risk: RiskPayload, checks: ValidatorCheck[], riskPath: string): void {
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

export function buildValidatorResult(
  projectPayload: ProjectPayload,
  topologyPayload: TopologyPayload,
  riskPayload: RiskPayload,
  paths: ValidatorPaths
): ValidateOnboardingResultDocument {
  const validators = getSchemaValidators();
  const checks: ValidatorCheck[] = [];

  validateSchema(checks, validators.project, 'project-adapter', projectPayload, paths.project);
  validateSchema(checks, validators.topology, 'system-topology', topologyPayload, paths.topology);
  validateSchema(checks, validators.risk, 'risk-policy', riskPayload, paths.risk);

  const topologyServiceNames = validateTopology(topologyPayload, checks, paths.topology);
  validateProjectDependencies(projectPayload, topologyServiceNames, checks, paths.project);
  validateRiskPolicy(riskPayload, checks, paths.risk);

  const summary: ValidatorSummary = {
    passed: checks.filter((check) => check.status === 'passed').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    failed: checks.filter((check) => check.status === 'failed').length
  };

  let status: ValidateOnboardingResultDocument['validatorResult']['status'] = 'passed';
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