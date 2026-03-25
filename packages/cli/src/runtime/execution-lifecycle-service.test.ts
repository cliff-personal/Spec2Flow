import { describe, expect, it } from 'vitest';
import {
  createExecutionLifecycleGuard,
  normalizeExecutionLifecyclePolicy,
  shouldTeardownManagedServices
} from './execution-lifecycle-service.js';

describe('execution-lifecycle-service', () => {
  it('normalizes execution policy defaults and overrides', () => {
    expect(normalizeExecutionLifecyclePolicy(undefined)).toEqual({
      maxDurationSeconds: 900,
      teardownPolicy: 'always',
      teardownTimeoutSeconds: 15
    });

    expect(normalizeExecutionLifecyclePolicy({
      maxDurationSeconds: 120,
      teardownPolicy: 'on-failure',
      teardownTimeoutSeconds: 5
    })).toEqual({
      maxDurationSeconds: 120,
      teardownPolicy: 'on-failure',
      teardownTimeoutSeconds: 5
    });
  });

  it('decides teardown based on policy and lifecycle state', () => {
    expect(shouldTeardownManagedServices(
      { maxDurationSeconds: 1, teardownPolicy: 'always', teardownTimeoutSeconds: 1 },
      { hasFailures: false, repositoryGaps: false, interrupted: false }
    )).toBe(true);

    expect(shouldTeardownManagedServices(
      { maxDurationSeconds: 1, teardownPolicy: 'never', teardownTimeoutSeconds: 1 },
      { hasFailures: true, repositoryGaps: true, interrupted: true }
    )).toBe(false);

    expect(shouldTeardownManagedServices(
      { maxDurationSeconds: 1, teardownPolicy: 'on-failure', teardownTimeoutSeconds: 1 },
      { hasFailures: false, repositoryGaps: false, interrupted: false }
    )).toBe(false);
  });

  it('captures lifecycle timeout in the final summary', async () => {
    const guard = createExecutionLifecycleGuard({
      maxDurationSeconds: 1,
      teardownPolicy: 'always',
      teardownTimeoutSeconds: 1
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const summary = guard.complete();

    expect(summary.timedOut).toBe(true);
    expect(summary.aborted).toBe(true);
    expect(summary.abortReason).toContain('execution exceeded 1 seconds');
  });
});
