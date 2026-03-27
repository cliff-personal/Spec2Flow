import { useEffect, useState } from 'react';
import {
  getArtifactContent,
  type PlatformArtifactRecord,
  type PlatformObservabilityApprovalItem,
  type PlatformObservabilityTimelineEntry,
  type PlatformPublicationObservabilitySummary,
  type PlatformRepairObservabilitySummary,
  type PlatformTaskObservabilitySummary,
  type PlatformTaskRecord,
} from '../../lib/control-plane-api';

function summarizeArtifactLabel(artifact: PlatformArtifactRecord): string {
  return artifact.metadata?.originalArtifactId && typeof artifact.metadata.originalArtifactId === 'string'
    ? artifact.metadata.originalArtifactId
    : artifact.kind;
}

function truncatePreview(content: string): string {
  return content.length > 4000 ? `${content.slice(0, 4000)}\n...` : content;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return '--';
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function statusTone(status: string): { color: string; background: string } {
  if (status === 'succeeded' || status === 'published' || status === 'approved' || status === 'completed') {
    return { color: 'rgba(74,222,128,0.9)', background: 'rgba(74,222,128,0.1)' };
  }

  if (status === 'failed' || status === 'blocked' || status === 'rejected' || status === 'approval-required') {
    return { color: 'rgba(255,120,120,0.92)', background: 'rgba(255,120,120,0.12)' };
  }

  return { color: 'rgba(0,240,255,0.86)', background: 'rgba(0,240,255,0.09)' };
}

type ClosureTimelineItem = {
  id: string;
  createdAt: string | null;
  title: string;
  detail: string | null;
  lane: 'stage' | 'repair' | 'approval' | 'publication';
  tone: 'info' | 'warning' | 'error' | 'success';
};

export type CommandSignalCard = {
  label: string;
  value: string;
  detail: string;
  tone: ClosureTimelineItem['tone'];
};

type StageResultPanelProps = Readonly<{
  stageKey: string;
  stageLabel: string;
  tasks: PlatformTaskRecord[];
  taskSummaries: PlatformTaskObservabilitySummary[];
  artifacts: PlatformArtifactRecord[];
  repairSummaries: PlatformRepairObservabilitySummary[];
  publicationSummaries: PlatformPublicationObservabilitySummary[];
  approvals: PlatformObservabilityApprovalItem[];
  stageEvents: PlatformObservabilityTimelineEntry[];
  eventCount: number;
}>;

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function detailFromPayload(entry: PlatformObservabilityTimelineEntry): string | null {
  for (const key of ['message', 'summary', 'gateReason', 'note'] as const) {
    const value = entry.payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const errorList = entry.payload.errors;
  if (Array.isArray(errorList)) {
    const first = errorList.find(
      (item) => item && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string'
    ) as { message: string } | undefined;
    if (first?.message) {
      return first.message;
    }
  }

  return null;
}

function laneLabel(lane: ClosureTimelineItem['lane']): string {
  if (lane === 'repair') {
    return 'repair';
  }

  if (lane === 'approval') {
    return 'approval';
  }

  if (lane === 'publication') {
    return 'publication';
  }

  return 'stage';
}

function toneColor(tone: ClosureTimelineItem['tone']): string {
  if (tone === 'success') {
    return 'rgba(74,222,128,0.9)';
  }

  if (tone === 'error') {
    return 'rgba(255,120,120,0.92)';
  }

  if (tone === 'warning') {
    return 'rgba(255,196,98,0.92)';
  }

  return 'rgba(0,240,255,0.86)';
}

function toneSurface(tone: ClosureTimelineItem['tone']): string {
  if (tone === 'success') {
    return 'rgba(74,222,128,0.08)';
  }

  if (tone === 'error') {
    return 'rgba(255,120,120,0.08)';
  }

  if (tone === 'warning') {
    return 'rgba(255,196,98,0.08)';
  }

  return 'rgba(0,240,255,0.08)';
}

function toneFromSeverity(severity: PlatformObservabilityTimelineEntry['severity']): ClosureTimelineItem['tone'] {
  if (severity === 'error') {
    return 'error';
  }

  if (severity === 'warning') {
    return 'warning';
  }

  return 'info';
}

function isClosureEvent(entry: PlatformObservabilityTimelineEntry): boolean {
  return entry.category === 'repair'
    || entry.category === 'approval'
    || entry.category === 'publication'
    || entry.type.includes('defect')
    || entry.type.includes('repair')
    || entry.type.includes('approval')
    || entry.type.includes('publication');
}

function closureLaneFromEntry(entry: PlatformObservabilityTimelineEntry): ClosureTimelineItem['lane'] {
  if (entry.category === 'repair' || entry.type.includes('repair')) {
    return 'repair';
  }

  if (entry.category === 'approval' || entry.type.includes('approval')) {
    return 'approval';
  }

  if (entry.category === 'publication' || entry.type.includes('publication')) {
    return 'publication';
  }

  return 'stage';
}

function toneFromRepairEntry(entry: PlatformObservabilityTimelineEntry): ClosureTimelineItem['tone'] {
  if (entry.type.includes('succeeded')) {
    return 'success';
  }

  return toneFromSeverity(entry.severity);
}

function toneFromPublicationEntry(entry: PlatformObservabilityTimelineEntry): ClosureTimelineItem['tone'] {
  if (entry.type.includes('published')) {
    return 'success';
  }

  return toneFromSeverity(entry.severity);
}

function toneFromApprovalStatus(status: PlatformObservabilityApprovalItem['status']): ClosureTimelineItem['tone'] {
  if (status === 'approved') {
    return 'success';
  }

  if (status === 'rejected' || status === 'blocked') {
    return 'warning';
  }

  return 'info';
}

function buildStageClosureItems(stageEvents: PlatformObservabilityTimelineEntry[]): ClosureTimelineItem[] {
  return stageEvents
    .filter(isClosureEvent)
    .map((entry) => ({
      id: entry.eventId,
      createdAt: entry.createdAt,
      title: entry.title,
      detail: detailFromPayload(entry),
      lane: closureLaneFromEntry(entry),
      tone: toneFromSeverity(entry.severity),
    }));
}

function buildRepairClosureItems(repairSummaries: PlatformRepairObservabilitySummary[]): ClosureTimelineItem[] {
  return repairSummaries.flatMap((summary) =>
    summary.recentEvents.map((entry) => ({
      id: entry.eventId,
      createdAt: entry.createdAt,
      title: entry.title,
      detail: detailFromPayload(entry) ?? `repair ${summary.failureClass} #${summary.attemptNumber}`,
      lane: 'repair',
      tone: toneFromRepairEntry(entry),
    }))
  );
}

function buildPublicationClosureItems(
  publicationSummaries: PlatformPublicationObservabilitySummary[]
): ClosureTimelineItem[] {
  return publicationSummaries.flatMap((summary) =>
    (summary.recentEvents ?? []).map((entry) => ({
      id: entry.eventId,
      createdAt: entry.createdAt,
      title: entry.title,
      detail: detailFromPayload(entry) ?? summary.gateReason ?? summary.prUrl ?? null,
      lane: 'publication',
      tone: toneFromPublicationEntry(entry),
    }))
  );
}

function buildApprovalClosureItems(approvals: PlatformObservabilityApprovalItem[]): ClosureTimelineItem[] {
  return approvals.map((approval) => ({
    id: `approval-${approval.publicationId ?? approval.taskId ?? approval.createdAt ?? 'unknown'}`,
    createdAt: approval.createdAt,
    title: `Approval ${approval.status}`,
    detail: approval.reason ?? approval.publicationId ?? approval.taskId ?? null,
    lane: 'approval',
    tone: toneFromApprovalStatus(approval.status),
  }));
}

export function buildClosureTimeline(
  stageEvents: PlatformObservabilityTimelineEntry[],
  repairSummaries: PlatformRepairObservabilitySummary[],
  publicationSummaries: PlatformPublicationObservabilitySummary[],
  approvals: PlatformObservabilityApprovalItem[]
): ClosureTimelineItem[] {
  const items = new Map<string, ClosureTimelineItem>();
  const sources = [
    ...buildStageClosureItems(stageEvents),
    ...buildRepairClosureItems(repairSummaries),
    ...buildPublicationClosureItems(publicationSummaries),
    ...buildApprovalClosureItems(approvals),
  ];

  for (const item of sources) {
    if (!items.has(item.id)) {
      items.set(item.id, item);
    }
  }

  return [...items.values()].sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt));
}

