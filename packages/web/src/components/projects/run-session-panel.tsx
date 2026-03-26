import { useRef, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2, Circle, GitBranch } from 'lucide-react';
import type {
  RunListItem,
  PlatformObservability,
  PlatformObservabilityTimelineEntry,
  PlatformTaskRecord,
  PlatformRunStatus,
} from '../../lib/control-plane-api';

const PIPELINE_STAGES: { stageKey: string; label: string }[] = [
  { stageKey: 'requirements-analysis', label: '需求分析' },
  { stageKey: 'code-implementation', label: '代码实现' },
  { stageKey: 'test-design', label: '测试设计' },
  { stageKey: 'automated-execution', label: '自动执行' },
  { stageKey: 'defect-feedback', label: '缺陷反馈' },
  { stageKey: 'collaboration', label: '协作流程' },
];

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.stageKey);

type PendingConfirmationItem = {
  id: string;
  taskId: string;
  approvalKey: string;
  title: string;
  description: string;
  stage: string;
};

type Props = Readonly<{
  run: RunListItem;
  tasks: PlatformTaskRecord[];
  observability: PlatformObservability | undefined;
  pendingConfirmations: PendingConfirmationItem[];
  blockedTaskId: string | null;
  isActionPending: boolean;
  isRunActionPending: boolean;
  actionMessage: string | null;
  onBack: () => void;
  onApproveConfirmation: (taskId: string) => void;
  onApproveAndRememberConfirmation: (taskId: string, approvalKey: string) => void;
  onRejectConfirmation: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
}>;

function stageIndex(stage: string | null | undefined): number {
  if (!stage) return -1;
  return STAGE_ORDER.indexOf(stage);
}

function getStatusBadge(status: PlatformRunStatus, paused: boolean): { label: string; bg: string; color: string } {
  if (paused) return { label: 'paused', bg: 'rgba(255,180,80,0.12)', color: 'rgba(255,210,140,0.86)' };
  if (status === 'completed') return { label: 'completed', bg: 'rgba(74,222,128,0.1)', color: 'rgba(74,222,128,0.78)' };
  if (status === 'running') return { label: 'running', bg: 'rgba(0,240,255,0.08)', color: 'rgba(0,240,255,0.75)' };
  if (status === 'blocked') return { label: 'blocked', bg: 'rgba(255,160,0,0.09)', color: 'rgba(255,180,80,0.8)' };
  if (status === 'failed') return { label: 'failed', bg: 'rgba(255,90,90,0.09)', color: 'rgba(255,120,120,0.8)' };
  if (status === 'cancelled') return { label: 'cancelled', bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)' };
  return { label: status, bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' };
}

function getStageSegmentBg(isCurrent: boolean, isPast: boolean, isFailed: boolean): string {
  if (isFailed) return 'rgba(255,90,90,0.5)';
  if (isCurrent) return 'rgba(0,240,255,0.7)';
  if (isPast) return 'rgba(0,240,255,0.25)';
  return 'rgba(255,255,255,0.06)';
}

function getEventSeverityColor(severity: string): string {
  if (severity === 'error') return 'rgba(255,90,90,0.85)';
  if (severity === 'warning') return 'rgba(255,180,80,0.7)';
  return 'rgba(255,255,255,0.2)';
}

function getEventIcon(type: string, severity: string): JSX.Element {
  const dotStyle = { color: getEventSeverityColor(severity) };
  if (type.includes('completed') || type.includes('published')) {
    return <CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'rgba(74,222,128,0.6)' }} />;
  }
  if (type.includes('failed') || type.includes('blocked')) {
    return <XCircle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,90,90,0.7)' }} />;
  }
  if (severity === 'warning' || severity === 'error') {
    return <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" style={dotStyle} />;
  }
  if (type.includes('started') || type.includes('in-progress')) {
    return <Loader2 className="w-3 h-3 flex-shrink-0 mt-0.5 animate-spin" style={{ color: 'rgba(0,240,255,0.6)' }} />;
  }
  return <Circle className="w-3 h-3 flex-shrink-0 mt-0.5" style={dotStyle} />;
}

