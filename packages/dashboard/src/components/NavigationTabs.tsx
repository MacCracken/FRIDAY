import React, { useState, useCallback, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/chat', label: 'Chat' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/security', label: 'Security' },
  { to: '/personality', label: 'Personality' },
  { to: '/skills', label: 'Skills' },
  { to: '/connections', label: 'Connections' },
  { to: '/security-settings', label: 'Security Config' },
  { to: '/settings', label: 'Settings' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
    isActive
      ? 'border-primary text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-4 py-3 text-sm font-medium transition-colors ${
    isActive
      ? 'text-primary bg-primary/10'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
  }`;

export const NavigationTabs = React.memo(function NavigationTabs() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const toggleMenu = useCallback(() => setMobileOpen((v) => !v), []);

  return (
    <nav className="border-b bg-card">
      <div className="container mx-auto px-3 sm:px-4">
        {/* Desktop nav */}
        <div className="hidden md:flex gap-1 lg:gap-4 overflow-x-auto" role="tablist">
          {NAV_ITEMS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass} role="tab">
              {label}
            </NavLink>
          ))}
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center py-2">
          <button
            onClick={toggleMenu}
            className="btn-ghost p-2"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="text-sm text-muted-foreground ml-2">
            {NAV_ITEMS.find(({ to, end }) =>
              end ? location.pathname === to : location.pathname.startsWith(to)
            )?.label ?? 'Menu'}
          </span>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t divide-y">
          {NAV_ITEMS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={mobileNavLinkClass}>
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
});
