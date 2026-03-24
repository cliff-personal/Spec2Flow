import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import type { PlatformTaskRecord } from '../lib/control-plane-api';
import { buildTaskGraph } from '../lib/task-graph';

export function DagPreviewPanel(props: Readonly<{ tasks: PlatformTaskRecord[] }>): JSX.Element {
  const graph = buildTaskGraph(props.tasks);

  return (
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
  );
}