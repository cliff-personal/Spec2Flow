import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRunDetail,
  getRunObservability,
  getRunTasks,
  listProjects,
  listRuns,
  postRunAction,
  postTaskAction,
  type PlatformObservability,
  type PlatformObservabilityApprovalItem,
  type PlatformObservabilityTimelineEntry,
  type PlatformTaskRecord,
  registerProject,
  type RunListItem,
  submitRun,
  type ProjectListItem,
  type ProjectRegistrationPayload,
  type RunSubmissionPayload
} from '../lib/control-plane-api';
import { parseChangedFiles } from '../lib/control-plane-formatters';
import { summarizeReviewDecision } from '../lib/review-decision-summary';
import type { ProjectRegistrationFormState, SubmissionFormState, TaskActionType } from '../lib/control-plane-ui-types';
const APPROVAL_PREFERENCES_STORAGE_KEY = 'spec2flow.approval-preferences.v1';
const SESSION_EVENT_LIMIT = 1000;

const INITIAL_REGISTRATION_STATE: ProjectRegistrationFormState = {
  projectName: 'Spec2Flow',
  repositoryRootPath: '/Users/cliff/workspace/Spec2Flow',
  workspaceRootPath: '/Users/cliff/workspace/Spec2Flow',
  projectPath: '.spec2flow/project.yaml',
  topologyPath: '.spec2flow/topology.yaml',
  riskPath: '.spec2flow/policies/risk.yaml',
  defaultBranch: 'main',
  branchPrefix: 'spec2flow/',
  allowedWriteGlobs: 'src/**,tests/**,docs/**,.spec2flow/**'
};

const INITIAL_SUBMISSION_STATE: SubmissionFormState = {
  requirement: '',
  requirementPath: '',
  changedFiles: ''
};

type FeedTone = 'info' | 'warning' | 'error' | 'success';

function getLocalStorage(): Storage | null {
  if (globalThis.window === undefined) {
    return null;
  }

  return globalThis.localStorage;
}

function readStoredApprovalPreferences(): Record<string, string[]> {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }

  try {
    const rawValue = storage.getItem(APPROVAL_PREFERENCES_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string'))
    );
  } catch {
    return {};
  }
}

function writeStoredApprovalPreferences(value: Record<string, string[]>): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(APPROVAL_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
}

function readRememberedApprovalKeys(projectId: string | null): string[] {
  if (!projectId) {
    return [];
  }

  return readStoredApprovalPreferences()[projectId] ?? [];
}

function rememberApprovalKey(projectId: string | null, approvalKey: string): string[] {
  if (!projectId) {
    return [];
  }

  const current = readStoredApprovalPreferences();
  const nextValues = current[projectId]?.includes(approvalKey)
    ? current[projectId] ?? []
    : [...(current[projectId] ?? []), approvalKey];
  writeStoredApprovalPreferences({
    ...current,
    [projectId]: nextValues,
  });
  return nextValues;
}

