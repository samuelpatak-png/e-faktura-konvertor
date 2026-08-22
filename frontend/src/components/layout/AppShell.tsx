import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { authApi } from "../../lib/api";

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-canvas hover:text-ink-900"
  }`;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  async function handleResendVerification() {
    setResendState("sending");
    try {
      await authApi.requestVerification();
      setResendState("sent");
    } catch {
      setResendState("error");
    }
  }

  // Non-blocking nudge, not a gate — see schema.prisma User.emailVerified for why nothing in
  // the app checks this besides this banner. Dismissal is per page-load only (not persisted):
  // simplest option, and the banner is unobtrusive enough that re-showing it after a refresh
  // isn't worth the extra state to avoid.
  const showVerifyBanner = Boolean(user) && user?.emailVerified === false && !bannerDismissed;

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
      {showVerifyBanner && (
        <div className="border-b border-line bg-warning-50 px-4 py-2 text-sm text-warning-500 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>Over si emailovú adresu, aby si neprišiel o dôležité upozornenia.</span>
            <div className="flex items-center gap-4">
              {resendState === "sent" ? (
                <span className="font-medium">Email odoslaný, skontroluj schránku.</span>
              ) : resendState === "error" ? (
                <span className="font-medium">Odoslanie zlyhalo, skús neskôr.</span>
              ) : (
                <button
                  onClick={handleResendVerification}
                  disabled={resendState === "sending"}
                  className="cursor-pointer font-medium underline underline-offset-2 disabled:cursor-default disabled:opacity-60"
                >
                  {resendState === "sending" ? "Odosielam…" : "Poslať overovací email znova"}
                </button>
              )}
              <button
                onClick={() => setBannerDismissed(true)}
                aria-label="Zavrieť"
                className="cursor-pointer text-warning-500/70 hover:text-warning-500"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
