import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { PlatformTaskRecord } from './control-plane-api';

const STAGE_ORDER = [
  'environment-preparation',
  'requirements-analysis',
  'code-implementation',
  'test-design',
  'automated-execution',
  'defect-feedback',
  'collaboration'
] as const;

export function buildTaskGraph(tasks: PlatformTaskRecord[]): { nodes: Node[]; edges: Edge[] } {
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