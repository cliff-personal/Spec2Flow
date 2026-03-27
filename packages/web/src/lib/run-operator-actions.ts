import type { PlatformObservability, PlatformTaskRecord, RunDetail } from './control-plane-api';
import type { RunActionType, TaskActionType } from './control-plane-ui-types';

export type RunOperatorAction = {
  kind: 'task' | 'run' | 'link';
  label: string;
  detail: string;
  tone: 'primary' | 'secondary' | 'ghost';
  taskId?: string;
  taskAction?: TaskActionType;
  runAction?: RunActionType;
  href?: string;
  external?: boolean;
  notePrompt?: {
    title: string;
    helperText: string;
    placeholder: string;
    initialValue: string;
    confirmLabel: string;
    required: boolean;
  };
};

type ActionNotePrompt = NonNullable<RunOperatorAction['notePrompt']>;

function buildDecisionNoteTemplate(action: 'approve' | 'reject'): string {
  if (action === 'approve') {
    return [
      'Decision: accept-result',
      'Summary:',
      'Validation:',
      'Follow-up owner: none'
    ].join('\n');
  }

  return [
    'Decision: needs-follow-up',
    'Summary:',
    'Requested changes:',
    'Next checkpoint:'
  ].join('\n');
}

function buildDecisionNotePrompt(action: 'approve' | 'reject') {
  if (action === 'approve') {
    return {
      title: 'Capture acceptance note',
      helperText: 'Record why the final handoff is accepted so future operators can audit the sign-off.',
      placeholder: 'Summarize why this delivery is accepted.',
      initialValue: buildDecisionNoteTemplate('approve'),
      confirmLabel: 'Record Acceptance',
      required: false,
    };
  }

  return {
    title: 'Capture follow-up request',
    helperText: 'Explain exactly what still blocks acceptance so the next delivery pass has a concrete target.',
    placeholder: 'List the missing outcome, requested changes, and next checkpoint.',
    initialValue: buildDecisionNoteTemplate('reject'),
    confirmLabel: 'Record Follow-up',
    required: true,
  };
}

function buildRunActionNotePrompt(action: RunActionType): ActionNotePrompt | undefined {
  switch (action) {
    case 'approve-publication':
      return {
        title: 'Record publication approval',
        helperText: 'Capture why this publication exception is being approved so the audit trail explains the release decision.',
        placeholder: 'Summarize why the publication gate is cleared.',
        initialValue: [
          'Decision: approve-publication',
          'Reason:',
          'Risk check:',
          'Follow-up owner: none'
        ].join('\n'),
        confirmLabel: 'Approve Publication',
        required: false,
      };
    case 'force-publish':
      return {
        title: 'Record force-publish rationale',
        helperText: 'Force publish is an operator override. Record the exact reason, risk acceptance, and expected follow-up before continuing.',
        placeholder: 'Explain why the publish gate is being overridden.',
        initialValue: [
          'Decision: force-publish',
          'Reason:',
          'Accepted risk:',
          'Follow-up owner:'
        ].join('\n'),
        confirmLabel: 'Force Publish',
        required: true,
      };
    case 'reroute-to-requirements-analysis':
    case 'reroute-to-code-implementation':
    case 'reroute-to-test-design':
    case 'reroute-to-automated-execution':
      return {
        title: 'Record reroute override',
        helperText: 'Explain why the evaluator-selected repair route is being overridden and what evidence supports the new target stage.',
        placeholder: 'Summarize the evidence behind this reroute override.',
        initialValue: [
          `Decision: ${action}`,
          'Reason:',
          'Evidence:',
          'Expected recovery path:'
        ].join('\n'),
        confirmLabel: 'Apply Reroute',
        required: true,
      };
    case 'cancel-route':
      return {
        title: 'Record route cancellation',
        helperText: 'Cancelling a repair route is an exception-handling decision. Record why the route is being dropped and what happens next.',
        placeholder: 'Explain why the active repair route is being cancelled.',
        initialValue: [
          'Decision: cancel-route',
          'Reason:',
          'Next control-plane action:',
          'Follow-up owner:'
        ].join('\n'),
        confirmLabel: 'Cancel Route',
        required: true,
      };
    default:
      return undefined;
  }
}

