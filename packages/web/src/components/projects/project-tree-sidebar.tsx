import { useState, useRef } from 'react';
import { Plus, SquarePen, ChevronDown, ChevronRight, FolderOpen, SlidersHorizontal, Circle } from 'lucide-react';
import type { ProjectListItem, RunListItem, PlatformRunStatus } from '../../lib/control-plane-api';

type Props = {
  projects: ProjectListItem[];
  runs: RunListItem[];
  selectedProjectId: string | null;
  selectedRunId?: string | null;
  onSelectProject: (id: string) => void;
  onRegisterProject: (path: string) => void;
  onOpenRun?: (run: RunListItem) => void;
  onNewRequirement?: (projectId: string) => void;
  isRegistering?: boolean;
};

function runStatusColor(status: PlatformRunStatus, paused: boolean): string {
  if (paused) return 'rgba(255,200,120,0.7)';
  if (status === 'running') return 'rgba(0,240,255,0.7)';
  if (status === 'completed') return 'rgba(74,222,128,0.6)';
  if (status === 'failed' || status === 'blocked') return 'rgba(248,113,113,0.6)';
  return 'rgba(255,255,255,0.2)';
}

function RunSubItem({
  run,
  isSelected,
  onOpenRun,
}: Readonly<{
  run: RunListItem;
  isSelected: boolean;
  onOpenRun?: (run: RunListItem) => void;
}>): JSX.Element {
  const raw = run.requirement?.trim() || run.workflowName || run.runId.slice(0, 8);
  const label = raw.length > 32 ? `${raw.slice(0, 32)}...` : raw;
  const color = runStatusColor(run.status, run.paused);

  return (
    <button
      onClick={() => onOpenRun?.(run)}
      className="w-full flex items-center gap-2 pl-9 pr-4 py-1.5 transition-colors duration-150 group"
      style={{
        background: isSelected ? 'rgba(0,240,255,0.06)' : 'transparent',
        borderLeft: isSelected ? '2px solid rgba(0,240,255,0.4)' : '2px solid transparent',
      }}
    >
      <Circle className="w-1.5 h-1.5 flex-shrink-0" style={{ color, fill: color }} />
      <span
        className="flex-1 text-left text-[11px] truncate transition-colors"
        style={{ color: isSelected ? 'rgba(0,240,255,0.8)' : 'rgba(255,255,255,0.3)' }}
      >
        {label}
      </span>
    </button>
  );
}

function ProjectRunList({
  projectId,
  runs,
  selectedRunId,
  onOpenRun,
}: Readonly<{
  projectId: string;
  runs: RunListItem[];
  selectedRunId?: string | null;
  onOpenRun?: (run: RunListItem) => void;
}>): JSX.Element | null {
  const projectRuns = runs.filter((r) => r.projectId === projectId).slice(0, 8);
  if (projectRuns.length === 0) return null;
  return (
    <div className="pb-1">
      {projectRuns.map((run) => (
        <RunSubItem key={run.runId} run={run} isSelected={run.runId === selectedRunId} onOpenRun={onOpenRun} />
      ))}
    </div>
  );
}

export function ProjectTreeSidebar({ projects, runs, selectedProjectId, selectedRunId, onSelectProject, onRegisterProject, onOpenRun, onNewRequirement, isRegistering }: Readonly<Props>): JSX.Element {
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackPath, setFallbackPath] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAddClick() {
    const picker = (globalThis as unknown as Record<string, unknown>)?.showDirectoryPicker as ((opts?: unknown) => Promise<{ name: string }>) | undefined;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({ mode: 'read' });
        onRegisterProject(handle.name);
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
      }
    }
    setFallbackPath('');
    setFallbackOpen(true);
  }

  function submitFallback() {
    const path = fallbackPath.trim();
    if (!path) return;
    onRegisterProject(path);
    setFallbackOpen(false);
    setFallbackPath('');
  }

  return (
    <aside
      className="fixed left-20 top-16 h-[calc(100vh-4rem)] w-64 z-30 flex flex-col border-r border-white/5"
      style={{ backdropFilter: 'blur(16px)', background: 'rgba(10,12,18,0.72)' }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-widest uppercase text-white/30 font-medium">
            Project Registry
          </span>
          <div className="flex items-center gap-1.5">
            <button className="text-white/20 hover:text-white/50 transition-colors" title="Filter">
              <SlidersHorizontal className="w-3 h-3" />
            </button>
            <button
              onClick={handleAddClick}
              disabled={isRegistering}
              className="text-white/20 hover:text-white/50 transition-colors disabled:opacity-30"
              title="Register project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-white/40 font-normal">All active streams</p>
      </div>

      {/* Fallback path input */}
      {fallbackOpen && (
        <div className="mx-3 mb-2 p-2.5 rounded border border-white/10 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <FolderOpen className="w-3 h-3 text-white/30 flex-shrink-0" />
            <span className="text-[9px] tracking-widest uppercase text-white/30">Path</span>
          </div>
          <input
            autoFocus
            type="text"
            value={fallbackPath}
            onChange={(e) => setFallbackPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFallback();
              if (e.key === 'Escape') { setFallbackOpen(false); setFallbackPath(''); }
            }}
            onBlur={submitFallback}
            placeholder="/Users/you/project"
            className="w-full text-[11px] bg-transparent border-b border-white/10 py-0.5 text-white/60 focus:outline-none focus:border-white/30 placeholder:text-white/15 font-mono"
          />
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" />

      {/* Divider */}
      <div className="h-px bg-white/5 flex-shrink-0 mx-0" />

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="px-4 py-5 text-[11px] text-white/20 italic">
            No projects registered. Click + to add.
          </div>
        ) : (
          <div>
            {projects.map((project) => {
              const isActive = project.projectId === selectedProjectId;
              const isHovered = hoveredId === project.projectId;
              let rowBg = 'transparent';
              if (isActive) rowBg = 'rgba(255,255,255,0.05)';
              else if (isHovered) rowBg = 'rgba(255,255,255,0.03)';

              return (
                <div key={project.projectId}>
                  <div
                    className="relative flex items-center group"
                    onMouseEnter={() => setHoveredId(project.projectId)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      background: rowBg,
                      borderLeft: isActive ? '2px solid rgba(0,240,255,0.5)' : '2px solid transparent',
                    }}
                  >
                    <button
                      onClick={() => onSelectProject(project.projectId)}
                      className="flex-1 flex items-center gap-2 px-4 py-2 transition-colors duration-150 min-w-0"
                    >
                      {isActive ? (
                        <ChevronDown className="w-3 h-3 flex-shrink-0 text-white/30" />
                      ) : (
                        <ChevronRight className="w-3 h-3 flex-shrink-0 text-white/15" />
                      )}
                      <span
                        className="flex-1 text-left text-[12px] truncate"
                        style={{ color: isActive ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)' }}
                      >
                        {project.projectName}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onNewRequirement?.(project.projectId); }}
                      className="flex-shrink-0 mr-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded p-0.5 hover:bg-white/10"
                      title="新建需求"
                      style={{ color: 'rgba(255,255,255,0.35)' }}
                    >
                      <SquarePen className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Run sub-items */}
                  {isActive && (
                    <ProjectRunList
                      projectId={project.projectId}
                      runs={runs}
                      selectedRunId={selectedRunId}
                      onOpenRun={onOpenRun}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="h-px bg-white/5 flex-shrink-0" />
      <div className="px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse flex-shrink-0" />
        <span className="text-[10px] text-white/20 tracking-wide">Live</span>
      </div>
    </aside>
  );
}
