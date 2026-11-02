import { Link, Navigate, Route, Routes } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import DialerPage from "./pages/DialerPage";
import { ContactsPage, ContactDetailPage } from "./pages/ContactsPage";
import HistoryPage, { HistoryDetailPage } from "./pages/HistoryPage";
import BlockedPage from "./pages/BlockedPage";
import SettingsLayout from "./pages/SettingsPage";
import { AuthenticatedLayout } from "./layouts/AuthenticatedLayout";
import PublicRecordPage from "./pages/PublicRecordPage";
import RecordsPage from "./pages/RecordsPage";
import { Button } from "./components/ui";
import { useTranslation } from "react-i18next";

function NotFoundPage() {
  const { t } = useTranslation("common");
  return <main className="grid min-h-screen place-items-center bg-white px-5 text-neutral-900 dark:bg-black dark:text-white"><div className="text-center"><p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{t("notFound.eyebrow")}</p><h1 className="mt-3 text-2xl font-semibold">{t("notFound.title")}</h1><p className="mt-2 text-sm text-neutral-500">{t("notFound.detail")}</p><Link className="mt-5 inline-block" to="/"><Button variant="secondary"><ArrowLeft size={15} /> {t("notFound.home")}</Button></Link></div></main>;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/callrecords/:slug" element={<PublicRecordPage />} />
    <Route element={<AuthenticatedLayout />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/call" element={<DialerPage />} />
      <Route path="/contacts" element={<ContactsPage />} />
      <Route path="/contacts/:id" element={<ContactDetailPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/history/:id" element={<HistoryDetailPage />} />
      <Route path="/records" element={<RecordsPage />} />
      <Route path="/blocked" element={<BlockedPage />} />
      <Route path="/settings/*" element={<SettingsLayout />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
