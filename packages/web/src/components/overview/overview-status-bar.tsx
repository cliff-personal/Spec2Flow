import { HardDrive, Globe } from 'lucide-react';

export function OverviewStatusBar(): JSX.Element {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-3 border border-outline-variant/10 rounded-full z-40 backdrop-blur-xl"
      style={{ background: 'rgba(53, 52, 54, 0.4)' }}
    >
      {/* Environment */}
      <div className="flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full bg-primary-container"
          style={{ boxShadow: '0 0 5px rgba(0,240,255,1)' }}
        />
        <span className="text-[10px] font-headline text-on-surface uppercase tracking-widest">
          Environment: Dev_Sandbox_01
        </span>
      </div>

      <div className="h-4 w-px bg-outline-variant/20" />

      {/* Disk */}
      <div className="flex items-center gap-2">
        <HardDrive className="w-3 h-3 text-secondary" />
        <span className="text-[10px] font-headline text-on-surface uppercase tracking-widest">
          Disk: 4.2GB / 10GB
        </span>
      </div>

      <div className="h-4 w-px bg-outline-variant/20" />

      {/* Region */}
      <div className="flex items-center gap-2">
        <Globe className="w-3 h-3 text-primary-container" />
        <span className="text-[10px] font-headline text-on-surface uppercase tracking-widest">
          Region: AWS-USE-1
        </span>
      </div>
    </div>
  );
}
