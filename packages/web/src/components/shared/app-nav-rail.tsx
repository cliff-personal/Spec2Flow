import { Home, FolderOpen, History, BarChart2, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

type NavItemConfig = {
  icon: React.ReactNode;
  label: string;
  to: string;
  end?: boolean;
};

const navItems: NavItemConfig[] = [
  { icon: <Home className="w-5 h-5" />, label: 'Home', to: '/projects', end: true },
  { icon: <FolderOpen className="w-5 h-5" />, label: 'Projects', to: '/projects' },
  { icon: <History className="w-5 h-5" />, label: 'History', to: '/runs' },
  { icon: <BarChart2 className="w-5 h-5" />, label: 'Health', to: '/health' },
];

export function AppNavRail(): JSX.Element {
  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col items-center py-8 z-50 w-20 border-r border-[#353436]/30 bg-[#131314]/80 backdrop-blur-xl"
      style={{ boxShadow: '0px 0px 20px rgba(0,240,255,0.08)' }}
    >
      {/* Brand */}
      <div className="mb-12">
        <span className="text-[#00F0FF] font-black tracking-widest font-headline text-sm">
          S2F
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-8 flex-1">
        {navItems.map(({ icon, label, to, end }) => (
          <NavLink key={label} to={to} end={end}>
            {({ isActive }) => (
              <button
                className={`flex flex-col items-center gap-1 transition-all duration-300 ${
                  isActive
                    ? 'text-[#00F0FF] scale-110'
                    : 'text-[#E5E2E3]/40 hover:text-[#00F0FF] hover:bg-[#353436]/50 p-2 rounded-lg'
                }`}
                style={isActive ? { filter: 'drop-shadow(0 0 8px rgba(0,240,255,0.8))' } : {}}
              >
                {icon}
                <span className="text-[10px] font-headline">{label}</span>
              </button>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Settings */}
      <div className="mt-auto">
        <NavLink to="/settings">
          {({ isActive }) => (
            <button
              className={`flex flex-col items-center gap-1 transition-all duration-300 ${
                isActive ? 'text-[#00F0FF]' : 'text-[#E5E2E3]/40 hover:text-[#00F0FF]'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-[10px] font-headline uppercase">Settings</span>
            </button>
          )}
        </NavLink>
      </div>
    </aside>
  );
}
