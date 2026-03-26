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
      notePrompt: surface === 'review-packet' ? buildDecisionNotePrompt('approve') : undefined,
    },
    {
      kind: 'run',
      label: copy.forcePublishLabel,
      detail: copy.forcePublishDetail,
      tone: 'secondary',
      runAction: 'force-publish',
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
      label: `Resume from ${formatStageLabel(rerouteTargetStage)}`,
      detail: 'Resume the active reroute route directly from the evaluator-selected target stage.',
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
      label: `Reroute to ${formatStageLabel(stageAction.stage)}`,
      detail: `Override the evaluator route and restart repair from ${formatStageLabel(stageAction.stage)}.`,
      tone: 'secondary',
      runAction: stageAction.action,
    });
  }

  actions.push({
    kind: 'run',
    label: 'Cancel Repair Route',
    detail: 'Cancel the active reroute path and clear the queued repair tasks owned by that route.',
    tone: 'ghost',
    runAction: 'cancel-route',
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
        label: 'Retry Blocked Repair',
        detail: 'Push the blocked defect path back into execution from the failing repair task.',
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
        label: 'Retry Blocked Task',
        detail: 'Requeue the blocked task directly from the operator console.',
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
        label: 'Pause Run',
        detail: 'Temporarily stop autonomous progression from this run detail surface.',
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