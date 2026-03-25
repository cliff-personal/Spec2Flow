import { OverviewHeroPanel } from '../components/overview/overview-hero-panel';
import { OverviewRightPanel } from '../components/overview/overview-right-panel';
import { OverviewSidebar } from '../components/overview/overview-sidebar';
import { OverviewStatusBar } from '../components/overview/overview-status-bar';
import { OverviewTopbar } from '../components/overview/overview-topbar';

export function OverviewPage(): JSX.Element {
  return (
    <div
      className="font-body text-on-surface overflow-hidden"
      style={{
        minHeight: '100vh',
        backgroundColor: '#0E0E0F',
        backgroundImage: [
          'radial-gradient(circle at 50% 50%, rgba(0, 240, 255, 0.03) 0%, transparent 50%)',
          'linear-gradient(to right, rgba(53, 52, 54, 0.1) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(53, 52, 54, 0.1) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '100% 100%, 40px 40px, 40px 40px',
      }}
    >
      <OverviewSidebar />
      <OverviewTopbar />

      {/* Main content area — offset for sidebar (w-20=80px) and topbar (h-16=64px) */}
      <main className="ml-20 mt-16 h-[calc(100vh-4rem)] relative flex items-center justify-center p-12 overflow-hidden">
        <OverviewHeroPanel />
      </main>

      <OverviewRightPanel />
      <OverviewStatusBar />
    </div>
  );
}
