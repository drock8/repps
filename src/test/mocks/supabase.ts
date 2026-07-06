import { vi } from "vitest";

const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: vi.fn(),
  }),
  in: vi.fn().mockReturnValue({ data: [], error: null }),
  order: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({ then: vi.fn() }),
  }),
  then: vi.fn(),
});

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
  delete: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
});

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

const mockAuth = {
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ data: null, error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
};

export const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
  auth: mockAuth,
  channel: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
};

export { mockFrom, mockSelect, mockRpc, mockAuth };
