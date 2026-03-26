import type { PlatformObservabilityTimelineEntry } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function EventTimelinePanel(
  props: Readonly<{
    timeline: PlatformObservabilityTimelineEntry[];
  }>
): JSX.Element {
  const chronologicalTimeline = [...props.timeline].sort(
    (left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt)
  );

  return (
    <article className="panel panel--tall panel--timeline">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Event Timeline</p>
          <h3>Cross-run execution story</h3>
        </div>
        <span className="panel__hint">{props.timeline.length} events</span>
      </div>

      {chronologicalTimeline.length === 0 ? (
        <p>No timeline entries have been recorded for this run.</p>
      ) : (
        <div className="timeline-list">
          {chronologicalTimeline.map((entry) => (
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