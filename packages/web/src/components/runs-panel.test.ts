import { describe, expect, it } from 'vitest';
import type { RunListItem } from '../lib/control-plane-api';
import { getRunQueueAction, getRunQueueRerouteLabel } from './runs-panel';

function makeRun(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    runId: 'run-1',
    repositoryId: 'repo-1',
    repositoryName: 'Spec2Flow',
    repositoryRootPath: '/repo',
    workflowName: 'Autonomous change',
    status: 'running',
    paused: false,
    currentStage: 'evaluation',
    riskLevel: 'medium',
    createdAt: '2026-03-26T10:00:00.000Z',
    updatedAt: '2026-03-26T10:05:00.000Z',
    startedAt: '2026-03-26T10:01:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('getRunQueueRerouteLabel', () => {
  it('returns a human-readable reroute target label when the run requests repair', () => {
    expect(getRunQueueRerouteLabel(makeRun({ rerouteTargetStage: 'automated-execution' }))).toBe(
      'Reroute target: Automated Execution'
    );
  });

  it('omits the reroute line when no reroute target exists', () => {
    expect(getRunQueueRerouteLabel(makeRun({ rerouteTargetStage: null }))).toBeNull();
  });

  it('offers a queue action for blocked reroute runs', () => {
    expect(getRunQueueAction(makeRun({ rerouteTargetStage: 'automated-execution', status: 'blocked' }))).toEqual({
      label: '从 Automated Execution 继续',
      action: 'resume-from-target-stage'
    });
  });

  it('omits the queue action while the reroute is already progressing autonomously', () => {
    expect(getRunQueueAction(makeRun({ rerouteTargetStage: 'automated-execution', status: 'running', paused: false }))).toBeNull();
  });
});