# Changelog

## Switchable theme system — orange ↔ electric blue (2026-05-22)

### Added
- CSS custom property palette system (`--color-accent`, `--color-accent-secondary`, `--color-accent-glow`, `--color-accent-glow-secondary`) with orange (default) and blue (`[data-theme="blue"]`) variants
- `ThemeContext` reads `theme` key from Supabase `settings` table on app load and applies `data-theme` attribute to `<html>`
- Blue asset set: `Repps-Blue-Logo.png`, `Repps-Blue-Icon.png`, `Leaderboard-Blue-Icon.png`, `Profile-Blue-Icon.png`, `repps-blue-icon-192.png`, `repps-blue-icon-512.png`
- Theme-aware favicon — dynamically swapped at runtime via ThemeContext

### Changed
- Tailwind `accent` colors now reference CSS vars instead of hardcoded hex
- All hardcoded `#FF9B2F` / `#FFC857` / `rgba(255,200,87,0.4)` / `rgba(255,155,47,0.1)` replaced with CSS var references across Dab, Home, Leaderboard, Profile, ActivityFeed
- Gradients (`.repps-gradient`, `.repps-gradient-text`) use CSS vars
- Header logo, bottom nav icons, and Add to Home Screen banner are theme-aware
- `theme-color` meta tag and manifest set to neutral dark (`#111315`) to work with both themes
- To switch: set `settings.theme` to `"blue"` or `"orange"` in Supabase Studio

## LFG button on Home (2026-05-22)

### Changed
- Signed-out CTA button: "Join the Fun!" → "LFG!" with larger text (28px → 44px)

## PWA setup + Add to Home Screen banner (2026-05-22)

### Added
- Web app manifest (`manifest.json`) with standalone display, dark background, orange theme color
- PWA icons at 192px and 512px generated from REPPs R icon
- Apple-mobile-web-app meta tags for iOS home screen support
- "Add to Home Screen" dismissible banner — appears once after login with platform-specific instructions (iOS share icon vs Android menu), X to close, persists dismissal to localStorage
- `slideUp` keyframe animation for the banner entrance

### Changed
- Favicon updated from purple lightning bolt SVG to REPPs R icon (PNG)
- Page title updated from "repps" to "REPPs"

## Lock scroll on Home and Profile (2026-05-22)

### Fixed
- Home and Profile pages showed a scrollbar despite having no overflow content — layout now uses `h-screen overflow-hidden` on all pages except Leaderboard

## Sticky header/filters and tighter Home spacing (2026-05-22)

### Changed
- Header (logo + page title) is now sticky at the top across all pages, matching the bottom nav
- Home page: reduced gap above GBT counter and between activity feed and DAB NOW button by 50%
- Leaderboard: GBT section and gender/time filter tabs stay fixed; only the ranked list scrolls
- Profile: disabled unnecessary scroll since all content fits in one viewport

## Custom bottom nav icons (2026-05-22)

### Changed
- Bottom nav tabs now use custom PNG icons (REPPs logo for Home, bar chart+star for Leaderboard, person silhouette for Profile) instead of emoji
- Active/inactive state uses opacity (100% vs 40%) instead of text color change
- Labels use accent color consistently

## Debug OAuth login + calibration alignment UX (2026-05-22)

### Added
- Console logging on Google OAuth sign-in to diagnose "click does nothing" bug — logs redirectTo URL and signInWithOAuth result
- Calibration silhouette guide: dashed SVG body outline shows where to stand
- Alignment feedback during calibration: detects no-pose, too-close, too-far, off-center, and aligned states
- Instruction card updates dynamically ("Step into frame", "Step back a bit", "Move closer", "Move to center", "Hold still…")
- Silhouette and progress bar turn accent orange when aligned

### Changed
- Updated REPPs logo asset
- Calibration UI moved from centered overlay to bottom card with silhouette background

## Add REPPs logo and unified page header (2026-05-22)

### Added
- REPPs logo (`repps-logo.png`) in top-left of every page via Layout header
- Centered page title (Home / Leaderboard / Profile / DAB) in header row next to logo

### Changed
- Removed duplicate page titles from Leaderboard and Profile pages
- Profile signed-out state no longer shows redundant "Profile" heading

## Calibration UX feedback (2026-05-22)

### Added
- Prominent "Stand still — full body in frame" overlay with progress bar during calibration (replaces tiny debug text)
- Progress bar fills as calibration frames accumulate (0→30), resets if pose is lost
- "GO!" flash for 1.5 seconds when calibration succeeds, then detection starts

## Profile layout polish (2026-05-22)

