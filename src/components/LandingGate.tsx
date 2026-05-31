import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Landing from "../pages/Landing";

export default function LandingGate() {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (profile) return <Navigate to="/home" replace />;
  return <Landing />;
}
