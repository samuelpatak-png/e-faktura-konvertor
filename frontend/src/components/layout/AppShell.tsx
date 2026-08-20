import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-canvas hover:text-ink-900"
  }`;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <NavLink to="/app" className="flex items-center gap-2 font-semibold text-ink-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                eF
              </span>
              <span className="hidden sm:inline">e-Faktúra Konvertor</span>
            </NavLink>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Hlavná navigácia">
              <NavLink to="/app/new" className={NAV_LINK_CLASS} end>
                Nová faktúra
              </NavLink>
              <NavLink to="/app/invoices" className={NAV_LINK_CLASS}>
                História
              </NavLink>
              <NavLink to="/app/partners" className={NAV_LINK_CLASS}>
                Odberatelia
              </NavLink>
              <NavLink to="/app/price-list" className={NAV_LINK_CLASS}>
                Cenník
              </NavLink>
              <NavLink to="/app/received-invoices" className={NAV_LINK_CLASS}>
                Prijaté
              </NavLink>
              <NavLink to="/app/settings" className={NAV_LINK_CLASS}>
                Nastavenia
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-500 sm:inline">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-canvas hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Odhlásiť sa
            </button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden" aria-label="Hlavná navigácia (mobil)">
          <NavLink to="/app/new" className={NAV_LINK_CLASS} end>
            Nová faktúra
          </NavLink>
          <NavLink to="/app/invoices" className={NAV_LINK_CLASS}>
            História
          </NavLink>
          <NavLink to="/app/partners" className={NAV_LINK_CLASS}>
            Odberatelia
          </NavLink>
          <NavLink to="/app/price-list" className={NAV_LINK_CLASS}>
            Cenník
          </NavLink>
          <NavLink to="/app/received-invoices" className={NAV_LINK_CLASS}>
            Prijaté
          </NavLink>
          <NavLink to="/app/settings" className={NAV_LINK_CLASS}>
            Nastavenia
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