### Changed
- Consistent 8px gap between all profile cards (wrapped in single flex gap-2 container)
- Avatar edit indicator: persistent orange camera icon badge on bottom-right instead of hover overlay
- Sign out in two places: icon in top-right header + full-width button pinned just above nav bar
- Profile title left-aligned in header row (space reserved for logo on left)
- Sign out button pushed to bottom of viewport via flex mt-auto

## Profile avatar + spacing improvements (2026-05-22)

### Fixed
- Google avatar not showing: existing profiles had null `avatar_url` because `ignoreDuplicates` skipped the upsert — now syncs from Google metadata on each sign-in if missing

### Added
- Avatar photo upload: tap avatar circle to pick a custom photo, uploads to Supabase Storage `avatars` bucket
- Upload overlay ("Edit") appears on hover/tap

### Changed
- Profile page spacing tightened: card padding p-6→p-4, card gaps reduced, stats cards side-by-side in flex row
- Sign out button margin reduced

## Phase 6 — Profile + First-Login Gender Prompt (2026-05-22)

### Added
- First-login gender prompt: full-screen overlay blocks the app when `gender_set` is `false`, asks "How do you identify?" with 4 options (Female / Male / Non-binary / Prefer not to say)
- Renders in Layout.tsx so it covers all routes; bottom nav hidden while prompt is showing
- `GenderPrompt` component (`src/components/GenderPrompt.tsx`)
- Profile page avatar: Google photo (80px circle, `no-referrer`) or initial-letter fallback with accent background
- Profile page inline name editing: tap Name card → input with Save/Cancel, 1-50 char validation
- Profile page inline gender editing: tap Gender card → 4-option list, current selection highlighted, tap to save
- Profile page stats: "Your Total Reps" (queried from `reps` table) and "Member Since" (from `profiles.created_at`)
- `gender_set` boolean column on `profiles` table (requires migration — see SQL below)

### Changed
- `Profile` type in AuthContext now includes `gender_set: boolean`
- Layout conditionally renders GenderPrompt when `profile.gender_set === false`
- Profile page fully rewritten with editable fields, stats, and avatar
- Sign out button restyled per spec: `bg-bg-elevated text-ink-primary font-semibold rounded-pill`

### Migration SQL
```sql
ALTER TABLE public.profiles ADD COLUMN gender_set boolean DEFAULT false;
UPDATE public.profiles SET gender_set = true WHERE gender != 'unspecified';
```

## Fix detection lag and clamp ratio (2026-05-22)

### Fixed
- 20-30 second detection lag: replaced boolean frame-skip guard with timestamp throttle (80ms minimum between `detectForVideo` calls) — prevents rAF callback backlog on mobile CPU
- Ratio values spiking above 1.0 (saw 2.42) when landmarks jumped to erratic positions — clamped to max 1.0

## Fix negative compression ratio during burpees (2026-05-22)

### Fixed
- Height measure (`ankleY - noseY`) could go negative or spike above 1.0 when nose dropped below ankles in frame coordinates during a burpee — produced ratios like `2.95` and `-2.34`, breaking detection
- Replaced with vertical spread of all 7 key landmarks (`max(Y) - min(Y)`), which is always positive and collapses naturally when the body compresses during the down phase

## Multi-Signal Burpee Detection (2026-05-22)

### Changed
- Replaced single spread ratio with three independent signals for detecting LOW (down) and HIGH (standing):
  1. **Nose drop** — how far nose Y drops from standing baseline, normalized by body height
  2. **Torso collapse** — shoulder-hip Y gap shrinks as torso goes horizontal
  3. **Z-depth shift** — nose moves toward camera when person drops to floor
- LOW triggers if **any** signal fires (OR logic) — catches burpees even when head stays up
- HIGH triggers if **either** nose recovers or torso is upright (OR logic) — rep counts as soon as you start rising
- Calibration now captures standing nose Y, shoulder-hip gap, and nose Z as baseline
- Tune mode shows all three live signals with individual threshold sliders
- State log shows which signal(s) triggered each transition (e.g. `[nose+torso]`)
- Throttled debug display updates to every 100ms to reduce render overhead

### Added
- Haptic vibration (100ms) on each rep count for instant feedback

## Fix Bubble Rise Speed (2026-05-21)

### Fixed
- Bubbles were still racing up in 3–5s despite 10–18s duration — the 85% keyframe was missing a transform, so CSS interpolated the full distance between 8% and 100% unevenly. Added explicit transform at 90% keyframe so movement is steady across the full duration.

## Slower Bubbles with 3D Sphere Styling (2026-05-21)

### Changed
- Rise speed slowed ~3× (10–18s, was 4–7s) so names are easy to read
- 3D sphere look: specular highlight in upper-left, dark bottom hemisphere, rim lighting on sides, drop shadow beneath
- Stronger backdrop blur (10px) for more depth against the page

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
