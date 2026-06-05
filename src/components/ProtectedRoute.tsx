import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function ProtectedRoute() {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!profile) {
    try { sessionStorage.setItem("repps_auth_return", location.pathname); } catch { /* ignore */ }
    return <Navigate to="/?auth=signup" replace />;
  }
  return <Outlet />;
}
