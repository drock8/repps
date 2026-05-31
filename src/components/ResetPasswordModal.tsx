import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import PasswordInput from "./PasswordInput";

export default function ResetPasswordModal() {
  const { passwordRecovery, updatePassword, clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!passwordRecovery) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-sm bg-bg-surface rounded-xl px-6 py-8">
        {!done ? (
          <div className="flex flex-col gap-4">
            <p className="text-headline text-ink-primary text-center">Set new password</p>
            <p className="text-body text-ink-secondary text-center">
              Enter your new password below.
            </p>
            <PasswordInput
              placeholder="New password (min 6 characters)"
              value={password}
              onChange={(val) => { setPassword(val); setError(""); }}
              autoFocus
            />
            {error && <p className="text-caption text-error">{error}</p>}
            <button
              onClick={async () => {
                if (!password.trim()) {
                  setError("Password is required"); return;
                }
                if (password.length < 6) {
                  setError("Password must be at least 6 characters"); return;
                }
                setSubmitting(true); setError("");
                try {
                  await updatePassword(password);
                  setDone(true);
                } catch (e) {
                  setError((e as Error).message);
                }
                setSubmitting(false);
              }}
              disabled={submitting}
              className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Updating..." : "Update password"}
            </button>
            <button
              onClick={clearPasswordRecovery}
              className="w-full py-2 text-caption text-ink-muted text-center"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            <p className="text-headline text-ink-primary text-center">Password updated</p>
            <p className="text-body text-ink-secondary text-center">
              Your password has been changed successfully.
            </p>
            <button
              onClick={clearPasswordRecovery}
              className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