function isOpenTaskStatus(status: string): boolean {
  return ['pending', 'ready', 'leased', 'in-progress', 'running', 'blocked'].includes(status);
}

function deriveRecoveryCard(repairSummaries: PlatformRepairObservabilitySummary[]): CommandSignalCard {
  if (repairSummaries.length === 0) {
    return {
      label: '自愈恢复率',
      value: 'clean',
      detail: '当前阶段尚未触发自动修复，系统仍在按主流程推进。',
      tone: 'success',
    };
  }

  const succeeded = repairSummaries.filter((summary) => summary.status === 'succeeded').length;
  const recoveryRate = Math.round((succeeded / repairSummaries.length) * 100);
  const blocked = repairSummaries.filter((summary) => summary.status === 'blocked' || summary.status === 'failed').length;
  const attentionSuffix = blocked > 0 ? `, ${blocked} still need attention` : '';
  let tone: CommandSignalCard['tone'] = 'info';

  if (blocked > 0) {
    tone = 'warning';
  } else if (succeeded === repairSummaries.length) {
    tone = 'success';
  }

  return {
    label: '自愈恢复率',
    value: `${recoveryRate}%`,
    detail: `${succeeded}/${repairSummaries.length} repair attempts succeeded${attentionSuffix}.`,
    tone,
  };
}

