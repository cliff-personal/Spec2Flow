import type { RunListItem } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';
import type { RunActionType } from '../lib/control-plane-ui-types';
import { StatusPill } from './status-pill';

function formatStageLabel(stage: string | null | undefined, fallback: string): string {
  if (!stage) {
    return fallback;
  }

  return stage
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function getRunQueueRerouteLabel(run: RunListItem): string | null {
  if (!run.rerouteTargetStage) {
    return null;
  }

  return `Reroute target: ${formatStageLabel(run.rerouteTargetStage, 'Requested Stage')}`;
}

export function getRunQueueAction(run: RunListItem): { label: string; action: RunActionType } | null {
  if (!run.rerouteTargetStage) {
    return null;
  }

  if (!run.paused && run.status !== 'blocked') {
    return null;
  }

  return {
    label: `Resume from ${formatStageLabel(run.rerouteTargetStage, 'Target Stage')}`,
    action: 'resume-from-target-stage'
  };
}

export function RunsPanel(
  props: Readonly<{
    title?: string;
    eyebrow?: string;
    emptyMessage?: string;
    runs: RunListItem[];
    selectedRunId: string | null;
    onOpenRun: (runId: string) => void;
    onRunAction: (runId: string, action: RunActionType) => void;
    errorMessage: string | null;
    isSuccess: boolean;
    isActionPending: boolean;
  }>
): JSX.Element {
  return (
    <article className="panel" id="runs">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{props.eyebrow ?? 'GET /api/runs'}</p>
          <h3>{props.title ?? 'Runs'}</h3>
        </div>
        <span className="panel__hint">Auto-refresh every 10s</span>
      </div>

      {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      <div className="run-list">
        {props.runs.map((run) => {
          const rerouteLabel = getRunQueueRerouteLabel(run);
          const queueAction = getRunQueueAction(run);

          return (
            <div
              key={run.runId}
              className={`run-list__item ${props.selectedRunId === run.runId ? 'run-list__item--active' : ''}`}
            >
              <button
                className="flex-1 text-left"
                onClick={() => props.onOpenRun(run.runId)}
                type="button"
              >
                <div>
                  <strong>{run.workflowName}</strong>
                  <span>{run.projectName ?? run.repositoryName}</span>
                  <span>{run.branchName ?? run.repositoryRootPath}</span>
                  <span>{formatStageLabel(run.currentStage, 'Stage Pending')}</span>
                  {rerouteLabel ? <span>{rerouteLabel}</span> : null}
                </div>
              </button>
              <div>
                <StatusPill value={run.status} />
                <span className="run-list__timestamp">{formatTimestamp(run.updatedAt)}</span>
                {queueAction ? (
                  <button
                    className="button-ghost"
                    disabled={props.isActionPending}
                    onClick={() => props.onRunAction(run.runId, queueAction.action)}
                    type="button"
                  >
                    {queueAction.label}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {props.isSuccess && props.runs.length === 0 ? <p>{props.emptyMessage ?? 'No runs yet.'}</p> : null}
      </div>
    </article>
  );
}