function countMissingArtifacts(observability: PlatformObservability | undefined): number {
  return observability?.taskSummaries.reduce(
    (sum, summary) => sum + summary.missingExpectedArtifactCount,
    0
  ) ?? 0;
}

function firstBlockedTask(tasks: PlatformTaskRecord[]): PlatformTaskRecord | undefined {
  return tasks.find((task) => task.status === 'blocked');
}

function approvalActionCopy(surface: 'run-detail' | 'review-packet'): {
  approveLabel: string;
  approveDetail: string;
  forcePublishLabel: string;
  forcePublishDetail: string;
  rejectLabel: string;
  rejectDetail: string;
} {
  if (surface === 'review-packet') {
    return {
      approveLabel: 'Accept Result',
      approveDetail: 'Record the final review decision as accepted and clear the handoff for completion.',
      forcePublishLabel: 'Force Publish',
      forcePublishDetail: 'Override the approval gate and publish the latest delivery package immediately.',
      rejectLabel: 'Needs Follow-up',
      rejectDetail: 'Record that the handoff needs follow-up work before it can be accepted.',
    };
  }

  return {
    approveLabel: 'Approve Publication',
    approveDetail: 'Clear the pending publication gate and let the collaboration stage continue.',
    forcePublishLabel: 'Force Publish',
    forcePublishDetail: 'Bypass the approval gate and publish the latest delivery package immediately.',
    rejectLabel: 'Reject Publication',
    rejectDetail: 'Stop the current handoff and send the publication request back for revision.',
  };
}

function formatStageLabel(stage: string): string {
  return stage.split('-').map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(' ');
}

function buildPublicationActions(
  surface: 'run-detail' | 'review-packet',
  pendingApprovalTaskId: string
): RunOperatorAction[] {
  const copy = approvalActionCopy(surface);

  return [
    {
      kind: 'run',
      label: copy.approveLabel,
      detail: copy.approveDetail,
      tone: 'primary',
      runAction: 'approve-publication',
      notePrompt: surface === 'review-packet'
        ? buildDecisionNotePrompt('approve')
        : buildRunActionNotePrompt('approve-publication'),
    },
    {
      kind: 'run',
      label: copy.forcePublishLabel,
      detail: copy.forcePublishDetail,
      tone: 'secondary',
      runAction: 'force-publish',
      notePrompt: buildRunActionNotePrompt('force-publish'),
    },
    {
      kind: 'task',
      label: copy.rejectLabel,
      detail: copy.rejectDetail,
      tone: 'secondary',
      taskId: pendingApprovalTaskId,
      taskAction: 'reject',
      notePrompt: surface === 'review-packet' ? buildDecisionNotePrompt('reject') : undefined,
    },
  ];
}

function buildRerouteActions(runDetail: RunDetail, rerouteTargetStage: NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>): RunOperatorAction[] {
  const actions: RunOperatorAction[] = [];

  if (runDetail.runState.run.status === 'blocked' || runDetail.runState.run.status === 'running') {
    actions.push({
      kind: 'run',
      label: `从 ${formatStageLabel(rerouteTargetStage)} 继续`,
      detail: '从评估器指定的目标阶段继续当前修复路径。',
      tone: 'primary',
      runAction: 'resume-from-target-stage',
    });
  }

  const stageActions: Array<{ stage: NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>; action: RunActionType }> = [
    { stage: 'requirements-analysis', action: 'reroute-to-requirements-analysis' },
    { stage: 'code-implementation', action: 'reroute-to-code-implementation' },
    { stage: 'test-design', action: 'reroute-to-test-design' },
    { stage: 'automated-execution', action: 'reroute-to-automated-execution' },
  ];

  for (const stageAction of stageActions) {
    if (stageAction.stage === rerouteTargetStage) {
      continue;
    }

    actions.push({
      kind: 'run',
      label: `改道到 ${formatStageLabel(stageAction.stage)}`,
      detail: `覆盖评估器的修复路径，并从 ${formatStageLabel(stageAction.stage)} 重新开始修复。`,
      tone: 'secondary',
      runAction: stageAction.action,
      notePrompt: buildRunActionNotePrompt(stageAction.action),
    });
  }

  actions.push({
    kind: 'run',
    label: '取消修复路径',
    detail: '取消当前改道路径，并清除该路径下排队中的修复任务。',
    tone: 'ghost',
    runAction: 'cancel-route',
    notePrompt: buildRunActionNotePrompt('cancel-route'),
  });

  return actions;
}