function deriveBlockerCard(
  repairSummaries: PlatformRepairObservabilitySummary[],
  publicationSummaries: PlatformPublicationObservabilitySummary[],
  approvals: PlatformObservabilityApprovalItem[],
  stageEvents: PlatformObservabilityTimelineEntry[]
): CommandSignalCard {
  const blockingApproval = approvals.find((approval) => approval.status === 'rejected' || approval.status === 'blocked');
  if (blockingApproval) {
    return {
      label: '当前阻塞点',
      value: blockingApproval.status,
      detail: blockingApproval.reason ?? '审批门控阻止了自治流转。',
      tone: 'error',
    };
  }

  const pendingApproval = approvals.find((approval) => approval.status === 'requested');
  if (pendingApproval) {
    return {
      label: '当前阻塞点',
      value: 'approval gate',
      detail: pendingApproval.reason ?? '当前阶段正在等待人工审批。',
      tone: 'warning',
    };
  }

  const blockedPublication = publicationSummaries.find(
    (summary) => summary.status === 'blocked' || summary.status === 'approval-required'
  );
  if (blockedPublication) {
    return {
      label: '当前阻塞点',
      value: blockedPublication.status,
      detail: blockedPublication.gateReason ?? blockedPublication.prUrl ?? '协作发布闭环被门控暂停。',
      tone: blockedPublication.status === 'blocked' ? 'error' : 'warning',
    };
  }

  const blockedRepair = repairSummaries.find((summary) => summary.status === 'blocked' || summary.status === 'failed');
  if (blockedRepair) {
    return {
      label: '当前阻塞点',
      value: blockedRepair.status,
      detail: blockedRepair.recommendedAction ?? `${blockedRepair.failureClass} repair 未能自动闭环。`,
      tone: 'error',
    };
  }

  const lastErrorEvent = [...stageEvents]
    .reverse()
    .find((entry) => entry.severity === 'error' && isClosureEvent(entry));
  if (lastErrorEvent) {
    return {
      label: '当前阻塞点',
      value: lastErrorEvent.type,
      detail: detailFromPayload(lastErrorEvent) ?? lastErrorEvent.title,
      tone: 'warning',
    };
  }

  return {
    label: '当前阻塞点',
    value: 'none',
    detail: '当前阶段没有显式阻塞信号，自治闭环保持畅通。',
    tone: 'success',
  };
}

