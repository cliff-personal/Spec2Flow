import { startTransition, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from '@xyflow/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRunDetail,
  getRunObservability,
  getRunTasks,
  listRuns,
  postTaskAction,
  submitRun,
  type PlatformTaskRecord,
  type RunSubmissionPayload
} from './lib/control-plane-api';

const STAGE_ORDER = [
  'environment-preparation',
  'requirements-analysis',
  'code-implementation',
  'test-design',
  'automated-execution',
  'defect-feedback',
  'collaboration'
] as const;

function buildGraph(tasks: PlatformTaskRecord[]): { nodes: Node[]; edges: Edge[] } {
  if (tasks.length === 0) {
    return {
      nodes: [],
      edges: []
    };
  }

  const nodes = tasks.map((task, index) => {
    const stageIndex = Math.max(STAGE_ORDER.indexOf(task.stage as (typeof STAGE_ORDER)[number]), 0);
    return {
      id: task.taskId,
      position: {
        x: stageIndex * 280,
        y: (index % 3) * 130
      },
      data: {
        label: `${task.stage} | ${task.title}`
      },
      style: {
        width: 220,
        borderRadius: 18,
        border: '1px solid rgba(13, 27, 42, 0.18)',
        background: '#fffdf8',
        padding: 12,
        boxShadow: '0 14px 28px rgba(13, 27, 42, 0.08)',
        fontSize: 12,
        color: '#102542'
      }
    } satisfies Node;
  });

  const edges = tasks.flatMap((task) =>
    (task.dependsOn ?? []).map((dependencyId) => ({
      id: `${dependencyId}-${task.taskId}`,
      source: dependencyId,
      target: task.taskId,
      markerEnd: {
        type: MarkerType.ArrowClosed
      },
      style: {
        stroke: '#d66853',
        strokeWidth: 1.5
      }
    } satisfies Edge))
  );

  return { nodes, edges };
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'Not started';
  }

  return new Date(value).toLocaleString();
}

function formatStage(value: string | null | undefined): string {
  if (!value) {
    return 'unassigned';
  }

  return value.replaceAll('-', ' ');
}

