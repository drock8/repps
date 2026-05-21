import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";

function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) alert("Sign in error: " + error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#111315", color: "#F5F2EA", padding: "40px", fontFamily: "system-ui" }}>
      <h1 style={{ color: "#FF9B2F" }}>REPPs · Auth Test</h1>

      {session ? (
        <div>
          <p>✅ Signed in as <strong>{session.user.email}</strong></p>
          <p>User ID: {session.user.id}</p>
          <pre style={{ background: "#1C1F24", padding: "12px", borderRadius: "8px", fontSize: "11px", overflow: "auto" }}>
  {JSON.stringify(session.user.user_metadata, null, 2)}
</pre>

          {session.user.user_metadata?.avatar_url && (
            <img src={session.user.user_metadata.avatar_url} alt="avatar" style={{ width: 60, borderRadius: 30 }} />
          )}
          <br /><br />
          <button onClick={signOut} style={{ background: "#FF9B2F", color: "#111315", border: "none", padding: "12px 24px", borderRadius: 32, fontWeight: 700, cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      ) : (
        <button onClick={signInWithGoogle} style={{ background: "#FF9B2F", color: "#111315", border: "none", padding: "12px 24px", borderRadius: 32, fontWeight: 700, cursor: "pointer" }}>
          Sign in with Google
        </button>
      )}
    </div>
  );
}

export default App;