function deriveNextActionCard(
  tasks: PlatformTaskRecord[],
  taskSummaries: PlatformTaskObservabilitySummary[],
  repairSummaries: PlatformRepairObservabilitySummary[],
  publicationSummaries: PlatformPublicationObservabilitySummary[],
  approvals: PlatformObservabilityApprovalItem[]
): CommandSignalCard {
  if (approvals.some((approval) => approval.status === 'requested')) {
    return {
      label: '下一自动动作',
      value: 'await approval',
      detail: '等待人工审批完成，审批通过后系统会恢复后续发布与阶段流转。',
      tone: 'warning',
    };
  }

  if (approvals.some((approval) => approval.status === 'blocked' || approval.status === 'rejected')) {
    return {
      label: '下一自动动作',
      value: 'human intervention',
      detail: '审批门控已经卡住当前阶段，系统不会盲目前进。',
      tone: 'error',
    };
  }

  if (repairSummaries.some((summary) => summary.status !== 'succeeded')) {
    return {
      label: '下一自动动作',
      value: 'continue repair loop',
      detail: '系统优先尝试完成自动修复闭环，再决定是否升级到协作发布。',
      tone: 'info',
    };
  }

  if (publicationSummaries.some((summary) => summary.status !== 'published')) {
    return {
      label: '下一自动动作',
      value: 'advance publication',
      detail: '系统正在继续推进协作发布或合并准备。',
      tone: 'info',
    };
  }

  if (taskSummaries.some((summary) => isOpenTaskStatus(summary.status)) || tasks.some((task) => isOpenTaskStatus(task.status))) {
    return {
      label: '下一自动动作',
      value: 'continue stage',
      detail: '当前阶段仍有未完成任务，系统会继续执行本阶段剩余工作。',
      tone: 'info',
    };
  }

  return {
    label: '下一自动动作',
    value: 'promote next stage',
    detail: '当前阶段结果已经闭环，系统将自动推进到下一阶段。',
    tone: 'success',
  };
}

export function deriveCommandSignalCards(
  tasks: PlatformTaskRecord[],
  taskSummaries: PlatformTaskObservabilitySummary[],
  repairSummaries: PlatformRepairObservabilitySummary[],
  publicationSummaries: PlatformPublicationObservabilitySummary[],
  approvals: PlatformObservabilityApprovalItem[],
  stageEvents: PlatformObservabilityTimelineEntry[]
): CommandSignalCard[] {
  return [
    deriveRecoveryCard(repairSummaries),
    deriveBlockerCard(repairSummaries, publicationSummaries, approvals, stageEvents),
    deriveNextActionCard(tasks, taskSummaries, repairSummaries, publicationSummaries, approvals),
  ];
}

