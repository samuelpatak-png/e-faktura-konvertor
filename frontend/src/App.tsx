import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ProtectedRoute, RequireCompanyProfile } from "./components/layout/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InvoiceConverterPage } from "./pages/InvoiceConverterPage";
import { InvoiceHistoryPage } from "./pages/InvoiceHistoryPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Navigate to="new" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="invoices" element={<InvoiceHistoryPage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route element={<RequireCompanyProfile />}>
              <Route path="new" element={<InvoiceConverterPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
