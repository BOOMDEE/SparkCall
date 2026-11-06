import { Navigate, Route, Routes } from "react-router-dom";
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
import NotFoundPage from "./pages/NotFoundPage";
import { SiteConfigurationProvider } from "./contexts/SiteConfiguration";

export default function App() {
  return <SiteConfigurationProvider><Routes>
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
  </Routes></SiteConfigurationProvider>;
}