export function StageResultPanel(
  props: StageResultPanelProps
): JSX.Element {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(props.artifacts[0]?.artifactId ?? null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewContentType, setPreviewContentType] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const closureTimeline = buildClosureTimeline(
    props.stageEvents,
    props.repairSummaries,
    props.publicationSummaries,
    props.approvals
  );
  const commandCards = deriveCommandSignalCards(
    props.tasks,
    props.taskSummaries,
    props.repairSummaries,
    props.publicationSummaries,
    props.approvals,
    props.stageEvents
  );

  useEffect(() => {
    if (!selectedArtifactId || !props.artifacts.some((artifact) => artifact.artifactId === selectedArtifactId)) {
      setSelectedArtifactId(props.artifacts[0]?.artifactId ?? null);
    }
  }, [props.artifacts, selectedArtifactId]);

  useEffect(() => {
    let cancelled = false;

    async function loadArtifactPreview(): Promise<void> {
      if (!selectedArtifactId) {
        setPreviewContent('');
        setPreviewContentType(null);
        setPreviewError(null);
        return;
      }

      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const preview = await getArtifactContent(selectedArtifactId);
        if (cancelled) {
          return;
        }

        setPreviewContent(truncatePreview(preview.content));
        setPreviewContentType(preview.contentType);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPreviewContent('');
        setPreviewContentType(null);
        setPreviewError(error instanceof Error ? error.message : 'Failed to load artifact preview');
      } finally {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      }
    }

    void loadArtifactPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedArtifactId]);

  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(0,240,255,0.42)' }}>
            Agent 结果
          </p>
          <p className="text-[13px] font-medium mt-1" style={{ color: 'rgba(255,255,255,0.78)' }}>
            {props.stageLabel}
          </p>
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {props.tasks.length} tasks / {props.artifacts.length} artifacts / {props.eventCount} events
        </span>
      </div>

      {props.stageKey === 'requirements-analysis' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-mono mb-1" style={{ color: 'rgba(0,240,255,0.5)' }}>
            共拆分为 {props.tasks.length} 个子任务
          </p>
          {props.tasks.map((task) => (
            <div key={task.taskId} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.78)' }}>{task.title}</p>
              {task.goal ? (
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.42)' }}>{task.goal}</p>
              ) : null}
            </div>
          ))}
          {props.tasks.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>分析结果尚未生成。</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>任务目标</p>
            <div className="flex flex-col gap-2">
              {props.tasks.map((task) => (
                <div key={task.taskId} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>{task.title}</p>
                  <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.36)' }}>{task.goal}</p>
                </div>
              ))}
              {props.tasks.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段暂无任务。</p> : null}
            </div>
          </div>

          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>执行摘要</p>
            <div className="flex flex-col gap-2">
              {props.taskSummaries.map((summary) => (
                <div key={summary.taskId} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>status: {summary.status}</p>
                  <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.36)' }}>
                    attempts {summary.attempts} / artifacts {summary.artifactCount}/{summary.expectedArtifactCount}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.36)' }}>
                    retries {summary.retryCount} / auto repair {summary.autoRepairCount}
                  </p>
                </div>
              ))}
              {props.taskSummaries.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段暂无摘要数据。</p> : null}
            </div>
          </div>

          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>产物结果</p>
            <div className="flex flex-col gap-2">
              {props.artifacts.map((artifact) => (
                <button
                  key={artifact.artifactId}
                  type="button"
                  onClick={() => setSelectedArtifactId(artifact.artifactId)}
                  className="rounded-lg px-3 py-2 text-left transition-all duration-200"
                  style={{
                    background: selectedArtifactId === artifact.artifactId ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.03)',
                    border: selectedArtifactId === artifact.artifactId ? '1px solid rgba(0,240,255,0.18)' : '1px solid transparent',
                  }}
                >
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>{summarizeArtifactLabel(artifact)}</p>
                  <p className="text-[11px] mt-1 break-all" style={{ color: 'rgba(255,255,255,0.36)' }}>{artifact.path}</p>
                </button>
              ))}
              {props.artifacts.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段暂无产物。</p> : null}
            </div>
          </div>
        </div>
      )}

      {selectedArtifactId ? (
        <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'rgba(8,18,31,0.68)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(0,240,255,0.42)' }}>产物预览</p>
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.26)' }}>{previewContentType ?? 'loading'}</span>
          </div>
          {isPreviewLoading ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>加载预览中...</p> : null}
          {previewError ? <p className="text-[11px]" style={{ color: 'rgba(255,120,120,0.8)' }}>{previewError}</p> : null}
          {!isPreviewLoading && !previewError ? <pre className="detail-code-block">{previewContent || '该产物暂无可预览内容。'}</pre> : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(0,240,255,0.42)' }}>自治闭环</p>
            <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.42)' }}>
              自动修复、审批门控、协作发布状态
            </p>
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
            repairs {props.repairSummaries.length} / publications {props.publicationSummaries.length} / approvals {props.approvals.length}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-3 mb-3">
          {commandCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg px-3 py-3"
              style={{
                background: toneSurface(card.tone),
                border: `1px solid ${toneColor(card.tone)}22`,
              }}
            >
              <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>
                {card.label}
              </p>
              <p className="text-[18px] font-medium mt-2" style={{ color: toneColor(card.tone) }}>
                {card.value}
              </p>
              <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>
                {card.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>自动修复</p>
            <div className="flex flex-col gap-2">
              {props.repairSummaries.map((summary) => {
                const tone = statusTone(summary.status);
                return (
                  <div key={summary.repairAttemptId} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                        {summary.failureClass} · #{summary.attemptNumber}
                      </p>
                      <span className="rounded px-2 py-0.5 text-[10px] font-mono" style={{ color: tone.color, background: tone.background }}>
                        {summary.status}
                      </span>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.36)' }}>
                      trigger {summary.triggerTaskId} {'->'} repair {summary.taskId}
                    </p>
                    {summary.recommendedAction ? (
                      <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.44)' }}>
                        {summary.recommendedAction}
                      </p>
                    ) : null}
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
                      {formatTimestamp(summary.latestEventAt)}
                    </p>
                  </div>
                );
              })}
              {props.repairSummaries.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段尚未触发自动修复。</p> : null}
            </div>
          </div>

          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>协作发布</p>
            <div className="flex flex-col gap-2">
              {props.publicationSummaries.map((summary) => {
                const tone = statusTone(summary.status);
                return (
                  <div key={summary.publicationId} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                        {summary.publishMode}
                      </p>
                      <span className="rounded px-2 py-0.5 text-[10px] font-mono" style={{ color: tone.color, background: tone.background }}>
                        {summary.status}
                      </span>
                    </div>
                    {summary.branchName ? <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.36)' }}>branch {summary.branchName}</p> : null}
                    {summary.prUrl ? <p className="text-[11px] mt-1 break-all" style={{ color: 'rgba(0,240,255,0.68)' }}>{summary.prUrl}</p> : null}
                    {summary.gateReason ? <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.44)' }}>{summary.gateReason}</p> : null}
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
                      approval {summary.approvalRequired ? 'required' : 'not-required'} · {formatTimestamp(summary.latestEventAt)}
                    </p>
                  </div>
                );
              })}
              {props.publicationSummaries.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段尚无协作发布记录。</p> : null}
            </div>
          </div>

          <div>
            <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>审批门控</p>
            <div className="flex flex-col gap-2">
              {props.approvals.map((approval, index) => {
                const tone = statusTone(approval.status);
                return (
                  <div key={`${approval.taskId ?? 'publication'}-${approval.createdAt ?? index}`} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                        {approval.taskId ?? approval.publicationId ?? 'publication-gate'}
                      </p>
                      <span className="rounded px-2 py-0.5 text-[10px] font-mono" style={{ color: tone.color, background: tone.background }}>
                        {approval.status}
                      </span>
                    </div>
                    {approval.reason ? <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.44)' }}>{approval.reason}</p> : null}
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
                      {formatTimestamp(approval.createdAt)}
                    </p>
                  </div>
                );
              })}
              {props.approvals.length === 0 ? <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>该阶段当前没有审批门控。</p> : null}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'rgba(8,18,31,0.52)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(0,240,255,0.42)' }}>缺陷闭环时间轴</p>
              <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.42)' }}>
                从缺陷发现到修复、审批、发布恢复的完整路径
              </p>
            </div>
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
              {closureTimeline.length} steps
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {closureTimeline.map((item, index) => (
              <div key={item.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center pt-1">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: toneColor(item.tone), boxShadow: `0 0 10px ${toneColor(item.tone)}` }}
                  />
                  {index < closureTimeline.length - 1 ? (
                    <span className="mt-1 h-10 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  ) : null}
                </div>
                <div className="flex-1 rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.76)' }}>{item.title}</p>
                    <span className="text-[10px] font-mono" style={{ color: toneColor(item.tone) }}>{laneLabel(item.lane)}</span>
                  </div>
                  {item.detail ? (
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.42)' }}>{item.detail}</p>
                  ) : null}
                  <p className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>{formatTimestamp(item.createdAt)}</p>
                </div>
              </div>
            ))}
            {closureTimeline.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
                当前阶段尚未进入缺陷闭环；一旦出现 repair、approval、publication 信号，这里会按时间展开完整路径。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}