function compareRunsByRecency(left: RunListItem, right: RunListItem): number {
  const leftTimestamp = Date.parse(left.updatedAt ?? left.startedAt ?? left.createdAt ?? '');
  const rightTimestamp = Date.parse(right.updatedAt ?? right.startedAt ?? right.createdAt ?? '');

  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return right.runId.localeCompare(left.runId);
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractEventDetail(entry: PlatformObservabilityTimelineEntry): string {
  const errorList = entry.payload.errors;
  if (Array.isArray(errorList)) {
    const firstError = errorList.find((error) => error && typeof error === 'object' && !Array.isArray(error) && typeof (error as { message?: unknown }).message === 'string') as { message: string } | undefined;
    if (firstError?.message) {
      return firstError.message;
    }
  }

  return readPayloadString(entry.payload, 'message')
    ?? readPayloadString(entry.payload, 'summary')
    ?? readPayloadString(entry.payload, 'gateReason')
    ?? readPayloadString(entry.payload, 'note')
    ?? entry.title;
}

function buildRunStatusSummary(run: RunListItem | null, tasks: PlatformTaskRecord[]): string {
  if (!run) {
    return '等待任务提交';
  }

  if (run.paused) {
    if (run.status === 'blocked') {
      const blockedTask = tasks.find((task) => task.status === 'blocked');
      return blockedTask
        ? `运行已暂停，停在 ${blockedTask.title}，可从这里继续。`
        : '运行已暂停，等待你继续执行。';
    }

    return `运行已暂停在 ${run.currentStage ?? '准备阶段'}，可从当前进度继续。`;
  }

  if (run.status === 'running' || run.status === 'pending') {
    return `任务已启动，当前推进到${run.currentStage ?? '准备阶段'}。`;
  }

  if (run.status === 'completed') {
    return '当前运行已完成。';
  }

  if (run.status === 'blocked') {
    const blockedTask = tasks.find((task) => task.status === 'blocked');
    return blockedTask
      ? `当前运行停在 ${blockedTask.title}。`
      : '当前运行已暂停，等待进一步处理。';
  }

  if (run.status === 'failed') {
    return '当前运行失败，等待人工介入。';
  }

  return `当前运行状态：${run.status}`;
}

function buildTaskActionSuccessMessage(payload: { action: TaskActionType; note?: string }): string {
  if (payload.action === 'reject') {
    return '已拒绝当前确认项，当前任务保持停止。';
  }

  if (payload.note?.startsWith('remember:')) {
    return '已记住该类授权，后续将自动批准。';
  }

  return '已确认当前任务，自动流程继续推进。';
}

function getRunFeedTone(run: RunListItem): FeedTone {
  if (run.paused) {
    return 'warning';
  }

  if (run.status === 'completed') {
    return 'success';
  }

  if (run.status === 'blocked') {
    return 'warning';
  }

  if (run.status === 'failed') {
    return 'error';
  }

  return 'info';
}

function getRunFeedTitle(run: RunListItem): string {
  if (run.paused) {
    return `执行已暂停：${run.currentStage ?? '准备阶段'}`;
  }

  if (run.currentStage) {
    return `当前阶段：${run.currentStage}`;
  }

  return '当前阶段：准备中';
}

function isAllRecoverableErrorsEvent(entry: PlatformObservabilityTimelineEntry): boolean {
  const errors = entry.payload.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return false;
  }

  return errors.every(
    (e) => e && typeof e === 'object' && (e as { recoverable?: boolean }).recoverable === true
  );
}

function getTimelineEntryTone(entry: PlatformObservabilityTimelineEntry): FeedTone {
  if (entry.severity === 'error') {
    return 'error';
  }

  if (entry.severity === 'warning') {
    // Recoverable-only error events are informational, not alarming
    if (entry.type === 'task.errors-recorded' && isAllRecoverableErrorsEvent(entry)) {
      return 'info';
    }

    return 'warning';
  }

  return entry.type.includes('completed') ? 'success' : 'info';
}

function buildBlockedReason(
  run: RunListItem | null,
  tasks: PlatformTaskRecord[],
  observability: PlatformObservability | undefined
): string | null {
  if (run?.status !== 'blocked' || !observability) {
    return null;
  }

  const stageTask = tasks.find((task) => task.stage === run.currentStage && task.status === 'blocked')
    ?? tasks.find((task) => task.status === 'blocked')
    ?? null;
  const relevantEntries = observability.timeline.filter((entry) => !stageTask || entry.taskId === stageTask.taskId);
  const blockingEntry = relevantEntries.find((entry) => entry.severity === 'error' || entry.severity === 'warning')
    ?? relevantEntries[0];

  return blockingEntry ? extractEventDetail(blockingEntry) : stageTask?.goal ?? '当前运行被阻塞，但尚未记录明确原因。';
}

function buildExecutionFeed(
  run: RunListItem | null,
  tasks: PlatformTaskRecord[],
  observability: PlatformObservability | undefined,
  blockedReason: string | null
): Array<{ id: string; tone: 'info' | 'warning' | 'error' | 'success'; title: string; detail: string }> {
  if (!run) {
    return [];
  }

  const items: Array<{ id: string; tone: FeedTone; title: string; detail: string }> = [{
    id: `status-${run.runId}`,
    tone: getRunFeedTone(run),
    title: getRunFeedTitle(run),
    detail: buildRunStatusSummary(run, tasks),
  }];

  const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);
  if (reviewDecision.status !== 'not-required') {
    items.push({
      id: `review-${run.runId}`,
      tone: reviewDecision.tone,
      title: reviewDecision.headline,
      detail: reviewDecision.detail,
    });
  }

  if (blockedReason) {
    items.push({
      id: `blocked-${run.runId}`,
      tone: 'warning',
      title: '卡点已识别',
      detail: blockedReason,
    });
  }

  for (const entry of (observability?.timeline ?? []).slice(0, 4)) {
    items.push({
      id: entry.eventId,
      tone: getTimelineEntryTone(entry),
      title: entry.title,
      detail: extractEventDetail(entry),
    });
  }

  return items.slice(0, 5);
}

