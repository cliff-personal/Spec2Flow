export type EvaluationRepairTargetStage =
  | 'requirements-analysis'
  | 'code-implementation'
  | 'test-design'
  | 'automated-execution';

export const EVALUATION_REPAIR_TARGET_STAGES: EvaluationRepairTargetStage[] = [
  'requirements-analysis',
  'code-implementation',
  'test-design',
  'automated-execution'
];

const EVALUATION_REPAIR_TARGET_HINTS: Record<EvaluationRepairTargetStage, string[]> = {
  'requirements-analysis': [
    'requirement',
    'requirements',
    'spec',
    'specification',
    'clarify',
    'acceptance criteria',
    'product intent',
    '需求',
    '规格',
    '澄清'
  ],
  'code-implementation': [
    'implementation',
    'implement',
    'code',
    'bug',
    'logic',
    'fix',
    'refactor',
    '代码',
    '实现',
    '修复',
    '逻辑'
  ],
  'test-design': [
    'test',
    'tests',
    'coverage',
    'assertion',
    'assertions',
    'test case',
    'test cases',
    'integration test',
    'unit test',
    'expand tests',
    '测试',
    '覆盖',
    '断言'
  ],
  'automated-execution': [
    'execution',
    'rerun',
    're-run',
    'run checks',
    'rerun execution',
    'environment',
    'flaky',
    'command',
    'ci',
    'build',
    '执行',
    '重跑',
    '环境',
    '命令'
  ]
};

export function normalizeEvaluationRepairTargetStage(
  value: string | null | undefined
): EvaluationRepairTargetStage | null {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase().replaceAll(/[_\s]+/g, '-');
  return EVALUATION_REPAIR_TARGET_STAGES.includes(normalizedValue as EvaluationRepairTargetStage)
    ? normalizedValue as EvaluationRepairTargetStage
    : null;
}

export function inferEvaluationRepairTargetStageFromSignals(
  nextActions: string[],
  findings: string[]
): EvaluationRepairTargetStage | null {
  const normalizedNextActions = nextActions.map((entry) => entry.toLowerCase());
  const normalizedFindings = findings.map((entry) => entry.toLowerCase());
  const scores = new Map<EvaluationRepairTargetStage, number>();

  for (const stage of EVALUATION_REPAIR_TARGET_STAGES) {
    const hints = EVALUATION_REPAIR_TARGET_HINTS[stage];
    let score = 0;

    for (const entry of normalizedNextActions) {
      if (hints.some((hint) => entry.includes(hint))) {
        score += 3;
      }
    }

    for (const entry of normalizedFindings) {
      if (hints.some((hint) => entry.includes(hint))) {
        score += 1;
      }
    }

    if (score > 0) {
      scores.set(stage, score);
    }
  }

  const rankedStages = [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || EVALUATION_REPAIR_TARGET_STAGES.indexOf(left[0]) - EVALUATION_REPAIR_TARGET_STAGES.indexOf(right[0]));

  return rankedStages[0]?.[0] ?? null;
}

export function resolveEvaluationRepairTargetStage(options: {
  explicitRepairTargetStage?: string | null;
  nextActions?: string[] | null;
  findings?: string[] | null;
}): EvaluationRepairTargetStage | null {
  const explicitRepairTargetStage = normalizeEvaluationRepairTargetStage(options.explicitRepairTargetStage);
  if (explicitRepairTargetStage) {
    return explicitRepairTargetStage;
  }

  return inferEvaluationRepairTargetStageFromSignals(options.nextActions ?? [], options.findings ?? []);
}