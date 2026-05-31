import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    storage: {
      getItem: (key: string) => {
        // Try cookie first (survives Chrome Custom Tabs / SFSafariViewController)
        const match = document.cookie.match(new RegExp(`(^| )${encodeURIComponent(key)}=([^;]+)`));
        if (match) return decodeURIComponent(match[2]);
        return localStorage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        localStorage.setItem(key, value);
        // Also set as cookie (10 min expiry, enough for OAuth round-trip)
        const encoded = encodeURIComponent(key) + '=' + encodeURIComponent(value);
        document.cookie = encoded + '; path=/; max-age=600; SameSite=Lax; Secure';
      },
      removeItem: (key: string) => {
        localStorage.removeItem(key);
        document.cookie = encodeURIComponent(key) + '=; path=/; max-age=0; SameSite=Lax; Secure';
      },
    },
  },
})