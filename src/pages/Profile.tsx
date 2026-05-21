import { useAuth } from "../contexts/AuthContext";

export default function Profile() {
  const { profile, signInWithGoogle, signOut } = useAuth();

  if (!profile) {
    return (
      <div>
        <h1 className="text-display-md">Profile</h1>
        <p className="text-body text-ink-muted mt-4">
          Sign in to see your profile
        </p>
        <button
          onClick={signInWithGoogle}
          className="mt-6 bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-display-md">Profile</h1>

      <div className="bg-bg-surface rounded-lg p-6 mt-6">
        <p className="text-micro text-ink-muted uppercase tracking-wide">Name</p>
        <p className="text-headline mt-1">{profile.name}</p>
      </div>

      <div className="bg-bg-surface rounded-lg p-6 mt-4">
        <p className="text-micro text-ink-muted uppercase tracking-wide">Gender</p>
        <p className="text-headline mt-1">
          {profile.gender === "non_binary"
            ? "Non-binary"
            : profile.gender === "unspecified"
              ? "Prefer not to say"
              : profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)}
        </p>
      </div>

      <button
        onClick={signOut}
        className="mt-8 w-full bg-bg-elevated text-ink-secondary font-bold text-body rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
      >
        Sign out
      </button>
    </div>
  );
}
