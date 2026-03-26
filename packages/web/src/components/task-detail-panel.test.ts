import { describe, expect, it } from 'vitest';
import { deriveTaskEvaluationSignal } from './task-detail-panel';
import type { PlatformTaskRecord } from '../lib/control-plane-api';

function makeTask(overrides: Partial<PlatformTaskRecord> = {}): PlatformTaskRecord {
  return {
    runId: 'run-1',
    taskId: 'frontend-smoke--evaluation',
    stage: 'evaluation',
    title: 'Evaluate delivery',
    goal: 'Evaluate the collaboration handoff',
    executorType: 'evaluator-agent',
    status: 'blocked',
    ...overrides,
  };
}

describe('deriveTaskEvaluationSignal', () => {
  it('returns evaluator repair routing context for evaluation tasks', () => {
    const signal = deriveTaskEvaluationSignal(makeTask({
      evaluationDecision: 'needs-repair',
      evaluationSummary: 'Rerun execution under a fresh environment.',
      requestedRepairTargetStage: 'automated-execution',
      evaluationFindings: ['The environment was stale during the last execution.'],
      evaluationNextActions: ['Refresh the environment and rerun automated execution.']
    }));

    expect(signal).toEqual({
      decision: 'needs-repair',
      summary: 'Rerun execution under a fresh environment.',
      requestedRepairTargetStage: 'automated-execution',
      findings: ['The environment was stale during the last execution.'],
      nextActions: ['Refresh the environment and rerun automated execution.']
    });
  });

  it('returns null for non-evaluation tasks', () => {
    const signal = deriveTaskEvaluationSignal(makeTask({
      stage: 'code-implementation',
      evaluationDecision: 'needs-repair',
      requestedRepairTargetStage: 'automated-execution'
    }));

    expect(signal).toBeNull();
  });
});