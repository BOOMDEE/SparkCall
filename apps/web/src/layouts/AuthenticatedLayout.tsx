import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, Ban, History, LayoutDashboard, LogOut, Menu, Mic, MicOff, Moon, Phone, PhoneCall, PhoneOff, Settings, Sun, Users, X } from "lucide-react";
import { api, type Me } from "../lib/api";
import { formatDate } from "../lib/format";
import { Button, Notice, useFocusTrap } from "../components/ui";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SiteFooter } from "../components/SiteFooter";
import { CallSessionProvider, useCallSession } from "../contexts/CallSession";
import { useTranslation } from "react-i18next";

const NAV = [
  ["/dashboard", "overview", LayoutDashboard], ["/call", "dialer", PhoneCall], ["/contacts", "contacts", Users],
  ["/history", "history", History], ["/records", "records", Activity], ["/blocked", "blocked", Ban], ["/settings", "settings", Settings],
] as const;
const TERMINAL = new Set(["IDLE", "ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"]);

export function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<Me>("/api/me").then((user) => { if (active) { setMe(user); setLoading(false); } }).catch(() => {
      if (active) { setLoading(false); navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true }); }
    });
    return () => { active = false; };
  }, [location.pathname, navigate]);
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-neutral-500" role="status">{t("loading")}</div>;
  if (!me) return null;
  return <CallSessionProvider userId={me.id}><Workspace me={me} /></CallSessionProvider>;
}

export function ActiveCallControls({ onOpenDialer }: { onOpenDialer: () => void }) {
  const { t } = useTranslation("common");
  const session = useCallSession();
  const call = session.snapshot;
  if (TERMINAL.has(call.state)) return null;
  const label = call.role === "callee" ? (session.peer?.callerName || session.peer?.callerNumber || t("call.incomingCaller")) : t("call.outgoing");
  const ending = call.role === "caller" && call.state !== "CONNECTED";
  return <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950" role="region" aria-label={t("call.controls") }>
    <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
      <button className="min-w-0 text-left" onClick={onOpenDialer}><span className="block truncate text-sm font-medium">{label}</span><span className="block text-xs text-neutral-500" aria-live="polite" aria-atomic="true">{t(`call.states.${call.state}`, { defaultValue: call.state.toLowerCase() })}</span></button>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="secondary" className="px-2" aria-label={call.muted ? t("call.unmute") : t("call.mute")} onClick={() => session.controller?.toggleMute()}>{call.muted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}</Button>
        <Button variant="danger" className="px-2" aria-label={ending ? t("call.cancel") : t("call.hangUp")} onClick={() => ending ? session.controller?.cancel() : session.controller?.hangup()}><PhoneOff size={15} aria-hidden="true" /></Button>
        <Button variant="ghost" className="hidden px-2 sm:inline-flex" onClick={onOpenDialer}>{t("actions.openDialer")}</Button>
      </div>
    </div>
  </div>;
}

function Workspace({ me: initialMe }: { me: Me }) {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const [me, setMe] = useState(initialMe);
  const [mobile, setMobile] = useState(false);
  const session = useCallSession();
  const [isDark, setIsDark] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useFocusTrap(mobile, navRef, menuButtonRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (mobile && event.key === "Escape") { event.preventDefault(); setMobile(false); } };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobile]);
  useEffect(() => {
    const apply = (theme: string) => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark); setIsDark(dark);
    };
    apply(session.preferences.theme);
    if (session.preferences.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply("system"); media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [session.preferences.theme]);
  useEffect(() => { setMe(initialMe); }, [initialMe]);
  async function logout() { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); navigate("/login", { replace: true }); }
  async function toggleTheme() {
    const theme = isDark ? "light" : "dark";
    await session.updatePreferences({ theme }).catch(() => session.clearError());
    document.documentElement.classList.toggle("dark", theme === "dark"); setIsDark(theme === "dark");
  }

  return <div className="min-h-screen bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur-sm dark:border-neutral-800 dark:bg-black/95 lg:px-8">
      <div className="flex items-center gap-3">
        <button ref={menuButtonRef} className="focus-ring rounded p-1 lg:hidden" aria-label={mobile ? t("actions.closeNavigation") : t("actions.openNavigation")} aria-expanded={mobile} aria-controls="main-navigation" onClick={() => setMobile(!mobile)}>{mobile ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}</button>
        <Link to="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight" aria-label={t("brand.homeLabel")}><span className="grid h-6 w-6 place-items-center rounded bg-neutral-900 text-white dark:bg-white dark:text-black"><Phone size={13} fill="currentColor" aria-hidden="true" /></span>{t("brand.name")}</Link>
      </div>
      <div className="flex items-center gap-1.5"><span className="hidden items-center gap-1.5 px-2 text-xs text-neutral-500 sm:inline-flex"><span className={`h-1.5 w-1.5 rounded-full ${session.online ? "bg-green-500" : "bg-neutral-400"}`} aria-hidden="true" />{session.online ? t("status.online") : t("status.offline")}</span><LanguageSwitcher /><Button variant="ghost" className="px-2" aria-label={isDark ? t("actions.switchToLight") : t("actions.switchToDark")} onClick={() => void toggleTheme()}>{isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</Button><div className="ml-1 grid h-7 w-7 place-items-center rounded-full border border-neutral-200 bg-neutral-50 text-xs font-medium dark:border-neutral-800 dark:bg-neutral-900" title={me.displayName}>{(me.displayName || me.username || "?").slice(0, 1).toUpperCase()}</div><Button variant="ghost" className="px-2" aria-label={t("actions.signOut")} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" /></Button></div>
    </header>
    <ActiveCallControls onOpenDialer={() => navigate("/call")} />
    <div className="mx-auto flex max-w-[1440px]">
      <aside id="main-navigation" ref={navRef} className={`${mobile ? "block" : "hidden"} absolute inset-x-0 top-14 z-10 border-b border-neutral-200 bg-white p-3 lg:static lg:block lg:w-56 lg:shrink-0 lg:border-0 lg:border-r lg:bg-transparent lg:p-5 dark:border-neutral-800 dark:bg-black`} aria-hidden={mobile ? undefined : false}>
        <nav className="space-y-0.5" aria-label={t("navigation.label")}>{NAV.map(([to, key, Icon]) => <NavLink key={to} to={to} onClick={() => setMobile(false)} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-neutral-100 font-medium dark:bg-neutral-900" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-white"}`}><Icon size={16} aria-hidden="true" />{t(`navigation.${key}`)}</NavLink>)}</nav>
        <div className="mt-7 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800"><p className="px-3 font-medium text-neutral-700 dark:text-neutral-300">{me.number || t("identity.noNumber")}</p><p className="mt-1 px-3">{me.temporary ? t("identity.temporary") : t("identity.permanent")}</p>{me.temporary && me.expiresAt && <p className="mt-1 px-3">{t("identity.expires", { date: formatDate(me.expiresAt, i18n.language) })}</p>}</div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{session.error && <div className="mb-5 flex items-start justify-between gap-3" role="alert"><Notice>{t("errors.session", { detail: session.error })}</Notice><Button variant="ghost" className="shrink-0 px-2" aria-label={t("actions.dismissError")} onClick={session.clearError}><X size={16} aria-hidden="true" /></Button></div>}<Outlet context={{ me, setMe }} /></main>
    </div>
    <SiteFooter />
  </div>;
}
