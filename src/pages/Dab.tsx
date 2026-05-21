import { useNavigate } from "react-router-dom";

export default function Dab() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center text-center pt-24 px-4">
      <p className="text-display-md text-ink-primary">⚡</p>
      <p className="text-headline text-ink-primary mt-4">DAB flow coming in Phase 3</p>
      <p className="text-caption text-ink-muted mt-2">
        Camera + pose detection will go here.
      </p>
      <button
        onClick={() => navigate("/")}
        className="mt-8 bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
      >
        Back to Home
      </button>
    </div>
  );
}
