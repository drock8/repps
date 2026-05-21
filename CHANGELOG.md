# Changelog

## Phase A — App Skeleton (2026-05-21)

### Added
- React Router with three routes: `/` (Home), `/leaderboard`, `/profile`
- Tailwind config with full REPPs design system (palette, typography scale, border radius tokens, `ease-apple` timing)
- Inter font loaded via `rsms.me/inter`
- Gradient utility classes (`.repps-gradient`, `.repps-gradient-text`)
- Auth context (`AuthProvider` / `useAuth`) with Google OAuth, session persistence, and auto-profile creation on first sign-in
- Layout component with `max-w-md` centered container
- Bottom navigation (Leaderboard / Home / Profile) with active state highlighting
- Home page placeholder with global burpee counter (static), target caption, progress bar, DAB NOW / JOIN THE FUN button states
- Leaderboard placeholder page
- Profile page with name/gender cards (signed in) and sign-in prompt (visitor)
- `react-router-dom` dependency

### Fixed
- Sign-out not updating UI — clear state before calling `supabase.auth.signOut()`
- Duplicate key error on `profiles` table — switched from `insert` to `upsert` with `ignoreDuplicates` to handle concurrent `onAuthStateChange` events
