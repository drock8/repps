import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import ResetPasswordModal from "./components/ResetPasswordModal";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Dab from "./pages/Dab";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Team from "./pages/Team";
import TeamJoin from "./pages/TeamJoin";

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ResetPasswordModal />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="dab" element={<Dab />} />
              <Route path="leaderboard" element={<Leaderboard />} />
              <Route path="profile" element={<Profile />} />
              <Route path="team" element={<Team />} />
              <Route path="team/join/:code" element={<TeamJoin />} />
              <Route path="reset-password" element={<Home />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
