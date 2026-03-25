import { Bell, Terminal } from 'lucide-react';

export function AppTopbar(): JSX.Element {
  return (
    <header className="fixed top-0 left-20 right-0 flex justify-between items-center px-6 z-40 h-16 bg-[#0E0E0F]/60 backdrop-blur-md">
      {/* Left: Brand + Status */}
      <div className="flex items-center gap-8">
        <span className="text-xl font-bold font-headline uppercase tracking-tighter bg-gradient-to-r from-[#DBFCFF] to-[#00F0FF] bg-clip-text text-transparent">
          Spec2Flow
        </span>

        <nav className="hidden md:flex gap-6">
          <span className="font-headline uppercase tracking-tighter text-xs text-[#00F0FF] border-b border-[#00F0FF] cursor-default pb-0.5">
            Tokens: 1.2M
          </span>
          <span className="font-headline uppercase tracking-tighter text-xs text-[#E5E2E3]/60 hover:bg-[#353436]/20 px-2 py-1 rounded transition-colors cursor-pointer">
            Agents: 42
          </span>
          <span className="font-headline uppercase tracking-tighter text-xs text-[#E5E2E3]/60 hover:bg-[#353436]/20 px-2 py-1 rounded transition-colors cursor-pointer">
            Build: Stable
          </span>
        </nav>
      </div>

      {/* Right: Actions + Avatar */}
      <div className="flex items-center gap-4">
        <div className="flex gap-2">
          <button className="p-2 text-[#E5E2E3]/60 hover:bg-[#353436]/20 rounded transition-all">
            <Bell className="w-5 h-5" />
          </button>
          <button className="p-2 text-[#E5E2E3]/60 hover:bg-[#353436]/20 rounded transition-all">
            <Terminal className="w-5 h-5" />
          </button>
        </div>
        <div className="w-8 h-8 rounded-full border border-[#3B494B]/30 bg-[#2A2A2B] flex items-center justify-center text-[10px] font-headline text-[#00F0FF] uppercase tracking-wider">
          JD
        </div>
      </div>
    </header>
  );
}
