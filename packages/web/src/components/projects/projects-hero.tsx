import { useRef, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Sparkles, CheckCircle2, XCircle, AlertTriangle, Circle, GitBranch } from 'lucide-react';
import type { ProjectListItem, RunListItem, PlatformTaskRecord, PlatformTaskObservabilitySummary, PlatformObservabilityTimelineEntry } from '../../lib/control-plane-api';

type ExecutionFeedItem = {
  id: string;
  tone: 'info' | 'warning' | 'error' | 'success';
  title: string;
  detail: string;
};

type PendingConfirmationItem = {
  id: string;
  taskId: string;
  approvalKey: string;
  title: string;
  description: string;
  stage: string;
};

type Props = {
  selectedProject: ProjectListItem | null;
  activeRun: RunListItem | null;
  tasks: PlatformTaskRecord[];
  taskSummaries: PlatformTaskObservabilitySummary[];
  executionFeed: ExecutionFeedItem[];
  blockedReason: string | null;
  blockedTaskId: string | null;
  pendingConfirmations: PendingConfirmationItem[];
  requirement: string;
  requirementHistory: string[];
  onRequirementChange: (value: string) => void;
  onGenerate: (suggestion?: string) => void;
  onApproveConfirmation: (taskId: string) => void;
  onApproveAndRememberConfirmation: (taskId: string, approvalKey: string) => void;
  onPauseRun: () => void;
  onRejectConfirmation: (taskId: string) => void;
  onResumeRun: () => void;
  onRetryTask: (taskId: string) => void;
  actionMessage: string | null;
  isActionPending: boolean;
  isPending: boolean;
  isRunActionPending: boolean;
  errorMessage: string | null;
};

type RequirementHistoryDirection = 'previous' | 'next';

type RequirementHistoryNavigationState = {
  history: string[];
  currentValue: string;
  currentIndex: number | null;
  draftValue: string;
  direction: RequirementHistoryDirection;
};

type RequirementHistoryNavigationResult = {
  nextValue: string;
  nextIndex: number | null;
  nextDraftValue: string;
  didNavigate: boolean;
};

const PIPELINE_STAGES: { stageKey: string; label: string }[] = [
  { stageKey: 'requirements-analysis', label: '需求分析' },
  { stageKey: 'code-implementation', label: '代码实现' },
  { stageKey: 'test-design', label: '测试设计' },
  { stageKey: 'automated-execution', label: '自动执行' },
  { stageKey: 'defect-feedback', label: '缺陷反馈' },
  { stageKey: 'collaboration', label: '协作流程' },
  { stageKey: 'evaluation', label: '评估验收' },
];

export function resolveRequirementHistoryNavigation({
  history,
  currentValue,
  currentIndex,
  draftValue,
  direction,
}: RequirementHistoryNavigationState): RequirementHistoryNavigationResult {
  if (history.length === 0) {
    return {
      nextValue: currentValue,
      nextIndex: currentIndex,
      nextDraftValue: draftValue,
      didNavigate: false,
    };
  }

  if (direction === 'previous') {
    if (currentIndex === null) {
      return {
        nextValue: history[0] ?? currentValue,
        nextIndex: history[0] ? 0 : null,
        nextDraftValue: currentValue,
        didNavigate: Boolean(history[0]),
      };
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= history.length) {
      return {
        nextValue: currentValue,
        nextIndex: currentIndex,
        nextDraftValue: draftValue,
        didNavigate: false,
      };
    }

    return {
      nextValue: history[nextIndex] ?? currentValue,
      nextIndex,
      nextDraftValue: draftValue,
      didNavigate: true,
    };
  }

  if (currentIndex === null) {
    return {
      nextValue: currentValue,
      nextIndex: null,
      nextDraftValue: draftValue,
      didNavigate: false,
    };
  }

  if (currentIndex === 0) {
    return {
      nextValue: draftValue,
      nextIndex: null,
      nextDraftValue: '',
      didNavigate: true,
    };
  }

  const nextIndex = currentIndex - 1;
  return {
    nextValue: history[nextIndex] ?? currentValue,
    nextIndex,
    nextDraftValue: draftValue,
    didNavigate: true,
  };
}

type StageAggStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'blocked' | 'failed';

function getStageAggStatus(stageKey: string, tasks: PlatformTaskRecord[]): StageAggStatus {
  const stageTasks = tasks.filter((t) => t.stage === stageKey);
  if (stageTasks.length === 0) return 'pending';
  if (stageTasks.some((t) => ['in-progress', 'leased'].includes(t.status))) return 'running';
  if (stageTasks.some((t) => t.status === 'blocked')) return 'blocked';
  if (stageTasks.some((t) => t.status === 'failed')) return 'failed';
  if (stageTasks.every((t) => t.status === 'skipped')) return 'skipped';
  if (stageTasks.every((t) => ['completed', 'skipped'].includes(t.status))) return 'completed';
  return 'pending';
}

function getStagePrimaryTask(stageKey: string, tasks: PlatformTaskRecord[]): PlatformTaskRecord | null {
  const stageTasks = tasks.filter((t) => t.stage === stageKey);
  return (
    stageTasks.find((t) => ['in-progress', 'leased'].includes(t.status)) ??
    stageTasks.find((t) => t.status === 'blocked') ??
    stageTasks.find((t) => t.status === 'failed') ??
    stageTasks.find((t) => t.status === 'completed') ??
    stageTasks[0] ??
    null
  );
}

function StageIcon({ status }: Readonly<{ status: StageAggStatus }>): JSX.Element {
  if (status === 'completed') {
    return <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(74,222,128,0.72)' }} />;
  }
  if (status === 'skipped') {
    return <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.18)' }} />;
  }
  if (status === 'running') {
    return <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: 'rgba(0,240,255,0.85)' }} />;
  }
  if (status === 'blocked') {
    return <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,160,0,0.8)' }} />;
  }
  if (status === 'failed') {
    return <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,90,90,0.8)' }} />;
  }
  return <Circle className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.14)' }} />;
}

// Map event type → short Chinese label
function getEventLabel(type: string): string {
  const key = type.replace(/^(?:task|artifact|publication)\./, '');
  const MAP: Record<string, string> = {
    ready: '准备就绪',
    leased: '任务已分配',
    started: '开始执行',
    attached: '产物已生成',
    completed: '执行完成',
    blocked: '等待确认',
    'errors-recorded': '错误已记录',
    skipped: '已跳过',
    prepared: '发布准备中',
    'awaiting-approval': '等待批准',
    failed: '执行失败',
  };
  return MAP[key] ?? type;
}

function EventDot({ severity }: Readonly<{ severity: string }>): JSX.Element {
  const color =
    severity === 'error'
      ? 'rgba(255,90,90,0.75)'
      : severity === 'warning'
        ? 'rgba(255,180,80,0.65)'
        : 'rgba(100,200,255,0.5)';
  return <span className="mt-[5px] h-1 w-1 rounded-full flex-shrink-0" style={{ background: color }} />;
}

