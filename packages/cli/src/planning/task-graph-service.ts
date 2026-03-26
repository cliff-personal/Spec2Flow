import { execFileSync } from 'node:child_process';
import { minimatch } from 'minimatch';
import { dedupe } from '../shared/collection-utils.js';
import { fail, readChangedFilesContent, readTextFile, resolveFromCwd } from '../shared/fs-utils.js';
import { buildTaskRoleProfile } from '../shared/task-role-profile.js';
import type { RequirementTaskPlan, RiskLevel, Task, TaskGraphDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

interface RouteRequirementMatch {
  matched: boolean;
  score: number;
  matchedPhrases: string[];
  matchedKeywords: string[];
}

interface RouteSelectionResult {
  routes: Array<Record<string, any>>;
  mode: string;
  matchIndex: Map<string, RouteRequirementMatch>;
}

const riskWeight: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const genericRequirementSignalKeywords = new Set([
  'flow',
  'route',
  'workflow',
  'service',
  'services',
  'app',
  'api'
]);

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function runGitCommand(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const commandError = error as { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string };
    const stderr = commandError.stderr?.toString().trim();
    const stdout = commandError.stdout?.toString().trim();
    fail(`failed to collect changed files from git diff: ${stderr || stdout || commandError.message}`);
  }
}

