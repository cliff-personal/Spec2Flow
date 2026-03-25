import { Box, X, Plus } from 'lucide-react';

const globPatterns = ['src/core/**/*', 'libs/shared/ui/**/*.{ts,tsx}'];

export function OverviewRightPanel(): JSX.Element {
  return (
    <div
      className="fixed right-0 top-0 h-full z-50 flex flex-col p-6 w-96 border-l border-[#00F0FF]/15 transition-transform duration-500 bg-[#1C1B1C]/90 backdrop-blur-2xl"
      style={{ boxShadow: '-20px 0px 40px rgba(0,240,255,0.05)' }}
    >
      {/* Header */}
      <div className="mb-8">
        <h2 className="font-headline font-bold text-primary-container flex items-center gap-2">
          <Box className="w-4 h-4" />
          WORKSPACE SANDBOX
        </h2>
        <p className="text-xs text-on-surface-variant/60 font-label mt-1">
          Configure environment constraints &amp; access
        </p>
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto pr-2">
        {/* File Access (Glob Patterns) */}
        <div className="space-y-3">
          <label className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant">
            File Access (Glob Patterns)
          </label>
          <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/10 space-y-2">
            {globPatterns.map((pattern) => (
              <div
                key={pattern}
                className="flex items-center justify-between bg-surface-container-high px-2 py-1.5 rounded border-l-2 border-primary-container"
              >
                <code className="text-[11px] font-mono text-primary">{pattern}</code>
                <X className="w-3 h-3 text-error cursor-pointer flex-shrink-0" />
              </div>
            ))}
            <div className="flex items-center justify-between bg-surface-container-high px-2 py-1.5 rounded border-l-2 border-outline-variant">
              <code className="text-[11px] font-mono text-on-surface-variant/40 italic">
                Add new pattern...
              </code>
              <Plus className="w-3 h-3 text-on-surface-variant/40 flex-shrink-0" />
            </div>
          </div>
        </div>

        {/* Security Policy */}
        <div className="space-y-3">
          <label className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant">
            Security Policy
          </label>
          <div className="space-y-2">
            {/* Toggle: External API — ON */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low border border-outline-variant/10">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-headline text-on-surface">Allow External API calls</span>
                <span className="text-[10px] text-on-surface-variant">Restricted to white-listed domains</span>
              </div>
              <div className="w-8 h-4 bg-primary-container/20 rounded-full relative flex-shrink-0 ml-3">
                <div
                  className="absolute right-0 top-0 h-4 w-4 bg-primary-container rounded-full"
                  style={{ boxShadow: '0 0 8px rgba(0,240,255,0.6)' }}
                />
              </div>
            </div>

            {/* Toggle: Write Access — OFF */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container-low border border-outline-variant/10">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-headline text-on-surface">Write Access to Root</span>
                <span className="text-[10px] text-on-surface-variant">Highly discouraged for agents</span>
              </div>
              <div className="w-8 h-4 bg-surface-container-highest rounded-full relative flex-shrink-0 ml-3">
                <div className="absolute left-0 top-0 h-4 w-4 bg-outline rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Initialization Logs */}
        <div className="space-y-3">
          <label className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant">
            Initialization Logs
          </label>
          <div className="font-mono text-[10px] bg-black/40 p-3 rounded border border-outline-variant/5 text-on-surface-variant/60 leading-relaxed">
            <p>
              <span className="text-secondary">[09:21:04]</span> Connecting to remote kernel...
            </p>
            <p>
              <span className="text-secondary">[09:21:05]</span> Local context mapped successfully.
            </p>
            <p>
              <span className="text-primary-container">[09:21:05]</span> Policy: &quot;developer_default&quot; active.
            </p>
            <p>
              <span className="text-secondary">[09:21:06]</span> Awaiting feature prompt...
            </p>
          </div>
        </div>
      </div>

      {/* Save button */}
      <button className="mt-6 w-full bg-secondary-container text-secondary-fixed py-3 rounded-lg font-headline font-bold text-sm tracking-widest hover:bg-secondary-container/80 transition-all border border-secondary-fixed/20">
        SAVE SANDBOX CONFIG
      </button>
    </div>
  );
}