function StageEventStream({
  events,
  isRunning,
}: Readonly<{ events: PlatformObservabilityTimelineEntry[]; isRunning: boolean }>): JSX.Element {
  // show oldest → newest, cap at 5
  const shown = [...events].reverse().slice(-5);
  return (
    <div className="mt-2 flex flex-col gap-1 pl-0.5">
      {shown.map((ev, i) => {
        const isLatest = i === shown.length - 1;
        return (
          <div key={ev.eventId} className="flex items-start gap-2">
            {isLatest && isRunning ? (
              <Loader2
                className="w-2.5 h-2.5 flex-shrink-0 animate-spin mt-[3px]"
                style={{ color: 'rgba(0,240,255,0.6)' }}
              />
            ) : (
              <EventDot severity={ev.severity} />
            )}
            <span
              className="text-[11px] font-mono leading-snug"
              style={{
                color: isLatest && isRunning
                  ? 'rgba(0,240,255,0.75)'
                  : 'rgba(255,255,255,0.28)',
              }}
            >
              {getEventLabel(ev.type)}
              {ev.payload?.summary ? (
                <span style={{ color: 'rgba(255,255,255,0.18)' }}> — {String(ev.payload.summary).slice(0, 60)}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StageLogRow({
  stageKey,
  stageLabel,
  tasks,
  taskSummaries,
}: Readonly<{ stageKey: string; stageLabel: string; tasks: PlatformTaskRecord[]; taskSummaries: PlatformTaskObservabilitySummary[] }>): JSX.Element {
  const status = getStageAggStatus(stageKey, tasks);
  const primaryTask = getStagePrimaryTask(stageKey, tasks);
  const stageTasks = tasks.filter((t) => t.stage === stageKey);
  const isPending = status === 'pending';
  const isRunning = status === 'running';
  const isDone = status === 'completed' || status === 'skipped';
  const completedCount = stageTasks.filter((t) => ['completed', 'skipped'].includes(t.status)).length;

  // Find the live task summary for this stage — prefer running, then blocked
  const activeSummary =
    taskSummaries.find((s) => s.stage === stageKey && ['in-progress', 'leased'].includes(s.status)) ??
    (status === 'blocked' ? taskSummaries.find((s) => s.stage === stageKey && s.status === 'blocked') : undefined);
  // For completed stages, show a brief completed event if available
  const completedSummary =
    isDone && !activeSummary
      ? taskSummaries.find((s) => s.stage === stageKey && ['completed', 'skipped'].includes(s.status))
      : undefined;
  const eventsToShow = activeSummary?.recentEvents ?? completedSummary?.recentEvents ?? [];
  const showEvents = eventsToShow.length > 0 && (isRunning || status === 'blocked' || isDone);

  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="mt-0.5 flex-shrink-0">
        <StageIcon status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{
              color: isPending
                ? 'rgba(255,255,255,0.18)'
                : isRunning
                  ? 'rgba(255,255,255,0.88)'
                  : isDone
                    ? 'rgba(255,255,255,0.45)'
                    : 'rgba(255,180,80,0.8)',
            }}
          >
            {stageLabel}
          </span>
          {isRunning && (
            <span className="text-[10px] font-mono" style={{ color: 'rgba(0,240,255,0.5)' }}>
              进行中
            </span>
          )}
          {status === 'blocked' && (
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,160,0,0.55)' }}>
              等待确认
            </span>
          )}
          {status === 'skipped' && (
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.15)' }}>
              已跳过
            </span>
          )}
        </div>
        {primaryTask && !isPending && (
          <p
            className="text-[11px] mt-0.5 leading-relaxed"
            style={{ color: isRunning ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.2)' }}
          >
            {primaryTask.goal?.slice(0, 120) ?? primaryTask.title}
          </p>
        )}
        {showEvents && (
          <StageEventStream events={eventsToShow} isRunning={isRunning} />
        )}
      </div>
      {stageTasks.length > 1 && (
        <span
          className="text-[10px] font-mono mt-0.5 flex-shrink-0"
          style={{ color: 'rgba(255,255,255,0.14)' }}
        >
          {completedCount}/{stageTasks.length}
        </span>
      )}
    </div>
  );
}

type PendingConfirmationPanelProps = Readonly<{
  pendingConfirmations: PendingConfirmationItem[];
  isActionPending: boolean;
  onApproveConfirmation: (taskId: string) => void;
  onApproveAndRememberConfirmation: (taskId: string, approvalKey: string) => void;
  onRejectConfirmation: (taskId: string) => void;
}>;

function PendingConfirmationPanel({
  pendingConfirmations,
  isActionPending,
  onApproveConfirmation,
  onApproveAndRememberConfirmation,
  onRejectConfirmation,
}: PendingConfirmationPanelProps): JSX.Element {
  return (
    <div
      className="rounded-xl border"
      style={{
        background: 'rgba(255,160,0,0.05)',
        border: '1px solid rgba(255,160,0,0.14)',
        padding: '12px 14px',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,200,120,0.42)' }}>Pending Confirmation</p>
          <p className="text-sm" style={{ color: 'rgba(255,220,180,0.82)' }}>等待人工确认，已经列出来了</p>
        </div>
        <span className="text-[10px] font-mono" style={{ color: 'rgba(255,220,180,0.55)' }}>三选一</span>
      </div>

      <div className="flex flex-col gap-3">
        {pendingConfirmations.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border"
            style={{
              background: 'rgba(10,10,10,0.2)',
              border: '1px solid rgba(255,190,120,0.1)',
              padding: '10px 12px',
            }}
          >
            <div className="mb-3">
              <p className="text-sm" style={{ color: 'rgba(255,235,210,0.9)' }}>{item.title}</p>
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,220,180,0.58)' }}>
                {item.description}
              </p>
              <p className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(255,220,180,0.38)' }}>
                阶段：{PIPELINE_STAGES.find((stage) => stage.stageKey === item.stage)?.label ?? item.stage}
              </p>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => onApproveConfirmation(item.taskId)}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.18)', color: 'rgba(0,240,255,0.82)' }}
              >
                <span>批准本次</span><span>✅</span>
              </button>
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => onApproveAndRememberConfirmation(item.taskId, item.approvalKey)}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}
              >
                <span>同类默认批准</span><span>✅</span>
              </button>
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => onRejectConfirmation(item.taskId)}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(255,90,90,0.09)', border: '1px solid rgba(255,90,90,0.16)', color: 'rgba(255,120,120,0.88)' }}
              >
                <span>拒绝并停止</span><span>🛑</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectsHeroPanel({
  selectedProject,
  activeRun,
  tasks,
  taskSummaries,
  executionFeed,
  blockedReason,
  blockedTaskId,
  pendingConfirmations,
  requirement,
  requirementHistory,
  onRequirementChange,
  onGenerate,
  onApproveConfirmation,
  onApproveAndRememberConfirmation,
  onPauseRun,
  onRejectConfirmation,
  onResumeRun,
  onRetryTask,
  actionMessage,
  isActionPending,
  isPending,
  isRunActionPending,
  errorMessage,
}: Readonly<Props>): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState('');

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [requirement]);

  // Auto-scroll execution log to bottom on new events
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [executionFeed.length, tasks.length, taskSummaries.length]);

  useEffect(() => {
    setHistoryIndex(null);
    setDraftBeforeHistory('');
  }, [selectedProject?.projectId]);

  const hasActiveRun = Boolean(activeRun);
  const requirementText = activeRun?.requirement?.trim() || activeRun?.workflowName || '';
  const isLive = activeRun
    ? ['running', 'pending', 'blocked'].includes(activeRun.status) && !activeRun.paused
    : false;
  const canOperate = activeRun
    ? !['completed', 'failed', 'cancelled'].includes(activeRun.status)
    : false;
  const isBlocked = activeRun?.status === 'blocked' && !activeRun.paused;

  // Recent activity: skip the first status-summary item, show event items
  const recentEvents = executionFeed.slice(1).filter((item) => item.tone !== 'info' || item.title !== '当前阶段：准备中');

  return (
    <div className="w-full h-full flex flex-col" style={{ maxWidth: '720px', margin: '0 auto' }}>

      {/* ── Empty state ── */}
      {!hasActiveRun && (
        <div className="flex-1 flex flex-col items-center justify-center pb-10">
          <p className="text-[11px] tracking-widest uppercase text-white/20 mb-4">
            {selectedProject ? `${selectedProject.projectName}` : 'Select a project to start'}
          </p>
          <h1 className="font-bold text-3xl lg:text-4xl tracking-tight text-white/80 mb-3">
            输入需求，自动交付
          </h1>
          <p className="text-white/25 text-sm text-center max-w-sm">
            描述你想实现的功能，系统自动完成六个阶段的完整交付流程
          </p>
          <div className="mt-8 flex items-center gap-1.5 flex-wrap justify-center">
            <span className="text-[10px] text-white/12 mr-1">Auto pipeline</span>
            {PIPELINE_STAGES.map((stage, i) => (
              <div key={stage.stageKey} className="flex items-center gap-1.5">
                <span
                  className="px-2 py-0.5 text-[10px] rounded border"
                  style={{ borderColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)', background: 'transparent' }}
                >
                  {stage.label}
                </span>
                {i < PIPELINE_STAGES.length - 1 && (
                  <ArrowRight className="w-2 h-2 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.08)' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Codex-style execution log ── */}
      {hasActiveRun && (
        <div
          ref={logRef}
          className="flex-1 overflow-y-auto py-6 flex flex-col gap-5"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
        >
          {/* Requirement bubble */}
          <div
            className="rounded-2xl px-5 py-4"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <p
              className="text-[10px] tracking-widest uppercase mb-2"
              style={{ color: 'rgba(255,255,255,0.2)' }}
            >
              需求
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {requirementText || activeRun?.workflowName}
            </p>
            {activeRun?.branchName && (
              <div className="flex items-center gap-1.5 mt-3">
                <GitBranch className="w-3 h-3" style={{ color: 'rgba(0,240,255,0.4)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'rgba(0,240,255,0.4)' }}>
                  {activeRun.branchName}
                </span>
              </div>
            )}
          </div>

          {/* Stage-by-stage execution log */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="px-4 pt-4 pb-1">
              <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.15)' }}>
                执行过程
              </p>
            </div>
            <div className="px-4 pb-2">
              {PIPELINE_STAGES.map((stage) => (
                <StageLogRow
                  key={stage.stageKey}
                  stageKey={stage.stageKey}
                  stageLabel={stage.label}
                  tasks={tasks}
                  taskSummaries={taskSummaries}
                />
              ))}
            </div>
          </div>

          {/* Recent activity (from observability events) */}
          {recentEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.12)' }}>
                最近动态
              </p>
              {recentEvents.map((item) => {
                const dotColor =
                  item.tone === 'error'
                    ? 'rgba(255,90,90,0.75)'
                    : item.tone === 'warning'
                      ? 'rgba(255,180,80,0.65)'
                      : item.tone === 'success'
                        ? 'rgba(74,222,128,0.65)'
                        : 'rgba(255,255,255,0.2)';
                return (
                  <div key={item.id} className="flex items-start gap-2.5">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ background: dotColor }}
                    />
                    <div className="min-w-0">
                      <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{item.title}</p>
                      {item.detail && item.detail !== item.title && (
                        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {item.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live spinner */}
          {isLive && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'rgba(0,240,255,0.45)' }} />
              <span className="text-[11px] font-mono" style={{ color: 'rgba(0,240,255,0.4)' }}>
                {activeRun?.currentStage
                  ? `正在执行：${PIPELINE_STAGES.find((s) => s.stageKey === activeRun.currentStage)?.label ?? activeRun.currentStage}`
                  : '执行中…'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom: controls + input ── */}
      <div className="pb-6 pt-3 flex-shrink-0">
        {/* Run controls + confirmations */}
        {(pendingConfirmations.length > 0 || blockedReason || (canOperate && activeRun) || actionMessage) && (
          <div className="mb-3 flex flex-col gap-2.5">
            {/* Blocked reason */}
            {blockedReason && (
              <p className="text-[11px] font-mono px-1" style={{ color: 'rgba(255,160,0,0.7)' }}>
                ⚠ {blockedReason}
              </p>
            )}

            {/* Compact control bar */}
            {activeRun && canOperate && (
              <div className="flex items-center gap-2">
                {isBlocked && blockedTaskId ? (
                  <button
                    type="button"
                    disabled={isRunActionPending}
                    onClick={() => onRetryTask(blockedTaskId)}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-mono transition-all duration-200 disabled:opacity-40"
                    style={{
                      background: 'rgba(0,240,255,0.08)',
                      border: '1px solid rgba(0,240,255,0.18)',
                      color: 'rgba(0,240,255,0.82)',
                    }}
                  >
                    {isRunActionPending ? '处理中...' : '🔄 重试任务'}
                  </button>
                ) : !isBlocked ? (
                  <button
                    type="button"
                    disabled={isRunActionPending}
                    onClick={activeRun.paused ? onResumeRun : onPauseRun}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-mono transition-all duration-200 disabled:opacity-40"
                    style={{
                      background: activeRun.paused ? 'rgba(0,240,255,0.07)' : 'rgba(255,255,255,0.04)',
                      border: activeRun.paused ? '1px solid rgba(0,240,255,0.18)' : '1px solid rgba(255,255,255,0.08)',
                      color: activeRun.paused ? 'rgba(0,240,255,0.78)' : 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {isRunActionPending ? '处理中...' : activeRun.paused ? '继续未完成任务' : '暂停'}
                  </button>
                ) : null}
              </div>
            )}

            {/* Pending confirmations */}
            {pendingConfirmations.length > 0 && (
              <PendingConfirmationPanel
                pendingConfirmations={pendingConfirmations}
                isActionPending={isActionPending}
                onApproveConfirmation={onApproveConfirmation}
                onApproveAndRememberConfirmation={onApproveAndRememberConfirmation}
                onRejectConfirmation={onRejectConfirmation}
              />
            )}

            {actionMessage && (
              <p className="text-[11px] font-mono px-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{actionMessage}</p>
            )}
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <p className="mb-2 text-xs font-mono" style={{ color: 'rgba(255,90,90,0.7)' }}>{errorMessage}</p>
        )}

        {/* Input box */}
        <div
          className="flex flex-col rounded-xl border transition-colors duration-200 focus-within:border-white/20"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.09)',
            padding: '14px 18px 10px 18px',
            gap: '10px',
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={requirement}
            onChange={(e) => {
              if (historyIndex !== null) {
                setHistoryIndex(null);
                setDraftBeforeHistory('');
              }
              onRequirementChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                const navigation = resolveRequirementHistoryNavigation({
                  history: requirementHistory,
                  currentValue: requirement,
                  currentIndex: historyIndex,
                  draftValue: draftBeforeHistory,
                  direction: e.key === 'ArrowUp' ? 'previous' : 'next',
                });

                if (navigation.didNavigate) {
                  e.preventDefault();
                  setHistoryIndex(navigation.nextIndex);
                  setDraftBeforeHistory(navigation.nextDraftValue);
                  onRequirementChange(navigation.nextValue);
                  return;
                }
              }

              if (e.key === 'Enter' && !e.shiftKey && !isPending) {
                e.preventDefault();
                onGenerate();
              }
            }}
            placeholder={selectedProject ? '描述新需求… (Enter 发送)' : '请先选择项目…'}
            disabled={!selectedProject || isPending}
            className="w-full bg-transparent border-none focus:ring-0 text-base text-white/70 placeholder:text-white/18 outline-none disabled:opacity-40 font-normal resize-none overflow-hidden leading-relaxed"
            style={{ minHeight: '1.75rem' }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 overflow-hidden">
              {PIPELINE_STAGES.map((stage, i) => (
                <div key={stage.stageKey} className="flex items-center gap-1 flex-shrink-0">
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={
                      isPending
                        ? {
                            background: 'rgba(0,240,255,0.07)',
                            color: 'rgba(0,240,255,0.5)',
                            animation: `pulse 1.4s ease-in-out ${i * 0.18}s infinite`,
                          }
                        : { color: 'rgba(255,255,255,0.15)' }
                    }
                  >
                    {stage.label}
                  </span>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <ArrowRight className="w-2 h-2 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.07)' }} />
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => onGenerate()}
              disabled={!selectedProject || !requirement.trim() || isPending || isActionPending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: isPending ? 'rgba(0,240,255,0.07)' : 'rgba(0,240,255,0.11)',
                color: 'rgba(0,240,255,0.85)',
                border: '1px solid rgba(0,240,255,0.18)',
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  开始执行
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
