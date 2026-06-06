import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useResetCooldown } from "../hooks/useResetCooldown";
import PasswordInput from "./PasswordInput";
import GoogleIcon from "./GoogleIcon";

type AuthMode = "choose" | "signup" | "signin" | "check-email" | "forgot" | "reset-sent";

function getLastLogin(): { method: "google" | "email"; email?: string } | null {
  try {
    const v = localStorage.getItem("repps_login_method");
    if (v === "google" || v === "email") {
      const e = localStorage.getItem("repps_login_email") || undefined;
      return { method: v, email: e };
    }
  } catch { /* ignore */ }
  return null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return local.charAt(0) + "***@" + domain;
  return local.charAt(0) + "***" + local.charAt(local.length - 1) + "@" + domain;
}

export default function AuthForm({ initialMode = "choose", onBack }: { initialMode?: AuthMode; onBack?: () => void }) {
  const { signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { cooldown: resetCooldown, startCooldown: startResetCooldown } = useResetCooldown();
  const lastLogin = getLastLogin();

  const handleSignup = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("All fields are required"); return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters"); return;
    }
    setSubmitting(true); setError("");
    try {
      const { confirmationRequired } = await signUpWithEmail(email.trim(), password, name.trim());
      if (confirmationRequired) setMode("check-email");
      setSubmitting(false);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  const handleSignin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required"); return;
    }
    setSubmitting(true); setError("");
    try {
      await signInWithEmail(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  const handleForgot = async () => {
    if (!email.trim()) {
      setError("Email is required"); return;
    }
    if (resetCooldown > 0) return;
    setSubmitting(true); setError("");
    try {
      await resetPassword(email.trim());
      startResetCooldown();
      setMode("reset-sent");
      setSubmitting(false);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.toLowerCase().includes("rate limit")) {
        startResetCooldown();
        setError("Too many requests. Please wait before trying again.");
      } else {
        setError(msg);
      }
      setSubmitting(false);
    }
  };

  if (mode === "choose") {
    return (
      <div className="w-full max-w-sm flex flex-col gap-3">
        {lastLogin && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elevated/60">
            {lastLogin.method === "google" ? <GoogleIcon size={16} /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-secondary">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
            )}
            <p className="text-caption text-ink-secondary">
              You last signed in with {lastLogin.method === "google" ? "Google" : "Email"}{lastLogin.email ? ` as ${maskEmail(lastLogin.email)}` : ""}
            </p>
          </div>
        )}
        <button
          onClick={signInWithGoogle}
          className="w-full py-4 px-6 rounded-pill bg-ink-primary text-ink-inverse font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
        >
          <GoogleIcon />
          Continue with Google
        </button>
        <button
          onClick={() => setMode("signup")}
          className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
          Sign up with Email
        </button>
        <button
          onClick={() => setMode("signin")}
          className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
        >
          Already have an account? Sign in
        </button>
        {onBack && (
          <button
            onClick={onBack}
            className="w-full py-2 text-caption text-ink-muted text-center"
          >
            Back
          </button>
        )}
      </div>
    );
  }

  if (mode === "signup") {
    return (
      <div className="w-full max-w-sm flex flex-col gap-3">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          maxLength={50}
          autoFocus
          className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(""); }}
          className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
        />
        <PasswordInput
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(val) => { setPassword(val); setError(""); }}
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleSignup}
          disabled={submitting}
          className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Sign up"}
        </button>
        <button
          onClick={() => { setMode("signin"); setError(""); }}
          className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
        >
          Already have an account? Sign in
        </button>
        <button
          onClick={() => { setMode(initialMode); setError(""); }}
          className="w-full py-2 text-caption text-ink-muted text-center"
        >
          Back
        </button>
      </div>
    );
  }

  if (mode === "signin") {
    return (
      <div className="w-full max-w-sm flex flex-col gap-3">
        {lastLogin && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elevated/60">
            {lastLogin.method === "google" ? <GoogleIcon size={16} /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-secondary">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
            )}
            <p className="text-caption text-ink-secondary">
              You last signed in with {lastLogin.method === "google" ? "Google" : "Email"}{lastLogin.email ? ` as ${maskEmail(lastLogin.email)}` : ""}
            </p>
          </div>
        )}
        <button
          onClick={signInWithGoogle}
          className="w-full py-4 px-6 rounded-pill bg-ink-primary text-ink-inverse font-semibold text-body-lg flex items-center justify-center gap-3 transition-all duration-200 ease-apple active:scale-95"
        >
          <GoogleIcon />
          Continue with Google
        </button>
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-divider" />
          <span className="text-micro text-ink-muted uppercase">or</span>
          <div className="flex-1 h-px bg-divider" />
        </div>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(""); }}
          className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
        />
        <PasswordInput
          placeholder="Password"
          value={password}
          onChange={(val) => { setPassword(val); setError(""); }}
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleSignin}
          disabled={submitting}
          className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
        <button
          onClick={() => { setMode("forgot"); setError(""); }}
          className="w-full py-2 text-caption text-ink-secondary text-center"
        >
          Forgot password?
        </button>
        <button
          onClick={() => { setMode("signup"); setError(""); }}
          className="w-full mt-1 py-2 text-caption text-ink-secondary text-center"
        >
          Haven't joined yet? Sign up now
        </button>
      </div>
    );
  }

  if (mode === "check-email") {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
        </svg>
        <p className="text-headline text-ink-primary text-center">Check your email</p>
        <p className="text-body text-ink-secondary text-center">
          We sent a confirmation link to <span className="font-semibold text-ink-primary">{email}</span>. Click the link to activate your account, then come back and sign in.
        </p>
        <button
          onClick={() => { setMode("signin"); setError(""); setSubmitting(false); }}
          className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
        >
          Sign in
        </button>
        <button
          onClick={() => { setMode("choose"); setError(""); setSubmitting(false); }}
          className="w-full py-2 text-caption text-ink-muted text-center"
        >
          Back
        </button>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="w-full max-w-sm flex flex-col gap-3">
        <p className="text-headline text-ink-primary text-center mb-2">Reset password</p>
        <p className="text-body text-ink-secondary text-center mb-2">
          Enter your email and we'll send you a reset link.
        </p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(""); }}
          autoFocus
          className="w-full bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleForgot}
          disabled={submitting || resetCooldown > 0}
          className="w-full py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95 disabled:opacity-50"
        >
          {submitting ? "Sending..." : resetCooldown > 0 ? `Wait ${resetCooldown}s` : "Send reset link"}
        </button>
        <button
          onClick={() => { setMode("signin"); setError(""); }}
          className="w-full py-2 text-caption text-ink-muted text-center"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-4">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
      </svg>
      <p className="text-headline text-ink-primary text-center">Check your email</p>
      <p className="text-body text-ink-secondary text-center">
        We sent a password reset link to <span className="font-semibold text-ink-primary">{email}</span>. Click the link to set a new password.
      </p>
      <button
        onClick={() => { setMode("signin"); setError(""); setSubmitting(false); }}
        className="w-full mt-2 py-4 rounded-pill bg-accent text-ink-inverse font-bold text-body-lg transition-all duration-200 ease-apple active:scale-95"
      >
        Sign in
      </button>
      <button
        onClick={() => { setMode("choose"); setError(""); setSubmitting(false); }}
        className="w-full py-2 text-caption text-ink-muted text-center"
      >
        Back
      </button>
    </div>
  );
}
