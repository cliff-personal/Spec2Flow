import { Activity, Network, Sparkles } from 'lucide-react';

const SUGGESTIONS = [
  'Initialize Auth Microservice',
  'Refactor Database Middleware',
  'Implement WebSocket Telemetry',
] as const;

export function OverviewHeroPanel(): JSX.Element {
  return (
    <div className="relative z-10 w-full max-w-4xl flex flex-col items-center">
      {/* Floating tag — top left */}
      <div
        className="absolute -top-24 left-0 border border-primary/10 px-4 py-2 rounded-xl text-[10px] font-label text-primary-container animate-pulse flex items-center gap-2"
        style={{ backdropFilter: 'blur(12px)', background: 'rgba(53, 52, 54, 0.1)' }}
      >
        <Activity className="w-3 h-3" />
        SYSTEM READY: LATENCY 4ms
      </div>

      {/* Floating tag — bottom right */}
      <div
        className="absolute -bottom-16 right-10 border border-secondary-container/20 px-4 py-2 rounded-xl text-[10px] font-label text-secondary-fixed flex items-center gap-2"
        style={{ backdropFilter: 'blur(12px)', background: 'rgba(53, 52, 54, 0.1)' }}
      >
        <Network className="w-3 h-3" />
        ACTIVE CONTEXT: RUST_BE_CORE
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

      {/* Glowing input area */}
      <div className="w-full relative group">
        {/* Outer glow layer */}
        <div className="absolute -inset-1 bg-gradient-to-r from-primary-container/20 to-secondary-container/20 rounded-xl blur-xl transition duration-1000 group-focus-within:duration-200 opacity-50 group-focus-within:opacity-100" />

        <div className="relative flex items-center bg-surface-container-low border-b-2 border-surface-container-highest focus-within:border-primary-container transition-all duration-500 rounded-lg px-8 py-6">
          <input
            type="text"
            placeholder="What feature should I build today?"
            className="w-full bg-transparent border-none focus:ring-0 text-2xl lg:text-3xl font-headline text-on-surface placeholder:text-on-surface-variant/30 placeholder:font-light outline-none"
          />
          <button
            className="bg-primary-container text-on-primary font-headline font-bold text-sm px-6 py-3 rounded-lg hover:scale-105 transition-transform flex items-center gap-2 whitespace-nowrap flex-shrink-0"
            style={{ boxShadow: '0 0 15px rgba(0,240,255,0.4)' }}
          >
            GENERATE
            <Sparkles className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {/* Suggestion chips */}
      <div className="mt-12 flex flex-wrap justify-center gap-4">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            className="px-4 py-2 rounded-full border border-outline-variant/20 bg-surface-container-low text-xs font-label text-on-surface-variant hover:border-primary-container/40 hover:text-primary-container transition-all"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
