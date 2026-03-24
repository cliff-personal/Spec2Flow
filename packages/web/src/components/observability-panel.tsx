import type { PlatformObservability } from '../lib/control-plane-api';
import { MetricCard } from './metric-card';

export function ObservabilityPanel(
  props: Readonly<{
    observability: PlatformObservability | undefined;
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">GET /api/runs/:runId/observability</p>
          <h3>Observability</h3>
        </div>
        <span className="panel__hint">Read model</span>
      </div>

      {props.observability ? (
        <div className="metrics-grid">
          <MetricCard label="Tasks" value={props.observability.metrics.tasks.total} hint="Total route tasks" />
          <MetricCard label="Blocked" value={props.observability.metrics.tasks.blocked} hint="Need operator attention" />
          <MetricCard label="Publications" value={props.observability.metrics.publications.total} hint="Publish outcomes tracked" />
          <MetricCard label="Recent Events" value={props.observability.metrics.events.recentCount} hint="Latest event window" />
        </div>
      ) : (
        <p>Observability is available after you select a run.</p>
      )}

      {props.observability?.attentionRequired.length ? (
        <div className="attention-list">
          {props.observability.attentionRequired.map((item, index) => (
            <article key={`${item.type}-${index}`} className="attention-item">
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      ) : null}
    </article>
  );
}