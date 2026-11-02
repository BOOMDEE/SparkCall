import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, Ban, History, LayoutDashboard, LogOut, Menu, Moon, Phone, PhoneCall, Settings, Sun, Users, X } from "lucide-react";
import { api, type Me } from "../lib/api";
import { Button, Notice } from "../components/ui";
import { CallSessionProvider, useCallSession } from "../contexts/CallSession";

const NAV = [
  ["/dashboard", "Overview", LayoutDashboard],
  ["/call", "Dialer", PhoneCall],
  ["/contacts", "Contacts", Users],
  ["/history", "History", History],
  ["/records", "Call records", Activity],
  ["/blocked", "Blocked", Ban],
  ["/settings", "Settings", Settings],
] as const;

export function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<Me>("/api/me").then((user) => { if (active) { setMe(user); setLoading(false); } }).catch(() => {
      if (active) { setLoading(false); navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true }); }
    });
    return () => { active = false; };
  }, [location.pathname, navigate]);
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-neutral-500">Loading workspace…</div>;
  if (!me) return null;
  return <CallSessionProvider><Workspace me={me} /></CallSessionProvider>;
}

function Workspace({ me: initialMe }: { me: Me }) {
  const navigate = useNavigate();
  const [me, setMe] = useState(initialMe);
  const [mobile, setMobile] = useState(false);
  const session = useCallSession();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const apply = (theme: string) => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      setIsDark(dark);
    };
    apply(session.preferences.theme);
    if (session.preferences.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [session.preferences.theme]);

  useEffect(() => { setMe(initialMe); }, [initialMe]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    navigate("/login", { replace: true });
  }
  async function toggleTheme() {
    const theme = isDark ? "light" : "dark";
    await session.updatePreferences({ theme }).catch(() => session.clearError());
    document.documentElement.classList.toggle("dark", theme === "dark");
    setIsDark(theme === "dark");
  }

  return <div className="min-h-screen bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur-sm dark:border-neutral-800 dark:bg-black/95 lg:px-8">
      <div className="flex items-center gap-3">
        <button className="focus-ring rounded p-1 lg:hidden" aria-label={mobile ? "Close navigation" : "Open navigation"} onClick={() => setMobile(!mobile)}>
          {mobile ? <X size={19} /> : <Menu size={19} />}
        </button>
        <Link to="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight"><span className="grid h-6 w-6 place-items-center rounded bg-neutral-900 text-white dark:bg-white dark:text-black"><Phone size={13} fill="currentColor" /></span>SparkCall</Link>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 px-2 text-xs text-neutral-500 sm:inline-flex"><span className={`h-1.5 w-1.5 rounded-full ${session.online ? "bg-green-500" : "bg-neutral-400"}`} />{session.online ? "Online" : "Offline"}</span>
        <Button variant="ghost" className="px-2" aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => void toggleTheme()}>{isDark ? <Sun size={16} /> : <Moon size={16} />}</Button>
        <div className="ml-1 grid h-7 w-7 place-items-center rounded-full border border-neutral-200 bg-neutral-50 text-xs font-medium dark:border-neutral-800 dark:bg-neutral-900" title={me.displayName}>{(me.displayName || me.username || "?").slice(0, 1).toUpperCase()}</div>
        <Button variant="ghost" className="px-2" aria-label="Sign out" onClick={() => void logout()}><LogOut size={16} /></Button>
      </div>
    </header>
    <div className="mx-auto flex max-w-[1440px]">
      <aside className={`${mobile ? "block" : "hidden"} absolute inset-x-0 top-14 z-10 border-b border-neutral-200 bg-white p-3 lg:static lg:block lg:w-56 lg:shrink-0 lg:border-0 lg:border-r lg:bg-transparent lg:p-5 dark:border-neutral-800 dark:bg-black`}>
        <nav className="space-y-0.5" aria-label="Main navigation">
          {NAV.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setMobile(false)} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-neutral-100 font-medium dark:bg-neutral-900" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-white"}`}><Icon size={16} />{label}</NavLink>)}
        </nav>
        <div className="mt-7 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
          <p className="px-3 font-medium text-neutral-700 dark:text-neutral-300">{me.number || "No number claimed"}</p>
          <p className="mt-1 px-3">{me.temporary ? "Temporary account" : "SparkCall identity"}</p>
          {me.temporary && me.expiresAt && <p className="mt-1 px-3">Expires {new Date(me.expiresAt).toLocaleTimeString()}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        {session.error && <div className="mb-5 flex items-start justify-between gap-3"><Notice>{session.error}</Notice><Button variant="ghost" className="shrink-0 px-2" aria-label="Dismiss error" onClick={session.clearError}><X size={16} /></Button></div>}
        <Outlet context={{ me, setMe }} />
      </main>
    </div>
  </div>;
}
