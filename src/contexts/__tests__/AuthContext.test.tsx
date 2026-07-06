import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase", () => {
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: null, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });

  return {
    supabase: {
      auth: mockAuth,
      from: mockFrom,
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    },
  };
});

vi.mock("../../lib/guestSession", () => ({
  getGuestSession: vi.fn().mockReturnValue(null),
  clearGuestSession: vi.fn(),
}));

vi.mock("../../pages/ReferralJoin", () => ({
  consumeReferralCode: vi.fn().mockReturnValue(null),
}));

vi.mock("../../lib/qrRenderer", () => ({
  generateSimpleQRDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,mock"),
}));

import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";
import { supabase } from "../../lib/supabase";

function TestConsumer() {
  const { loading, session, profile } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="session">{session ? "yes" : "no"}</span>
      <span data-testid="profile">{profile ? profile.name : "none"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId("loading").textContent).toBe("true");
  });

  it("resolves to unauthenticated when no session exists", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("session").textContent).toBe("no");
    expect(screen.getByTestId("profile").textContent).toBe("none");
  });

  it("sets session and loads profile when session exists", async () => {
    const mockSession = {
      user: {
        id: "user-123",
        email: "test@test.com",
        app_metadata: { provider: "email" },
        user_metadata: { full_name: "Test User" },
      },
      access_token: "token",
    };

    const mockProfile = {
      id: "user-123",
      name: "Test User",
      gender: "unspecified",
      gender_set: false,
      avatar_url: null,
      created_at: "2026-01-01",
      team_id: null,
      team_joined_at: null,
      timezone: "UTC",
      dob: null,
      nationality_code: null,
      nationality_name: null,
      referral_code: "ABC123",
      referral_qr_url: null,
    };

    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession as any },
      error: null,
    });

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      },
      { timeout: 5000 }
    );

    expect(screen.getByTestId("session").textContent).toBe("yes");
  });

  it("calls onAuthStateChange on mount", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
  });
});