function normalizeApprovalKey(rawValue: string): string {
  return rawValue.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function buildApprovalPreferenceKey(task: PlatformTaskRecord | undefined, approval: PlatformObservabilityApprovalItem): string {
  const approvalScope = task?.stage ?? 'approval';
  const approvalReason = approval.reason ?? approval.latestEventType ?? 'approval-required';
  return `${approvalScope}:${normalizeApprovalKey(approvalReason)}`;
}

function isRequestedApprovalWithTaskId(
  approval: PlatformObservabilityApprovalItem,
): approval is PlatformObservabilityApprovalItem & { status: 'requested'; taskId: string } {
  return approval.status === 'requested' && typeof approval.taskId === 'string' && approval.taskId.length > 0;
}

function buildProjectRegistrationPayload(formState: ProjectRegistrationFormState): ProjectRegistrationPayload {
  return {
    repositoryRootPath: formState.repositoryRootPath,
    projectName: formState.projectName,
    workspaceRootPath: formState.workspaceRootPath,
    projectPath: formState.projectPath,
    topologyPath: formState.topologyPath,
    riskPath: formState.riskPath,
    defaultBranch: formState.defaultBranch,
    branchPrefix: formState.branchPrefix,
    workspacePolicy: {
      allowedWriteGlobs: parseChangedFiles(formState.allowedWriteGlobs)
    }
  };
}

function buildRunSubmissionPayload(project: ProjectListItem, submissionState: SubmissionFormState): RunSubmissionPayload {
  return {
    repositoryRootPath: project.repositoryRootPath,
    projectId: project.projectId,
    projectName: project.projectName,
    workspaceRootPath: project.workspaceRootPath,
    ...(project.projectPath ? { projectPath: project.projectPath } : {}),
    ...(project.topologyPath ? { topologyPath: project.topologyPath } : {}),
    ...(project.riskPath ? { riskPath: project.riskPath } : {}),
    ...(project.repositoryId ? { repositoryId: project.repositoryId } : {}),
    ...(project.repositoryName ? { repositoryName: project.repositoryName } : {}),
    ...(project.defaultBranch ? { defaultBranch: project.defaultBranch } : {}),
    ...(submissionState.requirement.trim() ? { requirement: submissionState.requirement.trim() } : {}),
    ...(submissionState.requirementPath.trim() ? { requirementPath: submissionState.requirementPath.trim() } : {}),
    changedFiles: parseChangedFiles(submissionState.changedFiles)
  };
}

export function useControlPlaneProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId, runId: sessionRunIdParam } = useParams<{ projectId?: string; runId?: string }>();
  const [registrationState, setRegistrationState] = useState(INITIAL_REGISTRATION_STATE);
  const [submissionState, setSubmissionState] = useState(INITIAL_SUBMISSION_STATE);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [rememberedApprovalKeys, setRememberedApprovalKeys] = useState<string[]>([]);
  const autoApprovedFingerprintRef = useRef<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['control-plane', 'projects'],
    queryFn: listProjects,
    retry: false,
    refetchInterval: 10000
  });

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 5000
  });

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }

    const firstProjectId = projectsQuery.data?.[0]?.projectId ?? null;
    if (!selectedProjectId && firstProjectId) {
      setSelectedProjectId(firstProjectId);
    }
  }, [projectId, projectsQuery.data, selectedProjectId]);

  useEffect(() => {
    setRememberedApprovalKeys(readRememberedApprovalKeys(selectedProjectId));
    autoApprovedFingerprintRef.current = null;
  }, [selectedProjectId]);

  const selectedProject = projectsQuery.data?.find((project) => project.projectId === selectedProjectId) ?? null;
  const selectedProjectRuns = useMemo(
    () => (runsQuery.data ?? [])
      .filter((run) => run.projectId === selectedProjectId)
      .sort(compareRunsByRecency),
    [runsQuery.data, selectedProjectId]
  );
  const activeProjectRun = selectedProjectRuns.find((run) => ['running', 'pending', 'blocked'].includes(run.status))
    ?? selectedProjectRuns[0]
    ?? null;

  const activeRunTasksQuery = useQuery({
    queryKey: ['control-plane', 'run-tasks', activeProjectRun?.runId],
    queryFn: () => getRunTasks(activeProjectRun?.runId ?? ''),
    enabled: Boolean(activeProjectRun?.runId),
    retry: false,
    refetchInterval: activeProjectRun && ['running', 'pending', 'blocked'].includes(activeProjectRun.status) ? 5000 : false
  });

  const activeRunObservabilityQuery = useQuery({
    queryKey: ['control-plane', 'run-observability', activeProjectRun?.runId],
    queryFn: () => getRunObservability(activeProjectRun?.runId ?? ''),
    enabled: Boolean(activeProjectRun?.runId),
    retry: false,
    refetchInterval: activeProjectRun && ['running', 'pending', 'blocked'].includes(activeProjectRun.status) ? 4000 : false
  });

  // Session = the run being viewed in the session history panel (may differ from activeProjectRun)
  const sessionRun = sessionRunIdParam
    ? ((runsQuery.data ?? []).find((r) => r.runId === sessionRunIdParam) ?? null)
    : null;
  const sessionIsLive = Boolean(sessionRun && ['running', 'pending', 'blocked'].includes(sessionRun.status));

  const sessionObservabilityQuery = useQuery({
    queryKey: ['control-plane', 'session-observability', sessionRun?.runId],
    queryFn: () => getRunObservability(sessionRun?.runId ?? '', SESSION_EVENT_LIMIT),
    enabled: Boolean(sessionRun?.runId),
    retry: false,
    refetchInterval: sessionIsLive ? 4000 : false
  });

  const sessionRunDetailQuery = useQuery({
    queryKey: ['control-plane', 'session-run-detail', sessionRun?.runId],
    queryFn: () => getRunDetail(sessionRun?.runId ?? '', SESSION_EVENT_LIMIT),
    enabled: Boolean(sessionRun?.runId),
    retry: false,
    refetchInterval: sessionIsLive ? 5000 : false
  });

  const sessionTasksQuery = useQuery({
    queryKey: ['control-plane', 'session-tasks', sessionRun?.runId],
    queryFn: () => getRunTasks(sessionRun?.runId ?? ''),
    enabled: Boolean(sessionRun?.runId),
    retry: false,
    refetchInterval: sessionIsLive ? 5000 : false
  });

  const registrationMutation = useMutation({
    mutationFn: (payload: ProjectRegistrationPayload) => registerProject(payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'projects'] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] })
      ]);
      setActionMessage(`Registered project ${result.project.name}`);
      setSelectedProjectId(result.project.projectId);
      navigate(`/projects/${result.project.projectId}`);
    }
  });

  const submissionMutation = useMutation({
    mutationFn: (payload: RunSubmissionPayload) => submitRun(payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['control-plane'] });
      setActionMessage(`Run ${result.platformRun.runId.slice(0, 8)} started`);
      setSubmissionState(INITIAL_SUBMISSION_STATE);
    }
  });

  const taskActionMutation = useMutation({
    mutationFn: async (payload: { runId: string; taskId: string; action: TaskActionType; note?: string }) => {
      await postTaskAction(payload.taskId, payload.action, payload.runId, payload.note);
    },
    onSuccess: async (_result, payload) => {
      setActionMessage(buildTaskActionSuccessMessage(payload));
      await queryClient.invalidateQueries({ queryKey: ['control-plane'] });
    }
  });

  const runActionMutation = useMutation({
    mutationFn: async (payload: { runId: string; action: 'pause' | 'resume'; note?: string }) =>
      postRunAction(payload.runId, payload.action, payload.note),
    onSuccess: async (result) => {
      setActionMessage(
        result.action === 'pause'
          ? '已停止当前运行，稍后可从未完成位置继续。'
          : '已继续之前未完成的运行。'
      );
      await queryClient.invalidateQueries({ queryKey: ['control-plane'] });
    }
  });

  const activeRunTasks = activeRunTasksQuery.data ?? [];
  const blockedReason = useMemo(
    () => buildBlockedReason(activeProjectRun, activeRunTasks, activeRunObservabilityQuery.data),
    [activeProjectRun, activeRunObservabilityQuery.data, activeRunTasks]
  );

  const activeRunExecutionFeed = useMemo(() => {
    return buildExecutionFeed(activeProjectRun, activeRunTasks, activeRunObservabilityQuery.data, blockedReason);
  }, [activeProjectRun, activeRunObservabilityQuery.data?.timeline, activeRunTasks, blockedReason]);

  const allPendingConfirmations = useMemo(() => {
    const taskLookup = new Map(activeRunTasks.map((task) => [task.taskId, task]));

    return (activeRunObservabilityQuery.data?.approvals ?? [])
      .filter(isRequestedApprovalWithTaskId)
      .map((approval) => {
        const task = taskLookup.get(approval.taskId);
        const stageLabel = task?.stage ?? activeProjectRun?.currentStage ?? 'collaboration';
        const approvalKey = buildApprovalPreferenceKey(task, approval);

        return {
          id: `${approval.publicationId ?? approval.taskId ?? stageLabel}-${approvalKey}`,
          taskId: approval.taskId,
          approvalKey,
          title: task?.title ?? '协作结果需要确认',
          description: approval.reason ?? '该协作产物已经生成，但发布动作需要你的确认后才能继续。',
          stage: stageLabel,
        };
      });
  }, [activeProjectRun?.currentStage, activeRunObservabilityQuery.data?.approvals, activeRunTasks]);

  const pendingConfirmations = useMemo(
    () => allPendingConfirmations.filter((item) => !rememberedApprovalKeys.includes(item.approvalKey)).slice(0, 3),
    [allPendingConfirmations, rememberedApprovalKeys]
  );

  // Blocked task that has no pending approval gate — can be retried directly
  const blockedTaskId = useMemo(() => {
    if (activeProjectRun?.status !== 'blocked') {
      return null;
    }

    const approvalTaskIds = new Set(
      (activeRunObservabilityQuery.data?.approvals ?? [])
        .filter(isRequestedApprovalWithTaskId)
        .map((a) => a.taskId)
    );

    return activeRunTasks.find((t) => t.status === 'blocked' && !approvalTaskIds.has(t.taskId))?.taskId ?? null;
  }, [activeProjectRun, activeRunTasks, activeRunObservabilityQuery.data?.approvals]);

  // Session-specific pending confirmations and blocked task (for the session panel)
  const sessionTasks = sessionTasksQuery.data ?? [];
  const sessionPendingConfirmations = useMemo(() => {
    if (!sessionRun) return [];
    const taskLookup = new Map(sessionTasks.map((t) => [t.taskId, t]));
    return (sessionObservabilityQuery.data?.approvals ?? [])
      .filter(isRequestedApprovalWithTaskId)
      .map((approval) => {
        const task = taskLookup.get(approval.taskId);
        const stageLabel = task?.stage ?? sessionRun.currentStage ?? 'collaboration';
        const approvalKey = buildApprovalPreferenceKey(task, approval);
        return {
          id: `${approval.publicationId ?? approval.taskId ?? stageLabel}-${approvalKey}`,
          taskId: approval.taskId,
          approvalKey,
          title: task?.title ?? '协作结果需要确认',
          description: approval.reason ?? '该协作产物已经生成，但发布动作需要你的确认后才能继续。',
          stage: stageLabel,
        };
      })
      .filter((item) => !rememberedApprovalKeys.includes(item.approvalKey))
      .slice(0, 3);
  }, [sessionRun, sessionTasks, sessionObservabilityQuery.data?.approvals, rememberedApprovalKeys]);

  const sessionBlockedTaskId = useMemo(() => {
    if (sessionRun?.status !== 'blocked') return null;
    const approvalTaskIds = new Set(
      (sessionObservabilityQuery.data?.approvals ?? [])
        .filter(isRequestedApprovalWithTaskId)
        .map((a) => a.taskId)
    );
    return sessionTasks.find((t) => t.status === 'blocked' && !approvalTaskIds.has(t.taskId))?.taskId ?? null;
  }, [sessionRun, sessionTasks, sessionObservabilityQuery.data?.approvals]);

  useEffect(() => {
    if (!activeProjectRun || taskActionMutation.isPending) {
      return;
    }

    const autoApprovalTarget = allPendingConfirmations.find((item) => rememberedApprovalKeys.includes(item.approvalKey));
    if (!autoApprovalTarget) {
      return;
    }

    const fingerprint = `${activeProjectRun.runId}:${autoApprovalTarget.taskId}:${autoApprovalTarget.approvalKey}`;
    if (autoApprovedFingerprintRef.current === fingerprint) {
      return;
    }

    autoApprovedFingerprintRef.current = fingerprint;
    taskActionMutation.mutate({
      runId: activeProjectRun.runId,
      taskId: autoApprovalTarget.taskId,
      action: 'approve',
      note: `remember:${autoApprovalTarget.approvalKey}`,
    });
  }, [activeProjectRun, allPendingConfirmations, rememberedApprovalKeys, taskActionMutation]);

  function updateRegistrationField<K extends keyof ProjectRegistrationFormState>(
    field: K,
    value: ProjectRegistrationFormState[K]
  ): void {
    setRegistrationState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateSubmissionField<K extends keyof SubmissionFormState>(field: K, value: SubmissionFormState[K]): void {
    setSubmissionState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function submitProjectRegistration(): void {
    setActionMessage(null);
    registrationMutation.mutate(buildProjectRegistrationPayload(registrationState));
  }

  function submitProjectRun(): void {
    if (!selectedProject) {
      return;
    }

    setActionMessage(null);
    submissionMutation.mutate(buildRunSubmissionPayload(selectedProject, submissionState));
  }

  function submitWithRequirement(requirement: string): void {
    if (!selectedProject) {
      return;
    }
    setActionMessage(null);
    const state: SubmissionFormState = { ...submissionState, requirement: requirement.trim() };
    submissionMutation.mutate(buildRunSubmissionPayload(selectedProject, state));
  }

  function selectProject(projectIdValue: string): void {
    setSelectedProjectId(projectIdValue);
    navigate(`/projects/${projectIdValue}`);
  }

  function runTaskAction(taskId: string, action: TaskActionType, note?: string): void {
    if (!activeProjectRun) {
      return;
    }

    setActionMessage(null);
    taskActionMutation.mutate({
      runId: activeProjectRun.runId,
      taskId,
      action,
      ...(note ? { note } : {}),
    });
  }

  function approvePendingConfirmation(taskId: string): void {
    runTaskAction(taskId, 'approve');
  }

  function approveAndRememberPendingConfirmation(taskId: string, approvalKey: string): void {
    const nextRememberedKeys = rememberApprovalKey(selectedProjectId, approvalKey);
    setRememberedApprovalKeys(nextRememberedKeys);
    runTaskAction(taskId, 'approve', `remember:${approvalKey}`);
  }

  function rejectPendingConfirmation(taskId: string): void {
    runTaskAction(taskId, 'reject', 'Rejected from projects page operator console');
  }

  function pauseActiveRun(): void {
    if (!activeProjectRun || activeProjectRun.paused) {
      return;
    }
    setActionMessage(null);
    runActionMutation.mutate({
      runId: activeProjectRun.runId,
      action: 'pause',
      note: 'Paused from projects page operator console'
    });
  }

  function resumeActiveRun(): void {
    if (!activeProjectRun?.paused) {
      return;
    }

    setActionMessage(null);
    runActionMutation.mutate({
      runId: activeProjectRun.runId,
      action: 'resume',
      note: 'Resumed from projects page operator console'
    });
  }

  function retryBlockedTask(taskId: string): void {
    runTaskAction(taskId, 'retry');
  }

  return {
    activeProjectRun,
    activeRunExecutionFeed,
    activeRunObservabilityQuery,
    activeRunTasksQuery,
    actionMessage,
    blockedReason,
    blockedTaskId,
    pendingConfirmations,
    sessionRunIdParam: sessionRunIdParam ?? null,
    sessionRun,
    sessionRunDetailQuery,
    sessionObservabilityQuery,
    sessionTasksQuery,
    sessionTasks,
    sessionPendingConfirmations,
    sessionBlockedTaskId,
    openRun: navigate,
    approveAndRememberPendingConfirmation,
    approvePendingConfirmation,
    pauseActiveRun,
    projectsQuery,
    rejectPendingConfirmation,
    registrationMutation,
    registrationState,
    resumeActiveRun,
    retryBlockedTask,
    runActionMutation,
    runsQuery,
    selectedProject,
    selectedProjectRuns,
    selectedProjectId,
    selectProject,
    submissionMutation,
    submissionState,
    submitProjectRegistration,
    submitProjectRun,
    submitWithRequirement,
    taskActionMutation,
    updateRegistrationField,
    updateSubmissionField
  };
}
