import { Plus, ChevronDown, ChevronRight, Cpu, BarChart2, ShieldCheck, Archive, Layers } from 'lucide-react';
import type { ProjectListItem } from '../../lib/control-plane-api';

type Props = {
  projects: ProjectListItem[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
};

const PROJECT_ICONS = [Cpu, BarChart2, ShieldCheck, Archive, Layers];

function getIcon(index: number) {
  const Icon = PROJECT_ICONS[index % PROJECT_ICONS.length];
  return Icon;
}

const ICON_COLORS = [
  'text-[#00F0FF]',
  'text-secondary',
  'text-primary-container',
  'text-on-surface/30',
  'text-primary-container',
];

export function ProjectTreeSidebar({ projects, selectedProjectId, onSelectProject, onAddProject }: Props): JSX.Element {
  return (
    <aside
      className="fixed left-20 top-16 h-[calc(100vh-4rem)] w-64 z-30 flex flex-col border-r border-[#353436]/30"
      style={{ backdropFilter: 'blur(12px)', background: 'rgba(53, 52, 54, 0.1)' }}
    >
      {/* Header */}
      <div
        className="p-4 border-b border-[#353436]/30 flex-shrink-0"
        style={{ background: 'rgba(14,14,15,0.2)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-headline text-[#00F0FF] tracking-widest uppercase">
            Project Registry
          </span>
          <button
            onClick={onAddProject}
            className="text-[#00F0FF]/60 hover:text-[#00F0FF] transition-colors"
            title="Register project"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs font-headline text-on-surface">
          <Layers className="w-4 h-4 text-secondary" />
          <span className="truncate">All active streams</span>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2 px-1">
        {projects.length === 0 ? (
          <div className="px-3 py-4 text-[10px] font-label text-on-surface-variant/40 italic">
            No projects registered. Click + to add.
          </div>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project, index) => {
              const isActive = project.projectId === selectedProjectId;
              const Icon = getIcon(index);
              const iconColor = ICON_COLORS[index % ICON_COLORS.length];
              const isArchived = index === projects.length - 1 && projects.length > 3;

              return (
                <div key={project.projectId}>
                  <button
                    onClick={() => onSelectProject(project.projectId)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-all duration-300 ${
                      isArchived
                        ? 'text-on-surface/30'
                        : isActive
                          ? 'text-[#00F0FF]'
                          : 'text-on-surface/70 hover:text-[#00F0FF]'
                    }`}
                    style={
                      isActive
                        ? { background: 'rgba(0,240,255,0.1)', boxShadow: 'inset 3px 0 0 0 #00F0FF' }
                        : undefined
                    }
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'rgba(0,240,255,0.05)';
                        e.currentTarget.style.boxShadow = 'inset 2px 0 0 0 #00F0FF';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.boxShadow = '';
                      }
                    }}
                  >
                    {isActive ? (
                      <ChevronDown className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    )}
                    <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
                    <span className="font-headline font-bold uppercase tracking-tight truncate">
                      {project.projectName}
                    </span>
                  </button>

                  {/* Expanded sub-items for active project */}
                  {isActive && (
                    <div className="ml-6 space-y-0.5 mb-2">
                      <button
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#00F0FF]/80 transition-all"
                        style={{ fontFamily: 'Inter, sans-serif' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,240,255,0.05)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                      >
                        <Layers className="w-4 h-4 opacity-60" />
                        <span>Flow Orchestrator</span>
                      </button>
                      <button
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-on-surface/60 hover:text-[#00F0FF] transition-all"
                        style={{ fontFamily: 'Inter, sans-serif' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,240,255,0.05)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                      >
                        <Cpu className="w-4 h-4 opacity-40" />
                        <span>Autonomous Agents</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer sync status */}
      <div
        className="p-3 border-t border-[#353436]/30 flex-shrink-0"
        style={{ background: 'rgba(14,14,15,0.4)' }}
      >
        <div className="flex items-center gap-2 text-[10px] font-label text-on-surface-variant">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span>SYNCED: 12ms AGO</span>
        </div>
      </div>
    </aside>
  );
}
