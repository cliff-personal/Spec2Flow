import { Activity, Network, Cpu, Sparkles, Loader2 } from 'lucide-react';
import type { ProjectListItem } from '../../lib/control-plane-api';

type Props = {
  selectedProject: ProjectListItem | null;
  requirement: string;
  onRequirementChange: (value: string) => void;
  onGenerate: (suggestion?: string) => void;
  isPending: boolean;
  errorMessage: string | null;
  actionMessage: string | null;
};

const SUGGESTIONS = [
  'Expand Orchestration Logic',
  'Scale Agent Pool Architecture',
  'Define Core Protocol Specs',
];

export function ProjectsHeroPanel({
  selectedProject,
  requirement,
  onRequirementChange,
  onGenerate,
  isPending,
  errorMessage,
  actionMessage,
}: Props): JSX.Element {
  return (
    <div className="relative z-10 w-full max-w-4xl flex flex-col items-center">
      {/* Floating tag — top left */}
      <div
        className="absolute -top-24 left-0 border border-primary/10 px-4 py-2 rounded-xl text-[10px] font-label text-primary-container animate-pulse flex items-center gap-2"
        style={{ backdropFilter: 'blur(12px)', background: 'rgba(53, 52, 54, 0.1)' }}
      >
        <Activity className="w-3 h-3" />
        {actionMessage ? actionMessage.toUpperCase() : 'SYSTEM READY: LATENCY 4ms'}
      </div>

      {/* Floating tag — bottom right */}
      <div
        className="absolute -bottom-16 right-10 border border-secondary-container/20 px-4 py-2 rounded-xl text-[10px] font-label text-secondary-fixed flex items-center gap-2 whitespace-nowrap"
        style={{ backdropFilter: 'blur(12px)', background: 'rgba(53, 52, 54, 0.1)' }}
      >
        <Network className="w-3 h-3" />
        ACTIVE CONTEXT: {selectedProject ? selectedProject.projectName.toUpperCase().replace(/\s+/g, '_') : 'SPEC2FLOW_CORE_V2'}
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h1 className="font-headline font-bold text-4xl lg:text-5xl tracking-tight text-on-surface mb-2">
          The Calm before the Storm
        </h1>
        <p className="text-on-surface-variant font-body text-sm tracking-wide opacity-60">
          Initialize your next architectural evolution.
        </p>
      </div>

      {/* Input area */}
      <div className="w-full relative group">
        {/* Active project badge above input */}
        {selectedProject && (
          <div className="absolute -top-10 left-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-t-lg bg-surface-container-low border-t border-x border-surface-container-highest">
              <Cpu className="w-4 h-4 text-[#00F0FF]" />
              <span className="text-[10px] font-headline text-on-surface uppercase tracking-widest">
                Active Project:{' '}
                <span className="text-[#00F0FF]">{selectedProject.projectName}</span>
              </span>
            </div>
          </div>
        )}

        {/* Outer glow */}
        <div className="absolute -inset-1 bg-gradient-to-r from-primary-container/20 to-secondary-container/20 rounded-xl blur-xl transition duration-1000 group-focus-within:duration-200 opacity-50 group-focus-within:opacity-100" />

        <div className="relative flex items-center bg-surface-container-low border-b-2 border-surface-container-highest focus-within:border-primary-container transition-all duration-500 rounded-lg px-8 py-6">
          <input
            type="text"
            value={requirement}
            onChange={(e) => onRequirementChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isPending) { onGenerate(); } }}
            placeholder={selectedProject ? 'What module should I build today?' : 'Select a project first…'}
            disabled={!selectedProject || isPending}
            className="w-full bg-transparent border-none focus:ring-0 text-2xl lg:text-3xl font-headline text-on-surface placeholder:text-on-surface-variant/30 placeholder:font-light outline-none disabled:opacity-40"
          />
          <button
            onClick={() => onGenerate()}
            disabled={!selectedProject || !requirement.trim() || isPending}
            className="bg-primary-container text-on-primary font-headline font-bold text-sm px-6 py-3 rounded-lg hover:scale-105 transition-transform flex items-center gap-2 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ boxShadow: '0 0 15px rgba(0,240,255,0.4)' }}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                RUNNING…
              </>
            ) : (
              <>
                GENERATE
                <Sparkles className="w-4 h-4 fill-current" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error message */}
      {errorMessage && (
        <p className="mt-4 text-xs text-error font-mono opacity-80">{errorMessage}</p>
      )}

      {/* Suggestion chips */}
      <div className="mt-12 flex flex-wrap justify-center gap-4">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onGenerate(suggestion)}
            disabled={!selectedProject || isPending}
            className="px-4 py-2 rounded-full border border-outline-variant/20 bg-surface-container-low text-xs font-label text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