function getChangedFilesFromGit(options: CliOptions): string[] {
  if (!options['changed-files-from-git']) {
    return [];
  }

  const gitBase = typeof options['git-base'] === 'string' ? options['git-base'] : undefined;
  const gitHead = typeof options['git-head'] === 'string' ? options['git-head'] : undefined;
  const gitStaged = Boolean(options['git-staged']);

  if (gitHead && !gitBase) {
    fail('--git-head requires --git-base');
  }

  if (gitStaged && (gitBase || gitHead)) {
    fail('--git-staged cannot be combined with --git-base or --git-head');
  }

  const repoPath = resolveFromCwd(typeof options['git-diff-repo'] === 'string' ? options['git-diff-repo'] : '.');
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

export function getChangedFiles(options: CliOptions): string[] {
  const inlineFiles = (typeof options['changed-files'] === 'string' ? options['changed-files'] : '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fileListPath = typeof options['changed-files-file'] === 'string' ? options['changed-files-file'] : undefined;
  const filePaths = fileListPath ? readChangedFilesContent(readTextFile(fileListPath)) : [];
  const gitPaths = getChangedFilesFromGit(options);

  return dedupe([...inlineFiles, ...filePaths, ...gitPaths].map(normalizePath));
}

export function getRequirementText(options: CliOptions): string {
  const inlineRequirement = typeof options.requirement === 'string' ? options.requirement.trim() : '';
  const requirementFile = typeof options['requirement-file'] === 'string' ? options['requirement-file'] : undefined;
  const fileRequirement = requirementFile ? readTextFile(requirementFile).trim() : '';

  return [inlineRequirement, fileRequirement].filter(Boolean).join('\n\n').trim();
}

function normalizeSearchText(value: unknown): string {
  let rawValue = '';

  if (typeof value === 'string') {
    rawValue = value;
  } else if (Array.isArray(value)) {
    rawValue = value.join(' ');
  } else if (value != null) {
    rawValue = JSON.stringify(value);
  }

  return rawValue
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[_/-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function extractSearchTokens(value: unknown): string[] {
  return dedupe(normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? []);
}

function buildRouteRequirementSignals(route: Record<string, any>): { phrases: string[]; keywords: string[] } {
  const explicitSignals = route.requirementSignals ?? {};
  const routeNameTokens = extractSearchTokens(route.name).filter((token: string) => !genericRequirementSignalKeywords.has(token));
  const serviceTokens = (route.entryServices ?? [])
    .flatMap((serviceName: string) => extractSearchTokens(serviceName))
    .filter((token: string) => !genericRequirementSignalKeywords.has(token));

  return {
    phrases: dedupe([explicitSignals.summary, ...(explicitSignals.phrases ?? [])].filter(Boolean)),
    keywords: dedupe([
      ...(explicitSignals.keywords ?? []),
      route.name,
      ...routeNameTokens,
      ...(route.entryServices ?? []),
      ...serviceTokens
    ].filter(Boolean))
  };
}

function getRequirementRouteMatch(route: Record<string, any>, requirementText: string): RouteRequirementMatch {
  const normalizedRequirement = normalizeSearchText(requirementText);

  if (!normalizedRequirement) {
    return {
      matched: false,
      score: 0,
      matchedPhrases: [],
      matchedKeywords: []
    };
  }

  const requirementTokens = new Set(extractSearchTokens(normalizedRequirement));
  const routeSignals = buildRouteRequirementSignals(route);
  const matchedPhrases = routeSignals.phrases.filter((phrase) => {
    const normalizedPhrase = normalizeSearchText(phrase);
    return normalizedPhrase && normalizedRequirement.includes(normalizedPhrase);
  });
  const matchedKeywords = routeSignals.keywords.filter((keyword) => {
    const normalizedKeyword = normalizeSearchText(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    return requirementTokens.has(normalizedKeyword) || normalizedRequirement.includes(normalizedKeyword);
  });

  return {
    matched: matchedPhrases.length > 0 || matchedKeywords.length > 0,
    score: (matchedPhrases.length * 4) + matchedKeywords.length,
    matchedPhrases,
    matchedKeywords
  };
}

function matchesAnyPathPattern(changedFiles: string[], patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }

  return changedFiles.some((changedFile) =>
    patterns.some((pattern) => minimatch(changedFile, pattern, { dot: true }))
  );
}

function getRouteServiceKinds(route: Record<string, any>, project: Record<string, any>, topology: Record<string, any>): Set<string> {
  const topologyServices = new Map<string, { kind?: string }>(
    (topology.topology.services ?? []).map((service: Record<string, any>) => [service.name, service as { kind?: string }])
  );
  return new Set(
    (route.entryServices ?? [])
      .map((serviceName: string) => topologyServices.get(serviceName)?.kind ?? project.spec2flow.services?.[serviceName]?.type)
      .filter(Boolean)
  );
}

function routeRequiresBrowserAutomation(routeServiceKinds: Set<string>): boolean {
  return routeServiceKinds.has('frontend') || routeServiceKinds.has('admin-frontend');
}

function findRouteTargetFiles(route: Record<string, any>, project: Record<string, any>): string[] {
  return dedupe((route.entryServices ?? []).map((serviceName: string) => project.spec2flow.services?.[serviceName]?.path).filter(Boolean));
}

function pathBelongsToTarget(filePath: string, targetPath: string): boolean {
  return filePath === targetPath || filePath.startsWith(`${targetPath}/`);
}

function routeIsAffectedByChangedFiles(route: Record<string, any>, project: Record<string, any>, changedFiles: string[]): boolean {
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

function matchesServiceKinds(routeServiceKinds: Set<string>, serviceKindRules: string[]): boolean {
  if (serviceKindRules.length === 0) {
    return true;
  }

  return serviceKindRules.some((kind) => routeServiceKinds.has(kind));
}

function matchesWorkflow(routeName: string, workflowRules: string[]): boolean {
  if (workflowRules.length === 0) {
    return true;
  }

  return workflowRules.includes(routeName);
}

function selectRoutes(
  topologyPayload: Record<string, any>,
  projectPayload: Record<string, any>,
  changedFiles: string[],
  requirementText: string
): RouteSelectionResult {
  const routes = topologyPayload.topology.workflowRoutes ?? [];

  if (requirementText) {
    const requirementMatches = routes
      .map((route: Record<string, any>) => ({ route, match: getRequirementRouteMatch(route, requirementText) }))
      .filter(({ match }: { match: RouteRequirementMatch }) => match.matched)
      .sort((left: { match: RouteRequirementMatch }, right: { match: RouteRequirementMatch }) => right.match.score - left.match.score);

    if (requirementMatches.length > 0) {
      return {
        routes: requirementMatches.map(({ route }: { route: Record<string, any> }) => route),
        mode: 'requirement',
        matchIndex: new Map(requirementMatches.map(({ route, match }: { route: Record<string, any>; match: RouteRequirementMatch }) => [route.name, match]))
      };
    }

    return {
      routes,
      mode: 'requirement-fallback-all',
      matchIndex: new Map()
    };
  }

  if (changedFiles.length > 0) {
    const affectedRoutes = routes.filter((route: Record<string, any>) => routeIsAffectedByChangedFiles(route, projectPayload, changedFiles));

    return {
      routes: affectedRoutes.length > 0 ? affectedRoutes : routes,
      mode: affectedRoutes.length > 0 ? 'changed-files' : 'changed-files-fallback-all',
      matchIndex: new Map()
    };
  }

  return {
    routes,
    mode: 'all-routes',
    matchIndex: new Map()
  };
}

function getMatchingRiskRules(
  route: Record<string, any>,
  project: Record<string, any>,
  topology: Record<string, any>,
  risk: Record<string, any>,
  changedFiles: string[]
): Array<Record<string, any>> {
  const routeServiceKinds = getRouteServiceKinds(route, project, topology);
  const changedFileSet = changedFiles.map(normalizePath);
  const routeAffected = routeIsAffectedByChangedFiles(route, project, changedFileSet);

  if (!routeAffected) {
    return [];
  }

  return (risk.riskPolicy.rules ?? []).filter((rule: Record<string, any>) => {
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

function getHighestRiskRule(matchingRules: Array<Record<string, any>>): Record<string, any> | null {
  let selectedRule: Record<string, any> | null = null;

  for (const rule of matchingRules) {
    if (!selectedRule || riskWeight[rule.level as RiskLevel] > riskWeight[selectedRule.level as RiskLevel]) {
      selectedRule = rule;
    }
  }

  return selectedRule;
}

function buildReviewPolicy(rule: Record<string, any> | null) {
  return {
    required: Boolean((rule?.requires?.reviewAgents ?? 0) > 0 || rule?.requires?.humanApproval),
    reviewAgentCount: rule?.requires?.reviewAgents ?? 0,
    requireHumanApproval: rule?.requires?.humanApproval ?? false,
    maxAutoRepairAttempts: rule?.requires?.maxAutoRepairAttempts ?? 0,
    maxExecutionRetries: rule?.requires?.maxExecutionRetries ?? 0,
    allowAutoCommit: rule?.requires?.allowAutoCommit ?? false,
    blockedRiskLevels: rule?.requires?.blockedRiskLevels ?? []
  };
}

function summarizeRequirementForRoute(route: Record<string, any>, requirementText: string, requirementMatch: RouteRequirementMatch | null): string | undefined {
  const matchedPhrases = requirementMatch?.matchedPhrases ?? [];
  if (matchedPhrases.length > 0) {
    return `Requirement slice matched by phrases: ${matchedPhrases.join(', ')}`;
  }

  const matchedKeywords = requirementMatch?.matchedKeywords ?? [];
  if (matchedKeywords.length > 0) {
    return `Requirement slice matched by keywords: ${matchedKeywords.slice(0, 5).join(', ')}`;
  }

  const normalizedRequirement = requirementText.trim().replaceAll(/\s+/g, ' ');
  if (!normalizedRequirement) {
    return undefined;
  }

  return normalizedRequirement.length > 160
    ? `${normalizedRequirement.slice(0, 157)}...`
    : normalizedRequirement;
}

function buildRequirementTaskPlan(
  route: Record<string, any>,
  projectPayload: Record<string, any>,
  requirementText: string,
  requirementMatch: RouteRequirementMatch | null
): RequirementTaskPlan {
  const targetFiles = findRouteTargetFiles(route, projectPayload);
  const matchedKeywords = requirementMatch?.matchedKeywords ?? [];
  const routeLabel = route.name.replaceAll(/[-_]+/g, ' ');
  const goalKeywordSuffix = matchedKeywords.length > 0 ? ` with focus on ${matchedKeywords.slice(0, 3).join(', ')}` : '';
  const requirementSummary = summarizeRequirementForRoute(route, requirementText, requirementMatch);

  return {
    id: route.name,
    title: `Deliver ${routeLabel}`,
    goal: `Complete the ${routeLabel} subtask${goalKeywordSuffix}`,
    routeName: route.name,
    entryServices: [...(route.entryServices ?? [])],
    targetFiles,
    dependencyIds: [],
    ...(requirementSummary ? { requirementSummary } : {}),
    matchedRequirementPhrases: requirementMatch?.matchedPhrases ?? [],
    matchedRequirementKeywords: matchedKeywords
  };
}

function buildRequirementTaskPlans(
  routes: Array<Record<string, any>>,
  projectPayload: Record<string, any>,
  requirementText: string,
  matchIndex: Map<string, RouteRequirementMatch>
): RequirementTaskPlan[] {
  return routes.map((route) => buildRequirementTaskPlan(route, projectPayload, requirementText, matchIndex.get(route.name) ?? null));
}

function buildServiceDependencyIndex(
  projectPayload: Record<string, any>,
  topologyPayload: Record<string, any>
): Map<string, string[]> {
  const topologyDependencyIndex = new Map<string, string[]>(
    (topologyPayload.topology.services ?? []).map((service: Record<string, any>) => [service.name, dedupe(service.dependsOn ?? [])])
  );
  const projectServices = projectPayload.spec2flow.services ?? {};

  for (const [serviceName, serviceConfig] of Object.entries(projectServices)) {
    const existingDependencies = topologyDependencyIndex.get(serviceName) ?? [];
    const projectDependencies = Array.isArray((serviceConfig as { dependsOn?: string[] }).dependsOn)
      ? (serviceConfig as { dependsOn?: string[] }).dependsOn ?? []
      : [];
    topologyDependencyIndex.set(serviceName, dedupe([...existingDependencies, ...projectDependencies]));
  }

  return topologyDependencyIndex;
}

function inferTaskPlanDependencies(
  taskPlans: RequirementTaskPlan[],
  projectPayload: Record<string, any>,
  topologyPayload: Record<string, any>
): RequirementTaskPlan[] {
  const serviceDependencyIndex = buildServiceDependencyIndex(projectPayload, topologyPayload);
  const providerIndex = new Map<string, string[]>();

  for (const taskPlan of taskPlans) {
    for (const serviceName of taskPlan.entryServices) {
      const currentProviders = providerIndex.get(serviceName) ?? [];
      providerIndex.set(serviceName, dedupe([...currentProviders, taskPlan.id]));
    }
  }

  return taskPlans.map((taskPlan) => {
    const dependencyIds = dedupe(taskPlan.entryServices.flatMap((serviceName) => {
      const serviceDependencies = serviceDependencyIndex.get(serviceName) ?? [];
      return serviceDependencies.flatMap((dependencyService) => providerIndex.get(dependencyService) ?? []);
    })).filter((dependencyId) => dependencyId !== taskPlan.id);

    if (dependencyIds.length === 0) {
      return taskPlan;
    }

    return {
      ...taskPlan,
      dependencyIds
    };
  });
}

function buildRouteTaskBundle(
  route: Record<string, any>,
  projectPayload: Record<string, any>,
  topologyPayload: Record<string, any>,
  riskPayload: Record<string, any>,
  changedFiles: string[],
  options: {
    taskPlan: RequirementTaskPlan;
    requirementMatch?: { matchedPhrases?: string[]; matchedKeywords?: string[] } | null;
    requirementText?: string;
    routeSelectionMode?: string;
  }
): Task[] {
  const project = projectPayload.spec2flow;
  const matchingRules = getMatchingRiskRules(route, projectPayload, topologyPayload, riskPayload, changedFiles);
  const matchedRule = getHighestRiskRule(matchingRules);
  const riskLevel = (matchedRule?.level ?? 'low') as RiskLevel;
  const riskReviewPolicy = buildReviewPolicy(matchedRule);
  // Merge topology route-level reviewPolicy overrides (e.g. allowAutoCommit)
  const routeReviewPolicy = route.reviewPolicy ?? {};
  const reviewPolicy = {
    ...riskReviewPolicy,
    ...(typeof routeReviewPolicy.required === 'boolean' ? { required: routeReviewPolicy.required } : {}),
    ...(typeof routeReviewPolicy.reviewAgentCount === 'number' ? { reviewAgentCount: routeReviewPolicy.reviewAgentCount } : {}),
    ...(typeof routeReviewPolicy.requireHumanApproval === 'boolean' ? { requireHumanApproval: routeReviewPolicy.requireHumanApproval } : {}),
    ...(typeof routeReviewPolicy.allowAutoCommit === 'boolean' ? { allowAutoCommit: routeReviewPolicy.allowAutoCommit } : {})
  };
  const routeServiceKinds = getRouteServiceKinds(route, projectPayload, topologyPayload);
  const routeTargetFiles = findRouteTargetFiles(route, projectPayload);
  const routeVerifyCommands = dedupe([
    ...(route.verifyCommands ?? []),
    ...((matchedRule?.requires?.mustRunCommands) ?? [])
  ]);
  const artifactsDir = route.artifactTargets?.[0] ?? `${project.artifacts?.executionDir ?? 'spec2flow/outputs/execution'}/${route.name}`;
  const matchedRuleNames = matchingRules.map((rule) => rule.name);
  const requirementMatch = options.requirementMatch ?? null;
  const requirementText = options.requirementText ?? '';
  const routeSelectionMode = options.routeSelectionMode ?? 'all-routes';
  const taskPlan = options.taskPlan;
  const planDependencyTaskIds = (taskPlan.dependencyIds ?? []).map((dependencyId) => `${dependencyId}--evaluation`);
  const requirementsDependsOn = ['environment-preparation', ...planDependencyTaskIds];

  const analyzeId = `${route.name}--requirements-analysis`;
  const implementId = `${route.name}--code-implementation`;
  const testId = `${route.name}--test-design`;
  const executeId = `${route.name}--automated-execution`;
  const defectId = `${route.name}--defect-feedback`;
  const collaborationId = `${route.name}--collaboration`;
  const evaluationId = `${route.name}--evaluation`;

  return [
    {
      id: analyzeId,
      stage: 'requirements-analysis',
      title: `Analyze ${route.name} requirements`,
      goal: `Summarize scope, impacted services, and acceptance criteria for ${route.name}`,
      executorType: 'requirements-agent',
      roleProfile: buildTaskRoleProfile('requirements-analysis', 'requirements-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: requirementsDependsOn,
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanRequirementSummary: taskPlan.requirementSummary ?? null,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        taskPlanDependencyTaskIds: planDependencyTaskIds,
        routeName: route.name,
        entryServices: route.entryServices,
        changedFiles,
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode,
        matchedRequirementPhrases: requirementMatch?.matchedPhrases ?? [],
        matchedRequirementKeywords: requirementMatch?.matchedKeywords ?? []
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
      roleProfile: buildTaskRoleProfile('code-implementation', 'implementation-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [analyzeId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode,
        routeName: route.name,
        entryServices: route.entryServices,
        browserAutomationRequired: routeRequiresBrowserAutomation(routeServiceKinds),
        browserChecks: route.browserChecks ?? [],
        executionPolicy: route.executionPolicy ?? {
          maxDurationSeconds: 900,
          teardownPolicy: 'always',
          teardownTimeoutSeconds: 15
        },
        artifactStore: route.artifactStore ?? {
          mode: 'local'
        }
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
      roleProfile: buildTaskRoleProfile('test-design', 'test-design-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [implementId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode
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
      roleProfile: buildTaskRoleProfile('automated-execution', 'execution-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [testId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode,
        routeName: route.name,
        entryServices: route.entryServices,
        browserAutomationRequired: routeRequiresBrowserAutomation(routeServiceKinds),
        browserChecks: route.browserChecks ?? [],
        executionPolicy: route.executionPolicy ?? {
          maxDurationSeconds: 900,
          teardownPolicy: 'always',
          teardownTimeoutSeconds: 15
        },
        artifactStore: route.artifactStore ?? {
          mode: 'local'
        }
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
      roleProfile: buildTaskRoleProfile('defect-feedback', 'defect-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [executeId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode
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
      executorType: 'collaboration-agent',
      roleProfile: buildTaskRoleProfile('collaboration', 'collaboration-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [defectId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    },
    {
      id: evaluationId,
      stage: 'evaluation',
      title: `Evaluate ${route.name} delivery`,
      goal: `Accept or reject the prepared handoff for ${route.name} using the gathered evidence before publication`,
      executorType: 'evaluator-agent',
      roleProfile: buildTaskRoleProfile('evaluation', 'evaluator-agent'),
      status: 'pending',
      riskLevel,
      dependsOn: [collaborationId],
      inputs: {
        taskPlanId: taskPlan.id,
        taskPlanTitle: taskPlan.title,
        taskPlanGoal: taskPlan.goal,
        taskPlanDependencyIds: taskPlan.dependencyIds ?? [],
        matchedRiskRules: matchedRuleNames,
        requirementText,
        routeSelectionMode,
        evaluationFocus: [
          'delivery completeness',
          'artifact contract integrity',
          'handoff readiness'
        ]
      },
      targetFiles: routeTargetFiles,
      artifactsDir,
      reviewPolicy
    }
  ];
}

export function buildTaskGraph(
  projectPayload: Record<string, any>,
  topologyPayload: Record<string, any>,
  riskPayload: Record<string, any>,
  paths: { project: string; topology: string; risk: string; requirement?: string | null },
  options: { changedFiles?: string[]; requirementText?: string; routes?: string[] } = {}
): TaskGraphDocument {
  const project = projectPayload.spec2flow;
  const changedFiles = options.changedFiles ?? [];
  const requirementText = options.requirementText ?? '';
  const rawRouteSelection = selectRoutes(topologyPayload, projectPayload, changedFiles, requirementText);
  const routeFilter = options.routes && options.routes.length > 0 ? new Set(options.routes) : null;
  const routeSelection = routeFilter
    ? { ...rawRouteSelection, routes: rawRouteSelection.routes.filter((r: Record<string, any>) => routeFilter.has(r.name)), mode: 'explicit-filter' as const }
    : rawRouteSelection;
  const taskPlans = inferTaskPlanDependencies(
    buildRequirementTaskPlans(routeSelection.routes, projectPayload, requirementText, routeSelection.matchIndex),
    projectPayload,
    topologyPayload
  );
  const taskPlanIndex = new Map(taskPlans.map((taskPlan) => [taskPlan.routeName, taskPlan]));

  const tasks: Task[] = [
    {
      id: 'environment-preparation',
      stage: 'environment-preparation',
      title: 'Prepare repository environment',
      goal: `Load project adapter, topology, and risk policy for ${project.project.name}`,
      executorType: 'controller-agent',
      roleProfile: buildTaskRoleProfile('environment-preparation', 'controller-agent'),
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

  for (const route of routeSelection.routes) {
    tasks.push(...buildRouteTaskBundle(route, projectPayload, topologyPayload, riskPayload, changedFiles, {
      taskPlan: taskPlanIndex.get(route.name) ?? buildRequirementTaskPlan(route, projectPayload, requirementText, routeSelection.matchIndex.get(route.name) ?? null),
      requirementText,
      routeSelectionMode: routeSelection.mode,
      requirementMatch: routeSelection.matchIndex.get(route.name) ?? null
    }));
  }

  return {
    taskGraph: {
      id: `${project.project.name}-task-graph`,
      workflowName: `${project.project.name}-workflow`,
      source: {
        projectAdapterRef: paths.project,
        topologyRef: paths.topology,
        riskPolicyRef: paths.risk,
        changeSet: changedFiles,
        ...(typeof paths.requirement === 'string' && paths.requirement.length > 0 ? { requirementRef: paths.requirement } : {}),
        ...(requirementText ? { requirementText } : {}),
        routeSelectionMode: routeSelection.mode,
        selectedRoutes: routeSelection.routes.map((route) => route.name),
        taskPlans
      },
      tasks
    }
  };
}
