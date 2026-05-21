import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";

export default function Layout() {
  return (
    <div className="min-h-screen bg-bg-base text-ink-primary">
      <main className="mx-auto max-w-md px-4 pt-6 pb-24">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
