import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { SiteConfigurationProvider } from "./contexts/SiteConfiguration";

const AuthPage = lazy(() => import("./pages/AuthPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DialerPage = lazy(() => import("./pages/DialerPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage").then((module) => ({ default: module.ContactsPage })));
const ContactDetailPage = lazy(() => import("./pages/ContactsPage").then((module) => ({ default: module.ContactDetailPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const HistoryDetailPage = lazy(() => import("./pages/HistoryPage").then((module) => ({ default: module.HistoryDetailPage })));
const BlockedPage = lazy(() => import("./pages/BlockedPage"));
const SettingsLayout = lazy(() => import("./pages/SettingsPage"));
const AuthenticatedLayout = lazy(() => import("./layouts/AuthenticatedLayout").then((module) => ({ default: module.AuthenticatedLayout })));
const PublicRecordPage = lazy(() => import("./pages/PublicRecordPage"));
const RecordsPage = lazy(() => import("./pages/RecordsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

export default function App() {
  const { t } = useTranslation("common");
  return <SiteConfigurationProvider><Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-neutral-500" role="status" aria-live="polite">{t("loading")}</div>}><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/callrecords/:slug" element={<PublicRecordPage />} />
    <Route element={<AuthenticatedLayout />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/call" element={<DialerPage />} />
      <Route path="/makecall/:username" element={<DialerPage />} />
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
  </Routes></Suspense></SiteConfigurationProvider>;
}
