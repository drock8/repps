import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import GenderPrompt from "./GenderPrompt";
import { useAuth } from "../contexts/AuthContext";

export default function Layout() {
  const { profile } = useAuth();
  const showGenderPrompt = profile && profile.gender_set === false;

  return (
    <div className="min-h-screen bg-bg-base text-ink-primary">
      <main className="mx-auto max-w-md px-4 pt-6 pb-24">
        <Outlet />
      </main>
      {!showGenderPrompt && <BottomNav />}
      {showGenderPrompt && <GenderPrompt />}
    </div>
  );
}
