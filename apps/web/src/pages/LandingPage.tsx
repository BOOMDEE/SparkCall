import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Phone, Shield, Sparkles } from "lucide-react";
import { api, type Me } from "../lib/api";
import { Button, Card, Notice } from "../components/ui";

export default function LandingPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function tryAsGuest() {
    setBusy(true); setError(null);
    try { await api<Me>("/api/auth/guest", { method: "POST" }); navigate("/dashboard"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a temporary session."); setBusy(false); }
  }
  return <main className="min-h-screen bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
    <header className="mx-auto flex h-16 max-w-6xl items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800 sm:px-6">
      <Link to="/" className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded bg-neutral-900 text-white dark:bg-white dark:text-black"><Phone size={13} fill="currentColor" /></span>SparkCall</Link>
      <div className="flex items-center gap-2"><Link to="/login"><Button variant="ghost">Sign in</Button></Link><Link to="/register"><Button>Create account <ArrowRight size={15} /></Button></Link></div>
    </header>
    <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-20 sm:px-6 lg:grid-cols-[1.2fr_.8fr] lg:items-center lg:pb-28 lg:pt-28">
      <div>
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800"><Sparkles size={13} /> Browser-native voice calling</div>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">A phone number.<br />A browser. A connection.</h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-neutral-500">Make private voice calls directly from your browser. No native app to install, and no call audio stored by SparkCall.</p>
        {error && <div className="mt-5 max-w-md"><Notice>{error}</Notice></div>}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/register"><Button className="w-full sm:w-auto">Create an account <ArrowRight size={16} /></Button></Link>
          <Button variant="secondary" disabled={busy} onClick={() => void tryAsGuest()} className="w-full sm:w-auto">{busy ? "Starting…" : "Try a temporary account"}</Button>
        </div>
        <p className="mt-4 text-xs text-neutral-500">Temporary identities expire after 24 hours. Calls require microphone permission and a working TURN configuration.</p>
      </div>
      <Card className="p-6 sm:p-8">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">Designed around control</p>
        <div className="mt-6 space-y-5">
          <div className="flex gap-3"><span className="mt-0.5 text-neutral-500"><Shield size={18} /></span><div><h2 className="text-sm font-medium">Private by default</h2><p className="mt-1 text-sm leading-6 text-neutral-500">Call metadata is retained for your history; call audio is never recorded.</p></div></div>
          <div className="flex gap-3"><span className="mt-0.5 text-neutral-500"><Check size={18} /></span><div><h2 className="text-sm font-medium">Your calling settings</h2><p className="mt-1 text-sm leading-6 text-neutral-500">Choose audio devices, microphone processing, and a target bitrate.</p></div></div>
          <div className="flex gap-3"><span className="mt-0.5 text-neutral-500"><Phone size={18} /></span><div><h2 className="text-sm font-medium">Real browser calling</h2><p className="mt-1 text-sm leading-6 text-neutral-500">WebRTC carries audio peer-to-peer when possible, with Cloudflare TURN relay support.</p></div></div>
        </div>
      </Card>
    </section>
    <footer className="border-t border-neutral-200 px-4 py-6 text-center text-xs text-neutral-500 dark:border-neutral-800">SparkCall · Open source under Apache-2.0</footer>
  </main>;
}
