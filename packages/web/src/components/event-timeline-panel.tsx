import type { PlatformObservabilityTimelineEntry } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';

export function EventTimelinePanel(
  props: Readonly<{
    timeline: PlatformObservabilityTimelineEntry[];
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall panel--timeline">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Event Timeline</p>
          <h3>Cross-run execution story</h3>
        </div>
        <span className="panel__hint">{props.timeline.length} events</span>
      </div>

      {props.timeline.length === 0 ? (
        <p>No timeline entries have been recorded for this run.</p>
      ) : (
        <div className="timeline-list">
          {props.timeline.map((entry) => (
            <article key={entry.eventId} className={`timeline-item timeline-item--${entry.severity}`}>
              <div className="timeline-item__meta">
                <span>{formatTimestamp(entry.createdAt)}</span>
                <span>{entry.category}</span>
                {entry.taskId ? <span>{entry.taskId}</span> : null}
              </div>
              <strong>{entry.title}</strong>
              <p>{entry.type}</p>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}