export function deriveRunOperatorActions(
  runDetail: RunDetail | undefined,
  observability: PlatformObservability | undefined,
  tasks: PlatformTaskRecord[],
  options: {
    surface?: 'run-detail' | 'review-packet';
  } = {}
): RunOperatorAction[] {
  if (!runDetail) {
    return [];
  }

  const runId = runDetail.runState.run.runId;
  const surface = options.surface ?? 'run-detail';
  const pendingApproval = observability?.approvals.find(
    (approval) => approval.status === 'requested' && typeof approval.taskId === 'string' && approval.taskId.length > 0
  );
  if (pendingApproval?.taskId) {
    return buildPublicationActions(surface, pendingApproval.taskId);
  }

  const evaluatorRepairRoute = [...tasks]
    .filter((task) => task.stage === 'evaluation' && task.evaluationDecision === 'needs-repair' && task.requestedRepairTargetStage)
    .sort((left, right) => new Date(right.updatedAt ?? 0).valueOf() - new Date(left.updatedAt ?? 0).valueOf())[0];
  if (evaluatorRepairRoute?.requestedRepairTargetStage) {
    return buildRerouteActions(runDetail, evaluatorRepairRoute.requestedRepairTargetStage);
  }

  const blockedRepair = observability?.repairSummaries.find(
    (summary) => (summary.status === 'blocked' || summary.status === 'failed') && summary.taskId.length > 0
  );
  if (blockedRepair?.taskId) {
    return [
      {
        kind: 'task',
        label: '重试阻塞修复',
        detail: '从失败的修复任务重新推进当前缺陷修复路径。',
        tone: 'primary',
        taskId: blockedRepair.taskId,
        taskAction: 'retry',
      },
    ];
  }

  const blockedTask = firstBlockedTask(tasks);
  if (blockedTask) {
    return [
      {
        kind: 'task',
        label: '重试阻塞任务',
        detail: '直接从操作台将阻塞任务重新排队执行。',
        tone: 'primary',
        taskId: blockedTask.taskId,
        taskAction: 'retry',
      },
    ];
  }

  if (countMissingArtifacts(observability) > 0) {
    return [
      {
        kind: 'link',
        label: 'Inspect Evidence Gaps',
        detail: 'Open the evidence band and review which expected artifacts are still missing.',
        tone: 'primary',
        href: '#evidence',
      },
    ];
  }

  if (runDetail.runState.run.status === 'completed') {
    return [
      {
        kind: 'link',
        label: surface === 'review-packet' ? 'Open Delivery Evidence' : 'Open Review Packet',
        detail: 'Move into the final human handoff surface with branch and evidence links.',
        tone: 'primary',
        href: surface === 'review-packet' ? '#evidence' : `/runs/${runId}/review`,
      },
    ];
  }

  if (runDetail.runState.run.status === 'running') {
    return [
      {
        kind: 'run',
        label: '停止',
        detail: '从当前运行详情页停止本次自动推进。',
        tone: 'secondary',
        runAction: 'pause',
      },
    ];
  }

  return [
    {
      kind: 'link',
      label: 'Open Run Timeline',
      detail: 'Stay on the run and inspect the latest stage, event, and task evidence.',
      tone: 'ghost',
      href: '#detail',
    },
  ];
}