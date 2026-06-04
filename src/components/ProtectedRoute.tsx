import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function ProtectedRoute() {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (!profile) return <Navigate to="/" replace />;
  return <Outlet />;
}
