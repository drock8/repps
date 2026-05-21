# Changelog

## Circular Bubbles Rising from Bottom (2026-05-21)

### Changed
- Bubbles are now circular spheres (border-radius: 50%) with content stacked vertically (avatar, first name, +N)
- Bubbles spawn from below the nav bar and rise the full viewport height via a fixed overlay (z-30, pointer-events-none)
- More translucent glass look: lower opacity radial gradient, stronger backdrop blur, subtle orange ambient glow
- Slower rise times (4–7s) for a more ambient, lava-lamp feel
- Empty state placeholder reserves layout space without the overlay

## Reduce Rep Count Lag (2026-05-21)

### Fixed
- Reps were counting 2-3 seconds after completing the burpee — spread ratio was hovering below HIGH threshold on the way up. Lowered HIGH from 0.55→0.48 and LOW from 0.40→0.35 so the rep registers as soon as the person starts rising.

## Fix Spread Detection Thresholds and First Rep (2026-05-21)

### Fixed
- First rep was always missed — `lastHighTimeRef` started at 0 so the duration check (`now - 0 < 8s`) always failed. Calibration now initializes state to HIGH with a current timestamp so the first HIGH→LOW→HIGH cycle counts.
- Dead zone between HIGH (0.70) and LOW (0.45) was too wide — person could come back up to ~0.6 spread and get stuck without triggering HIGH. Tightened to HIGH > 0.55, LOW < 0.40.

## Body Spread Detection (2026-05-21)

### Changed
- Replaced all position-based detection with **body spread ratio** — measures the vertical distance between the highest landmark (nose/shoulders) and lowest (ankles/hips) relative to calibrated standing spread
- **HIGH (standing):** spread > 70% of baseline (body is tall in frame)
- **LOW (down):** spread < 45% of baseline (body is compressed — on the ground)
- This approach is camera-angle independent: when you drop toward the camera your Y-coordinates barely move, but the spread between your top and bottom landmarks still collapses
- Calibration now captures average standing spread over 10 frames
- Tune mode simplified to two sliders: HIGH spread and LOW spread thresholds

### Removed
- All position-based thresholds (nose drop, shoulder drop, hip-to-ankle) — replaced by single spread metric

## Phase 4 — Live Activity Feed (2026-05-21)

### Added
- `ActivityFeed` component with floating bubble animations driven by Supabase Realtime
- Bubbles show avatar (or initial circle), user name, and rep count (+1, +2, etc.)
- Burst grouping: multiple reps from the same user within 5 seconds merge into one bubble with incrementing count
- Profile cache pre-loaded on mount; unknown users fetched inline and cached
- CSS `@keyframes bubble-rise` — spawn from bottom, float upward at varied speeds, fade out
- `prefers-reduced-motion` variant: fade only, no translate
- Empty state: "Be the first to drop a burpee" shown until the first rep arrives
- Max 10 bubbles on screen; oldest removed when cap exceeded
- Spherical bubble styling: radial gradient shine, inset shadows, glass-edge border, backdrop blur
- Randomized rise speed (2.5–5s) and distance (140–220px) per bubble for organic feel

### Changed
- Home page: replaced Phase 4 placeholder with `<ActivityFeed />` between target progress and DAB NOW button
- Feed container height increased to h-56 for more room to float

## Multi-Signal LOW Detection for Burpees (2026-05-21)

### Changed
- LOW (down) detection now uses three signals — any one triggers it:
  1. **Nose** (primary): nose dropped >55% of body height
  2. **Shoulders** (secondary): shoulders dropped >60% of body height — catches people looking up at their phone while on the ground
  3. **Hips** (tertiary): hips within 20% of body height from ankles
- Hip floor threshold loosened from 10% to 20% of body height
- Calibration now also captures standing shoulder position as baseline
- Calibration rejects bad baselines (body height < 15% of frame) and retries
- State log shows which trigger fired (`[nose]`, `[shldr]`, or `[hip]`)

### Added
- Shoulder down ratio slider in tune mode
- Nose down ratio slider in tune mode

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
