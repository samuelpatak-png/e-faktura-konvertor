import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { FullPageSpinner } from "../ui/Spinner";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

export function RequireCompanyProfile() {
  const { user, loading } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user?.companyProfile) return <Navigate to="/app/settings" replace state={{ reason: "company-profile-required" }} />;

  return <Outlet />;
}
