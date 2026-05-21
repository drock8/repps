# Changelog

## Body-Relative Burpee Detection (2026-05-21)

### Changed
- Burpee detection now uses the person's own body height as the reference frame instead of camera frame coordinates
- First ~10 frames calibrate a standing baseline (nose-to-ankle height) while user stands still
- **HIGH (standing):** nose has dropped less than 30% of body height from standing position
- **LOW (down):** hips are within 10% of body height from ankle position (hips near ground)
- Tune mode sliders updated: 5 frame-based thresholds replaced with 3 body-relative ones (nose drop ratio, hip-to-ankle ratio, max duration)
- Debug strip shows body-relative values (`noseDrop`, `hipDist`) and `CALIBRATING` state during baseline capture

### Added
- RECALIBRATE button in tune mode to re-capture standing baseline after repositioning

### Removed
- Frame-relative thresholds (`highNose`, `lowNose`, `lowGap`, `lowHip`) — no longer needed

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