function formatEventTime(createdAt: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.valueOf())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function extractEventDetail(entry: PlatformObservabilityTimelineEntry): string | null {
  const payload = entry.payload;
  const errorList = payload.errors;
  if (Array.isArray(errorList)) {
    const first = errorList.find(
      (e) => e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
    ) as { message: string } | undefined;
    if (first?.message) return first.message;
  }
  for (const key of ['message', 'summary', 'gateReason', 'note'] as const) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function getTaskForEntry(
  entry: PlatformObservabilityTimelineEntry,
  taskIndex: Map<string, PlatformTaskRecord>
): PlatformTaskRecord | undefined {
  return entry.taskId ? taskIndex.get(entry.taskId) : undefined;
}

type StageGroupedEvents = {
  stageKey: string;
  stageLabel: string;
  events: PlatformObservabilityTimelineEntry[];
};

function groupEventsByStage(
  timeline: PlatformObservabilityTimelineEntry[],
  taskIndex: Map<string, PlatformTaskRecord>
): StageGroupedEvents[] {
  const groups: StageGroupedEvents[] = [];
  const stageGroupMap = new Map<string, StageGroupedEvents>();

  // Events come newest-first from API, reverse for chronological display
  const chronological = [...timeline].reverse();

  for (const entry of chronological) {
    const task = getTaskForEntry(entry, taskIndex);
    const stageKey = task?.stage ?? 'system';
    const stageLabel = PIPELINE_STAGES.find((s) => s.stageKey === stageKey)?.label ?? stageKey;

    let group = stageGroupMap.get(stageKey);
    if (!group) {
      group = { stageKey, stageLabel, events: [] };
      stageGroupMap.set(stageKey, group);
      groups.push(group);
    }
    group.events.push(entry);
  }

  return groups;
}

export function RunSessionPanel({
  run,
  tasks,
  observability,
  pendingConfirmations,
  blockedTaskId,
  isActionPending,
  isRunActionPending,
  actionMessage,
  onBack,
  onApproveConfirmation,
  onApproveAndRememberConfirmation,
  onRejectConfirmation,
  onRetryTask,
  onPauseRun,
  onResumeRun,
}: Props): JSX.Element {
  const feedRef = useRef<HTMLDivElement>(null);
  const taskIndex = new Map(tasks.map((t) => [t.taskId, t]));
  const timeline = observability?.timeline ?? [];
  const stageGroups = groupEventsByStage(timeline, taskIndex);

  const activeIdx = stageIndex(run.currentStage);
  const badge = getStatusBadge(run.status, run.paused);
  const isLive = ['running', 'pending', 'blocked'].includes(run.status) && !run.paused;
  const canOperate = !['completed', 'failed', 'cancelled'].includes(run.status);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const requirementText = run.requirement?.trim() || run.workflowName;

  return (
    <div className="w-full h-full flex flex-col" style={{ maxWidth: '720px', margin: '0 auto' }}>

      {/* ── Session header ── */}
      <div className="flex-shrink-0 pt-6 pb-4">
        {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 mb-4 text-[11px] font-mono transition-colors"
          style={{ color: 'rgba(255,255,255,0.3)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回项目
        </button>

        {/* Run title + meta */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-sm font-medium leading-relaxed line-clamp-2">{requirementText}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {run.branchName && (
                <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'rgba(0,240,255,0.45)' }}>
                  <GitBranch className="w-3 h-3" />
                  {run.branchName}
                </span>
              )}
              <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>
                {run.runId.slice(0, 8)}
              </span>
            </div>
          </div>
          <span
            className="text-[10px] px-2 py-1 rounded font-mono flex-shrink-0"
            style={{ background: badge.bg, color: badge.color }}
          >
            {badge.label}
          </span>
        </div>

        {/* Stage progress bar */}
        <div className="flex items-center gap-1 mt-4">
          {PIPELINE_STAGES.map((stage, i) => {
            const isDone = activeIdx > i || run.status === 'completed';
            const isCurrent = activeIdx === i && run.status !== 'completed';
            const isPast = isDone && !isCurrent;
            const isFailedStage = run.status === 'failed' && isCurrent;

            const segBg = getStageSegmentBg(isCurrent, isPast, isFailedStage);

            return (
              <div key={stage.stageKey} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full h-1 rounded-full transition-all duration-500"
                  style={{
                    background: segBg,
                    boxShadow: isCurrent ? '0 0 6px rgba(0,240,255,0.5)' : 'none',
                    animation: isCurrent && isLive ? 'pulse 1.4s ease-in-out infinite' : 'none',
                  }}
                />
                <span
                  className="text-[9px] font-mono truncate w-full text-center"
                  style={{ color: isCurrent ? 'rgba(0,240,255,0.6)' : isPast ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }}
                >
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }} />

      {/* ── Scrollable event log ── */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto py-4 flex flex-col gap-4"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
      >
        {/* Requirement bubble */}
        <div
          className="rounded-xl px-4 py-3 text-sm leading-relaxed"
          style={{
            background: 'rgba(0,240,255,0.05)',
            border: '1px solid rgba(0,240,255,0.1)',
            color: 'rgba(255,255,255,0.72)',
          }}
        >
          <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(0,240,255,0.4)' }}>需求</p>
          {requirementText}
        </div>

        {/* Event groups */}
        {stageGroups.length === 0 && (
          <div className="flex items-center gap-2 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'rgba(0,240,255,0.4)' }} />
            <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
              等待任务启动…
            </span>
          </div>
        )}

        {stageGroups.map((group) => (
          <div key={group.stageKey} className="flex flex-col gap-0">
            {/* Stage label */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {group.stageLabel === group.stageKey ? '系统' : group.stageLabel}
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
            </div>

            {/* Events in this stage */}
            <div className="flex flex-col gap-1.5 pl-2">
              {group.events.map((entry) => {
                const detail = extractEventDetail(entry);
                return (
                  <div key={entry.eventId} className="flex items-start gap-2.5">
                    {getEventIcon(entry.type, entry.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.65)' }}>{entry.title}</p>
                        {entry.createdAt && (
                          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
                            {formatEventTime(entry.createdAt)}
                          </span>
                        )}
                      </div>
                      {detail && entry.title !== detail && (
                        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Live indicator */}
        {isLive && (
          <div className="flex items-center gap-2 py-2 pl-2">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'rgba(0,240,255,0.5)' }} />
            <span className="text-[11px] font-mono" style={{ color: 'rgba(0,240,255,0.45)' }}>
              {run.currentStage
                ? `正在执行：${PIPELINE_STAGES.find((s) => s.stageKey === run.currentStage)?.label ?? run.currentStage}`
                : '执行中…'}
            </span>
          </div>
        )}
      </div>

      {/* ── Bottom actions ── */}
      {(pendingConfirmations.length > 0 || blockedTaskId || canOperate || actionMessage) && (
        <div className="flex-shrink-0 pt-3 pb-6 flex flex-col gap-2.5">
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '4px' }} />

          {/* Pending confirmations */}
          {pendingConfirmations.length > 0 && (
            <div
              className="rounded-xl border"
              style={{
                background: 'rgba(255,160,0,0.05)',
                border: '1px solid rgba(255,160,0,0.14)',
                padding: '12px 14px',
              }}
            >
              <p className="text-[10px] tracking-widest uppercase mb-3" style={{ color: 'rgba(255,200,120,0.42)' }}>
                Pending Confirmation
              </p>
              {pendingConfirmations.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border mb-3 last:mb-0"
                  style={{
                    background: 'rgba(10,10,10,0.2)',
                    border: '1px solid rgba(255,190,120,0.1)',
                    padding: '10px 12px',
                  }}
                >
                  <p className="text-sm mb-1" style={{ color: 'rgba(255,235,210,0.9)' }}>{item.title}</p>
                  <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'rgba(255,220,180,0.58)' }}>
                    {item.description}
                  </p>
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
          )}

          {/* Retry button for blocked task */}
          {blockedTaskId && pendingConfirmations.length === 0 && (
            <button
              type="button"
              disabled={isRunActionPending}
              onClick={() => onRetryTask(blockedTaskId)}
              className="w-full rounded-xl py-2.5 text-xs font-mono transition-all duration-200 disabled:opacity-40"
              style={{ background: 'rgba(0,240,255,0.07)', border: '1px solid rgba(0,240,255,0.16)', color: 'rgba(0,240,255,0.8)' }}
            >
              {isRunActionPending ? '处理中...' : '🔄 重试当前任务'}
            </button>
          )}

          {/* Pause / Resume */}
          {canOperate && !blockedTaskId && pendingConfirmations.length === 0 && (
            <button
              type="button"
              disabled={isRunActionPending}
              onClick={run.paused ? onResumeRun : onPauseRun}
              className="w-full rounded-xl py-2 text-[11px] font-mono transition-all duration-200 disabled:opacity-40"
              style={{
                background: run.paused ? 'rgba(0,240,255,0.07)' : 'rgba(255,255,255,0.03)',
                border: run.paused ? '1px solid rgba(0,240,255,0.16)' : '1px solid rgba(255,255,255,0.07)',
                color: run.paused ? 'rgba(0,240,255,0.75)' : 'rgba(255,255,255,0.3)',
              }}
            >
              {isRunActionPending ? '处理中...' : run.paused ? '继续未完成任务' : '停止后稍后继续'}
            </button>
          )}

          {actionMessage && (
            <p className="text-[11px] font-mono px-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{actionMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
