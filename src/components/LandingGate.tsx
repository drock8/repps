import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Landing from "../pages/Landing";

export default function LandingGate() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (profile) {
    let returnTo = "/home";
    try {
      const stored = sessionStorage.getItem("repps_auth_return");
      if (stored && stored !== "/") {
        returnTo = stored;
        sessionStorage.removeItem("repps_auth_return");
      }
    } catch { /* ignore */ }
    return <Navigate to={returnTo} replace />;
  }
  return <Landing />;
}
