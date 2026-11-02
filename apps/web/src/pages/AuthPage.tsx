import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone } from "lucide-react";
import { api, type Me } from "../lib/api";
import { Button, Card, Field, Notice } from "../components/ui";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await api<Me>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username, password, ...(isLogin ? {} : { displayName: displayName || username }) }),
      });
      navigate(destination, { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authentication failed."); setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-white px-4 py-10 text-neutral-900 dark:bg-black dark:text-neutral-100">
    <div className="w-full max-w-md">
      <Link to="/" className="mb-7 inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"><ArrowLeft size={15} /> Back to SparkCall</Link>
      <Card className="p-6 sm:p-8">
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-neutral-900 text-white dark:bg-white dark:text-black"><Phone size={13} fill="currentColor" /></span>SparkCall</Link>
        <h1 className="mt-6 text-xl font-semibold">{isLogin ? "Sign in" : "Create your account"}</h1>
        <p className="mt-2 text-sm text-neutral-500">{isLogin ? "Use your SparkCall username and password." : "Choose a username and a strong password."}</p>
        {error && <div className="mt-5"><Notice>{error}</Notice></div>}
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <Field label="Username" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} />
          {!isLogin && <Field label="Display name" autoComplete="nickname" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How others will see you" />}
          <Field label="Password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? 1 : 12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} />
          {!isLogin && <p className="-mt-2 text-xs text-neutral-500">At least 12 characters. Passwords are stored only as a salted hash.</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="mt-5 text-center text-sm text-neutral-500">{isLogin ? "New to SparkCall?" : "Already have an account?"} <Link className="font-medium text-neutral-900 underline underline-offset-4 dark:text-white" to={isLogin ? "/register" : "/login"}>{isLogin ? "Create an account" : "Sign in"}</Link></div>
      </Card>
    </div>
  </main>;
}