function parseChangedFiles(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function StatusPill(props: Readonly<{ value: string | null | undefined }>): JSX.Element {
  return <span className={`status-pill status-pill--${props.value ?? 'unknown'}`}>{props.value ?? 'unknown'}</span>;
}

function MetricCard(props: Readonly<{ label: string; value: number | string; hint: string }>): JSX.Element {
  return (
    <article className="metric-card">
      <span className="metric-card__label">{props.label}</span>
      <strong className="metric-card__value">{props.value}</strong>
      <span className="metric-card__hint">{props.hint}</span>
    </article>
  );
}

export function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [submissionState, setSubmissionState] = useState({
    repositoryRootPath: '/Users/cliff/workspace/Synapse-Network',
    requirement: '',
    requirementPath: 'docs/provider_service/api/web3-sentiment-index.md',
    changedFiles: 'docs/provider_service/api/web3-sentiment-index.md'
  });
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 10000
  });

  useEffect(() => {
    if (selectedRunId || !runsQuery.data || runsQuery.data.length === 0) {
      return;
    }

    startTransition(() => {
      setSelectedRunId(runsQuery.data[0]?.runId ?? null);
    });
  }, [runsQuery.data, selectedRunId]);

  const runDetailQuery = useQuery({
    queryKey: ['control-plane', 'run-detail', selectedRunId],
    queryFn: () => getRunDetail(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    retry: false
  });

  const tasksQuery = useQuery({
    queryKey: ['control-plane', 'run-tasks', selectedRunId],
    queryFn: () => getRunTasks(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    retry: false
  });

  const observabilityQuery = useQuery({
    queryKey: ['control-plane', 'run-observability', selectedRunId],
    queryFn: () => getRunObservability(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    retry: false,
    refetchInterval: 10000
  });

  const submissionMutation = useMutation({
    mutationFn: (payload: RunSubmissionPayload) => submitRun(payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] });
      setActionMessage(`Created run ${result.platformRun.runId}`);
      startTransition(() => {
        setSelectedRunId(result.platformRun.runId);
      });
    }
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: { taskId: string; action: 'retry' | 'approve' | 'reject' }) => {
      if (!selectedRunId) {
        throw new Error('Select a run before triggering a task action');
      }

      await postTaskAction(payload.taskId, payload.action, selectedRunId);
    },
    onSuccess: async () => {
      setActionMessage('Task action completed');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-detail', selectedRunId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-tasks', selectedRunId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-observability', selectedRunId] })
      ]);
    }
  });

  const graph = useMemo(() => buildGraph(tasksQuery.data ?? []), [tasksQuery.data]);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div>
          <p className="eyebrow">Spec2Flow</p>
          <h1>Control Plane</h1>
          <p className="sidebar-copy">
            Backend-first operator shell for run submission, progress inspection, and gated task actions.
          </p>
        </div>

        <nav className="nav-list" aria-label="Sections">
          <a href="#submission">Run Submission</a>
          <a href="#runs">Run List</a>
          <a href="#detail">Run Detail</a>
          <a href="#graph">DAG Preview</a>
        </nav>

        <div className="sidebar-note">
          <span className="sidebar-note__label">Backend</span>
          <strong>{import.meta.env.VITE_CONTROL_PLANE_BASE_URL || 'http://127.0.0.1:4310'}</strong>
          <p>Pause or resume stays disabled until the backend exposes a real paused-state model.</p>
        </div>
      </aside>

      <main className="app-shell__content">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Phase 7</p>
            <h2>Operator console scaffold is now live</h2>
            <p>
              This frontend is intentionally thin: it trusts the PostgreSQL-backed control-plane API and does not invent client-side workflow truth.
            </p>
          </div>

          <div className="hero-panel__status-row">
            <div>
              <span className="hero-panel__label">Runs API</span>
              <strong>{runsQuery.isSuccess ? 'connected' : 'waiting'}</strong>
            </div>
            <div>
              <span className="hero-panel__label">Selected Run</span>
              <strong>{selectedRunId ?? 'none'}</strong>
            </div>
            <div>
              <span className="hero-panel__label">Last action</span>
              <strong>{actionMessage ?? 'none'}</strong>
            </div>
          </div>
        </section>

        <section className="grid grid--two" id="submission">
          <article className="panel panel--accent">
            <div className="panel__header">
              <div>
                <p className="eyebrow">POST /api/runs</p>
                <h3>Run Submission</h3>
              </div>
              <span className="panel__hint">Real backend mutation</span>
            </div>

            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                setActionMessage(null);
                submissionMutation.mutate({
                  repositoryRootPath: submissionState.repositoryRootPath,
                  ...(submissionState.requirement.trim() ? { requirement: submissionState.requirement.trim() } : {}),
                  ...(submissionState.requirementPath.trim() ? { requirementPath: submissionState.requirementPath.trim() } : {}),
                  changedFiles: parseChangedFiles(submissionState.changedFiles)
                });
              }}
            >
              <label>
                <span>Repository Root</span>
                <input
                  value={submissionState.repositoryRootPath}
                  onChange={(event) => setSubmissionState((current) => ({
                    ...current,
                    repositoryRootPath: event.target.value
                  }))}
                  placeholder="/Users/cliff/workspace/Synapse-Network"
                />
              </label>

              <label>
                <span>Requirement Path</span>
                <input
                  value={submissionState.requirementPath}
                  onChange={(event) => setSubmissionState((current) => ({
                    ...current,
                    requirementPath: event.target.value
                  }))}
                  placeholder="docs/provider_service/api/web3-sentiment-index.md"
                />
              </label>

              <label className="form-grid__full">
                <span>Requirement Text Override</span>
                <textarea
                  value={submissionState.requirement}
                  onChange={(event) => setSubmissionState((current) => ({
                    ...current,
                    requirement: event.target.value
                  }))}
                  placeholder="Optional inline requirement summary"
                  rows={5}
                />
              </label>

              <label className="form-grid__full">
                <span>Changed Files</span>
                <textarea
                  value={submissionState.changedFiles}
                  onChange={(event) => setSubmissionState((current) => ({
                    ...current,
                    changedFiles: event.target.value
                  }))}
                  placeholder="One path per line"
                  rows={5}
                />
              </label>

              <div className="form-grid__full form-grid__actions">
                <button disabled={submissionMutation.isPending} type="submit">
                  {submissionMutation.isPending ? 'Submitting...' : 'Create Platform Run'}
                </button>
                <p>
                  Uses existing planner and PostgreSQL initialization services, not a parallel web-only intake model.
                </p>
              </div>
              {submissionMutation.isError ? <p className="error-text">{submissionMutation.error.message}</p> : null}
            </form>
          </article>

          <article className="panel" id="runs">
            <div className="panel__header">
              <div>
                <p className="eyebrow">GET /api/runs</p>
                <h3>Runs</h3>
              </div>
              <span className="panel__hint">Auto-refresh every 10s</span>
            </div>

            {runsQuery.isError ? <p className="error-text">{runsQuery.error.message}</p> : null}
            <div className="run-list">
              {(runsQuery.data ?? []).map((run) => (
                <button
                  key={run.runId}
                  className={`run-list__item ${selectedRunId === run.runId ? 'run-list__item--active' : ''}`}
                  onClick={() => setSelectedRunId(run.runId)}
                  type="button"
                >
                  <div>
                    <strong>{run.workflowName}</strong>
                    <span>{run.repositoryName}</span>
                  </div>
                  <div>
                    <StatusPill value={run.status} />
                    <span className="run-list__timestamp">{formatTimestamp(run.updatedAt)}</span>
                  </div>
                </button>
              ))}
              {runsQuery.isSuccess && runsQuery.data?.length === 0 ? <p>No runs yet.</p> : null}
            </div>
          </article>
        </section>

        <section className="grid grid--three" id="detail">
          <article className="panel panel--tall">
            <div className="panel__header">
              <div>
                <p className="eyebrow">GET /api/runs/:runId</p>
                <h3>Run Detail</h3>
              </div>
              <StatusPill value={runDetailQuery.data?.runState.run.status} />
            </div>

            {runDetailQuery.isError ? <p className="error-text">{runDetailQuery.error.message}</p> : null}
            {runDetailQuery.data ? (
              <dl className="detail-list">
                <div>
                  <dt>Run ID</dt>
                  <dd>{runDetailQuery.data.runState.run.runId}</dd>
                </div>
                <div>
                  <dt>Workflow</dt>
                  <dd>{runDetailQuery.data.runState.run.workflowName}</dd>
                </div>
                <div>
                  <dt>Current Stage</dt>
                  <dd>{formatStage(runDetailQuery.data.runState.run.currentStage)}</dd>
                </div>
                <div>
                  <dt>Risk</dt>
                  <dd>{runDetailQuery.data.runState.run.riskLevel ?? 'n/a'}</dd>
                </div>
              </dl>
            ) : (
              <p>Select a run to load detail.</p>
            )}
          </article>

          <article className="panel panel--tall">
            <div className="panel__header">
              <div>
                <p className="eyebrow">GET /api/runs/:runId/observability</p>
                <h3>Observability</h3>
              </div>
              <span className="panel__hint">Read model</span>
            </div>

            {observabilityQuery.data ? (
              <div className="metrics-grid">
                <MetricCard label="Tasks" value={observabilityQuery.data.metrics.tasks.total} hint="Total route tasks" />
                <MetricCard label="Blocked" value={observabilityQuery.data.metrics.tasks.blocked} hint="Need operator attention" />
                <MetricCard label="Publications" value={observabilityQuery.data.metrics.publications.total} hint="Publish outcomes tracked" />
                <MetricCard label="Recent Events" value={observabilityQuery.data.metrics.events.recentCount} hint="Latest event window" />
              </div>
            ) : (
              <p>Observability is available after you select a run.</p>
            )}

            {observabilityQuery.data?.attentionRequired.length ? (
              <div className="attention-list">
                {observabilityQuery.data.attentionRequired.map((item, index) => (
                  <article key={`${item.type}-${index}`} className="attention-item">
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </article>

          <article className="panel panel--tall">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Task Actions</p>
                <h3>Operator Controls</h3>
              </div>
              <span className="panel__hint">retry / approve / reject</span>
            </div>

            <div className="task-actions">
              {(tasksQuery.data ?? []).slice(0, 5).map((task) => (
                <div key={task.taskId} className="task-actions__row">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.stage}</span>
                  </div>
                  <div className="task-actions__buttons">
                    <button disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ taskId: task.taskId, action: 'retry' })} type="button">Retry</button>
                    <button disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ taskId: task.taskId, action: 'approve' })} type="button">Approve</button>
                    <button className="button-ghost" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ taskId: task.taskId, action: 'reject' })} type="button">Reject</button>
                  </div>
                </div>
              ))}
              {actionMutation.isError ? <p className="error-text">{actionMutation.error.message}</p> : null}
            </div>
          </article>
        </section>

        <section className="grid grid--two-large" id="graph">
          <article className="panel panel--tall">
            <div className="panel__header">
              <div>
                <p className="eyebrow">GET /api/runs/:runId/tasks</p>
                <h3>DAG Preview</h3>
              </div>
              <span className="panel__hint">React Flow scaffold</span>
            </div>

            <div className="graph-frame">
              {graph.nodes.length > 0 ? (
                <ReactFlow edges={graph.edges} fitView nodes={graph.nodes} nodesDraggable={false} nodesFocusable={false} zoomOnScroll={false}>
                  <MiniMap />
                  <Controls showInteractive={false} />
                  <Background gap={24} size={1} />
                </ReactFlow>
              ) : (
                <div className="graph-empty-state">
                  <strong>No task graph loaded</strong>
                  <p>Create or select a run to populate the frontend DAG panel.</p>
                </div>
              )}
            </div>
          </article>

          <article className="panel panel--tall">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Task Snapshot</p>
                <h3>Route Tasks</h3>
              </div>
              <span className="panel__hint">Thin shell, backend truth</span>
            </div>

            <div className="task-table">
              {(tasksQuery.data ?? []).map((task) => (
                <div key={task.taskId} className="task-table__row">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.goal}</span>
                  </div>
                  <div>
                    <span>{task.stage}</span>
                    <StatusPill value={task.status} />
                  </div>
                </div>
              ))}
              {tasksQuery.isSuccess && tasksQuery.data?.length === 0 ? <p>No task records yet.</p> : null}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}