export type ExecutionTeardownPolicy = 'always' | 'on-failure' | 'never';

export interface ExecutionLifecyclePolicy {
  maxDurationSeconds: number;
  teardownPolicy: ExecutionTeardownPolicy;
  teardownTimeoutSeconds: number;
}

export interface ExecutionLifecycleSummary {
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  maxDurationSeconds: number;
  teardownPolicy: ExecutionTeardownPolicy;
  timedOut: boolean;
  aborted: boolean;
  abortReason?: string;
}

export interface ExecutionLifecycleGuard {
  signal: AbortSignal;
  clear: () => void;
  complete: () => ExecutionLifecycleSummary;
}

export const DEFAULT_EXECUTION_MAX_DURATION_SECONDS = 900;
export const DEFAULT_EXECUTION_TEARDOWN_TIMEOUT_SECONDS = 15;

function createAbortError(message: string): Error & { code: string; name: string; } {
  const error = new Error(message) as Error & { code: string; name: string; };
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readPositiveInteger(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function readTeardownPolicy(record: Record<string, unknown> | null): ExecutionTeardownPolicy | null {
  const value = record?.teardownPolicy;
  return value === 'always' || value === 'on-failure' || value === 'never'
    ? value
    : null;
}

export function normalizeExecutionLifecyclePolicy(value: unknown): ExecutionLifecyclePolicy {
  const record = asObjectRecord(value);
  return {
    maxDurationSeconds: readPositiveInteger(record, 'maxDurationSeconds') ?? DEFAULT_EXECUTION_MAX_DURATION_SECONDS,
    teardownPolicy: readTeardownPolicy(record) ?? 'always',
    teardownTimeoutSeconds: readPositiveInteger(record, 'teardownTimeoutSeconds') ?? DEFAULT_EXECUTION_TEARDOWN_TIMEOUT_SECONDS
  };
}

export function shouldTeardownManagedServices(
  policy: ExecutionLifecyclePolicy,
  options: {
    hasFailures: boolean;
    repositoryGaps: boolean;
    interrupted: boolean;
  }
): boolean {
  if (policy.teardownPolicy === 'never') {
    return false;
  }

  if (policy.teardownPolicy === 'always') {
    return true;
  }

  return options.hasFailures || options.repositoryGaps || options.interrupted;
}

export function createExecutionLifecycleGuard(
  policy: ExecutionLifecyclePolicy,
  parentSignal?: AbortSignal
): ExecutionLifecycleGuard {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let abortReason: string | undefined;

  const timeout = setTimeout(() => {
    timedOut = true;
    abortReason = `execution exceeded ${policy.maxDurationSeconds} seconds`;
    controller.abort(createAbortError(abortReason));
  }, policy.maxDurationSeconds * 1000);

  const onParentAbort = (): void => {
    abortReason = abortReason ?? 'execution aborted by parent signal';
    controller.abort(parentSignal?.reason ?? createAbortError(abortReason));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const clear = (): void => {
    clearTimeout(timeout);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return {
    signal: controller.signal,
    clear,
    complete: () => {
      clear();
      const completedAt = Date.now();
      return {
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationSeconds: Math.max(0, Math.round((completedAt - startedAt) / 100) / 10),
        maxDurationSeconds: policy.maxDurationSeconds,
        teardownPolicy: policy.teardownPolicy,
        timedOut,
        aborted: controller.signal.aborted,
        ...(abortReason ? { abortReason } : {})
      };
    }
  };
}
