# Changelog

## Phase 2 — Live Home Screen (2026-05-21)

### Added
- Total Global Burpees counter fetched from `reps` table on mount
- Supabase Realtime subscription on `reps` INSERT events — increments count locally (no re-query)
- Animated number counter using `requestAnimationFrame` with cubic easing (600ms)
- `repps-gradient-text` applied to the counter number
- Target progress bar and percentage label driven by `settings` table (`global_target`, `target_label`)
- DAB NOW button navigates to `/dab` route
- `/dab` placeholder page with "Phase 3" message and back button

## Phase 1 — App Skeleton (2026-05-21)

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
