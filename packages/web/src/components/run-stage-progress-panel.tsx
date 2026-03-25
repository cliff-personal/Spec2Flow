import type { PlatformTaskRecord } from '../lib/control-plane-api';
import { formatStage } from '../lib/control-plane-formatters';
import { StatusPill } from './status-pill';

const STAGES = [
  'requirements-analysis',
  'code-implementation',
  'test-design',
  'automated-execution',
  'defect-feedback',
  'collaboration'
] as const;

function deriveStageStatus(tasks: PlatformTaskRecord[], stage: string): string {
  const stageTasks = tasks.filter((task) => task.stage === stage);
  if (stageTasks.length === 0) {
    return 'pending';
  }

  if (stageTasks.some((task) => task.status === 'blocked' || task.status === 'failed')) {
    return 'blocked';
  }

  if (stageTasks.every((task) => task.status === 'completed')) {
    return 'completed';
  }

  if (stageTasks.some((task) => ['in-progress', 'leased', 'running'].includes(task.status))) {
    return 'running';
  }

  if (stageTasks.some((task) => task.status === 'ready')) {
    return 'ready';
  }

  return stageTasks[0]?.status ?? 'pending';
}

export function RunStageProgressPanel(props: Readonly<{ tasks: PlatformTaskRecord[] }>): JSX.Element {
  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Stage Progress</p>
          <h3>Six-stage delivery strip</h3>
        </div>
        <span className="panel__hint">{props.tasks.length} tasks</span>
      </div>

      <div className="stage-strip">
        {STAGES.map((stage) => {
          const stageTasks = props.tasks.filter((task) => task.stage === stage);
          const stageStatus = deriveStageStatus(props.tasks, stage);
          const activeCount = stageTasks.filter((task) => ['ready', 'leased', 'in-progress', 'running'].includes(task.status)).length;

          return (
            <div key={stage} className={`stage-strip__item stage-strip__item--${stageStatus}`}>
              <span className="stage-strip__label">{formatStage(stage)}</span>
              <StatusPill value={stageStatus} />
              <strong>{stageTasks.length}</strong>
              <span className="stage-strip__hint">{activeCount > 0 ? `${activeCount} active` : 'tasks'}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
