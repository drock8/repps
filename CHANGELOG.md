# Changelog

## Update landing page copy and sign-in quotes (2026-06-05)

### Changed
- **Mission headline** — "Let's Get 1 Million Moving for Good." → "1 Million People. 1 Burpee at a Time." with subtitle "Micro-effort. Macro momentum."
- **Motivational quotes** — added 8 new consistency-themed quotes to sign-in rotation (e.g. "Not one hour. Every hour.", "Move a little. All day. Every day.")
- **AuthForm back button** — moved into AuthForm via `onBack` prop instead of external button in Landing

## Gate protected tabs behind sign-up for unauthenticated users (2026-06-05)

### Changed
- **ProtectedRoute redirects to sign-up** — unauthenticated users clicking Events, Board, Inbox, or Teams are now sent to the landing page with the sign-up form auto-opened, instead of silently redirecting to the bare landing page.
- **Return path preserved** — the intended destination is stored in sessionStorage so users land on the right page after signing up.

## New user flow — position card + leaderboard redirect (2026-06-05)

### Added
- **Position card on claim-spot screen** — after completing reps, guests see their estimated daily rank, rep count, and points in a styled card above the sign-up form. Motivational messages for top 3 and top 10 placements.

### Fixed
- **Post-signup redirect** — new and returning users signing up from claim-spot now land on the leaderboard instead of the burpee camera page.

## Fix guest claim-spot redirecting to DAB page instead of leaderboard (2026-06-05)

### Fixed
- **Post-signup redirect** — guest users completing reps and signing up from the "Lock in your spot" screen were redirected back to the burpee camera page instead of the leaderboard. Claim-spot now pre-sets the auth return path to `/leaderboard`, and Google OAuth no longer overwrites an already-set return path.

## Fixed scroll — header and bottom nav always pinned (2026-06-05)

### Changed
- **Header now `fixed top-0`** — matches BottomNav's `fixed bottom-0` pattern. Both are physically locked to viewport edges on all mobile browsers.
- **Layout rewrite** — `<main>` is now a non-scrolling flex container with fixed top/bottom padding to sit between the pinned header and nav. Each page owns its own scroll region via `flex-1 min-h-0 overflow-y-auto overscroll-contain`.
- **Global scroll lock** — `html`, `body`, and `#root` all set `overflow: hidden` + `overscroll-behavior: none` to prevent viewport-level rubber banding on iOS/Android.
- **All pages updated** — Home, Leaderboard, Profile, Team, Events, EventDetail, CreateEvent, Inbox, Conversation, UserProfile all use the new scroll pattern.
- **Removed brittle height calcs** — Leaderboard and Conversation no longer use `h-[calc(100vh-...)]`; they flex-fill the available space instead.
- **Safe area support** — header respects `env(safe-area-inset-top)`, main padding accounts for both safe area insets.

## Leaderboard v2 complete — all 15 boards + Rhythm Heatmap (2026-06-05)

### Added
- **Country scope** — countries ranked by any metric (reps/score/streak/session) with flag emojis and member counts. `get_country_leaderboard` RPC branches by metric, aggregates by `nationality_code`.
- **Consistency metric** — measures sustained effort over time. Qualifying day = daily threshold reps, qualifying week = required qualifying days. Score = avg weekly reps × qualifying weeks. Works across all 3 scopes (individual, team, country). Team consistency requires ALL members to independently qualify each week.
- **Rhythm Heatmap** — 7×24 punchcard chart (Mon-Sun × 0-23h) accessible via grid icon in header. Global tab (all users, per-user TZ bucketing) and Mine tab (personal). 5-min cache, peak detection summary line, `prefers-reduced-motion` respected.
- **Admin leaderboard settings** — `consistency_daily_threshold` and `consistency_weekly_days_required` editable in admin panel.

### Changed
- **Metric pill sizing** — custom flex weights so Consistency fits comfortably without horizontal scroll. Tighter gap and tracking.
- **Consistency defaults to yearly** — tapping Consistency auto-switches from Today/This Week to This Year since consistency is meaningless on short windows.
- **Migration 053** — `get_consistency_leaderboard` (individual/team/country), `get_activity_heatmap` (global/personal).

## Fix referral bonus awarding 100 pts on 1 rep (2026-06-05)

### Fixed
- **Spark bonus no longer fires on first rep** — `process_referral_activation` was using `individual_daily_target` (=1) as the MDR threshold, so the 50 pt bonus always awarded instantly alongside the 50 pt base. Now uses a dedicated `referral_mdr` setting (=5). Incorrectly-awarded bonuses revoked retroactively.

## Profile — persistent DOB and nationality fields (2026-06-05)

### Fixed
- **DOB and nationality now always visible on profile** — previously only shown inside the BonusPointsBanner which disappears after rewards are claimed. Now they appear as persistent, tap-to-edit cards matching the Name/Gender pattern, with flag emoji for nationality and formatted date for DOB.

## Leaderboard v2 Phase 1 — Scope × Metric system (2026-06-05)

### Added
- **3-dimension leaderboard architecture** — Scope (Individual/Team/Country) × Metric (Repps/Score/Streak/Session) × Filters, replacing the old monolithic 5-board pill system.
- **FilterSheet bottom sheet** — collapsible filter panel with Time, Gender, Age bracket (scrollable pills), and Country search (Individual scope only). Apply + Reset controls.
- **3 new team RPCs** — `get_team_reps_leaderboard` (combined raw reps), `get_team_streak_leaderboard` (team streak rankings), `get_team_session_leaderboard` (best session per team).
- **Age and country filtering** — all 5 existing RPCs extended with `p_age_min`, `p_age_max`, `p_country` params. Team RPCs use EXISTS subquery (team appears if ANY member matches filter).
- **URL deep linking** — `?scope=team&metric=streak&time=week&gender=female&age=30-39` via `replaceState`. Invalid params silently corrected to defaults.
- **`flagEmoji` utility** — extracted from CountryPicker into `src/lib/flagEmoji.ts` for shared use.

### Changed
- **Leaderboard.tsx rewritten** — 1,365 → 955 lines. Scope + Metric pills replace old BoardType pills. Generalized pinned card works for both Individual and Team scopes.
- **Country scope and Consistency metric dimmed** — visible but disabled, reserved for Phase 2 and Phase 3.
- **Migration 049** — indexes on `profiles.nationality_code` and `profiles.dob`, `consistency_daily_threshold` and `consistency_weekly_days_required` settings seeded.

## Referral Sparks system (2026-06-04)

### Added
- **Referral system (Sparks)** — share your personal link or QR to earn points when new users join. 50 pts on first rep, 100 pts if they hit 5 reps on day one.
- **`/r/:code` route** — referral deep link stores code in localStorage, consumed after OAuth signup to link referrer → referred.
- **QR icon in header** — tap to open modal with styled scannable QR code (rounded modules, Repps icon centered).
- **SparksCard on profile** — shows Sparks count, referred user list with status (Active/Joined), points earned, and Copy Link + Share buttons.
- **Styled QR renderer** — `src/lib/qrRenderer.ts` draws rounded-corner modules, custom finder patterns, centered logo, and rounded outer corners. Error correction level H.
- **Video overlay QR** — rep recordings now embed user's referral QR (`repps.pro/r/{code}`) instead of generic ref link. Every shared video is a referral vehicle.
- **DB: migrations 043–045** — `referral_code` on profiles (6-char, unique, backfilled), `referrals` table with RLS, `create_referral` / `process_referral_activation` / `get_my_sparks` RPCs, settings seeded at 50/100 pts.

## Fix gender prompt reappearing (2026-06-03)

### Fixed
- **Gender prompt no longer reappears after selection** — prompt now checks both `gender_set` and actual gender value, preventing re-prompting due to token refresh races or alternate selection paths (Dab share flow).

## Audio coaching + V3 default + distance feedback (2026-06-03)

### Added
- **Audio coaching system** — new `src/lib/coachAudio.ts` with priority queue (rejection > coaching > encouragement). Higher-priority clips interrupt lower; same-or-lower are dropped. 1.5s cooldown between rejection cues.
- **24 ElevenLabs clips** — Rachel voice rejection cues ("All the way down!", "Touch the floor!"), escalated variants ("Chest to floor!", "Lay flat!"), mid-movement coaching ("Keep going!", "Push up!"), and encouragement at clean rep streaks ("Nice!" at 3, "Let's go!" at 5, "On fire!" at 10). Generated via `scripts/generate-coach-audio.mjs`.
- **Full-screen color flash overlay** — green/gold flash on rep counted (300ms), amber flash on rejection (400ms). CSS-only animation, doesn't composite into recording canvas.
- **V3 in admin panel** — engine selector now shows V3 as a third option with full feature description.

### Changed
- **V3 is now the default engine** — `settingsEngine` defaults to `"v3"` instead of `"v2"`.
- **Rejection messages rewritten** — positive action framing ("All the way down!" instead of "Get lower — chest to the ground!"). Shorter, punchier text matches audio clips.
- **HINGING → READY abort emits rejection** — standing back up from a partial descent now fires `shallow_descent` instead of resetting silently, so users get audio feedback.
- **Standard thresholds loosened** — `floorRatio` front 0.40→0.45, side 0.38→0.42; `minFloorDwell` front 300→200ms, side 350→250ms; `standRatio` 0.85→0.82. More forgiving for phone-on-shelf conditions.
- **Rejection throttle reduced** — 3000ms → 1500ms between rejection toasts, so consecutive failed reps each get feedback.
- **Rep counter enlarged post-calibration** — 72px bold instead of display-xl. "Drop A Burpee" label hides after calibration to make room.

## Allow 2-member teams with scaled multipliers (2026-06-03)

### Changed
- **Teams activate at 2 members** — no longer need 3 to unlock multipliers. Lowers barrier to entry.
- **Daily multiplier scales with team size** — 2x for duos, 3x for trios (was hardcoded 3x).
- **Team streak bonus scales with team size** — 2 members: +2 → +22/day, 3 members: +3 → +33/day (formula: base = N, cap = N×11).
- **Leave team logic** — 3→2 member team stays `active`; only reverts to `forming` below 2.
- **When a 3rd member joins** — team streak bonus immediately scales up for everyone; streak doesn't reset. New member's individual streak is their own.
- **Profile score history** — column header changed from "3x" to "Mult" since multiplier is now dynamic.
- **Migration 035** — rewrites `join_team`, `leave_team`, `get_team_streak`, `calculate_user_rep_score`, `get_user_score_history` with dynamic member-count-based multipliers.

### Updated docs
- APP_SPEC.md, CLAUDE.md, SOCIAL_SPEC.md, EVENTS_SPEC.md — all team size references updated.

## Team metrics: score breakdown, streak, activity heatmap (2026-06-03)

### Added
- **Member score breakdown on team cards** — each member shows today's base reps, streak bonus (accent), and total points after multipliers (green) below the daily count.
- **Team streak cards** — current and longest team streak displayed side-by-side below the member list, with a progressive bar graphic for the current streak.
- **Team activity heatmap** — 3-month GitHub-style contribution grid aggregating all members' reps per day, scaled to 300 (full yellow = 300+ combined reps).
- **Score history table on Profile** — collapsible 90-day breakdown table below Repp Score showing per-day columns: Reps, 3x, Streak, Team Streak, Weekly 2x, Total Pts.
- **Migration 033** — `get_user_score_history` RPC returning per-day score breakdown with all multiplier components.

### Changed
- **ActivityHeatmap** — now accepts `maxScale`, `label`, and `scaleLabel` props for reuse with custom scales.

## Voice-guided calibration via ElevenLabs (2026-06-02)

### Added
- **ElevenLabs voice guide** — Rachel voice speaks alignment cues during DAB calibration ("Step into the frame", "Move closer", "Step back", etc.) so users don't need to read the screen while positioning.
- **10 pre-generated MP3 clips** in `public/audio/guide/` — cached on mount, rate-limited playback (3s between different cues, 5s before repeating).
- **"Ready. Go!" announcement** when calibration completes.
- **Generation script** — `scripts/generate-guide-audio.mjs` for regenerating clips.

### Fixed
- **Directional alignment messages** — `off-left`, `off-right`, `head-cut` now show proper on-screen text instead of falling through to "Hold still…".

## Bugfix: DAB page stuck on "Powering up" (2026-06-02)

### Fixed
- **DAB camera init never fired** — screen state defaulted to `"setup"` when localStorage key was missing, but the setup screen render path had been removed. Camera/model init was gated on `screen === "detecting"`, so it never ran. Now always starts in detecting mode.
- **ModeIcon crash** — `mode` prop was undefined in some event card contexts, causing `startsWith` TypeError. Added default empty string.

## Phase 17: Home integration + event management (2026-06-02)

### Added
- **Featured event on Home** — if an event is marked featured and active/announced, a card appears on the home screen with progress bar, countdown, and tap-to-open link.
- **Auto-status transitions** — events auto-transition from announced→active (past start time) and active→completed (past end time) on Home, Events hub, and Event Detail pages.
- **Realtime participant counts** — Events hub and Event Detail subscribe to Supabase Realtime on `event_participants` so join counts update live without refresh.
- **Archive button** — organizers can archive completed events from the Event Detail page.
- **Migration 031** — enable Realtime publication on `event_participants` table.

### Changed
- **Feature button** — only shown for announced/active official events (not completed/archived).

## Alignment improvements (2026-06-02)

### Changed
- **Directional alignment feedback** — "off-center" split into "off-left" and "off-right" in both V1 and V2 engines for more helpful camera positioning guidance.
- **Head-cut detection** — new "head-cut" alignment status when only the head is cropped out of frame, preventing misleading "too close" messages.

## Infra: ngrok hosts, rep rate limit (2026-06-02)

### Changed
- **Vite allowed hosts** — added ngrok domains to `server.allowedHosts` for dev tunneling.
- **Rep rate limit** — reduced from 3s to 1s cooldown. Detection engines already enforce 1.5s minimum rep duration, so 1s blocks scripted abuse without dropping legitimate fast reps.
- **fadeInOut keyframe** — new CSS animation for ephemeral UI hints.

## Disable install prompt, harden calibration (2026-06-02)

### Changed
- **Add to Home Screen** — redesigned as a fixed card above the nav bar (no longer a blocking overlay), then disabled until the app is more polished. Component stays in codebase, commented out in Layout.
- **Calibration stability guard** — V1 engine now has the same stability check as V2 (phone must be stationary before calibration begins). Both engines require 2–2.5s minimum wall-clock calibration time, not just frame count.
- **Calibration validation** — both V1 and V2 reject standing heights outside 35–85% of frame and reset if height variance exceeds 8%, preventing bad baselines from partial detections.
- **Calibration reset** — if body disappears or alignment is lost mid-calibration, both engines now reset calibration frames and stability state to prevent locking in a stale baseline.
- **Stabilizing message** — V1 now shows "Place your phone down" during stability check (previously V2-only).

## Feedback conversations + My Feedback (2026-06-02)

### Added
- **My Feedback view** — users tap the feedback button and toggle to "My Feedback" to see all their past submissions with current status and admin replies.
- **Threaded conversations** — expanded feedback items show a chat-like thread. Users can send follow-up replies; admins see the full conversation in the detail panel.
- **Admin reply** — Features, Bugs, and Comments admin boards now have a "Reply to User" section for user-submitted items. Replies are visible to the user in their feedback history.
- **Unread indicator** — red dot on the feedback button when there's an unseen admin reply. Clears when the user expands the item. Persists across sessions via localStorage.
- **Migration 029** — `admin_reply` and `replied_at` columns on `feedback` table, updated `get_feedback_with_votes` RPC.
- **Migration 030** — `user_replies` jsonb column on `feedback` table for threaded conversation.

### Changed
- **Feedback button** — uses solid accent color with black icon/text instead of gradient with white (better contrast on yellow theme).
- **Tab order** — feedback type tabs reordered to Comment / Feature / Bug (Comment is now the default).

## Feedback system: user-facing widget + admin boards (2026-06-02)

### Added
- **Floating feedback button** — accent-colored FAB fixed in bottom-right corner of all app pages (above bottom nav). Tap opens a bottom sheet with three tabs: Feature / Bug / Comment. Features and bugs accept title + description + optional screenshot upload. Comments are text-only. Submissions go to `feedback` table in Supabase.
- **Admin Features board** (`/admin?tab=features`) — 3-column drag-and-drop layout: Prioritized (left, reorderable build queue), My Ideas (center, admin's own features), User Requests (right, with upvote counts). Click any item for full detail panel with status management, screenshot preview, and queue controls. "+ Add" button for admin to log new ideas.
- **Admin Bugs board** (`/admin?tab=bugs`) — same 3-column layout adapted for bug reports with screenshot thumbnails, bug-specific statuses (New → Investigating → Fixing → Fixed / Won't Fix), and Fix Queue.
- **Admin Comments page** (`/admin?tab=comments`) — feed of user comments with All/Testimonials filter. Star button flags comments as testimonials for future display in the app. Delete button for moderation.
- **Admin tab navigation** — Dashboard, Features, Bugs, Comments tabs in admin header. URL-synced via `?tab=` query param.
- **Voting system** — users can upvote feature requests via `toggle_feedback_vote` RPC. Vote counts shown on admin boards.
- **Migration 027** — `feedback` table (type, title, description, screenshot_url, user_id, source, status, priority_order, is_testimonial), `feedback_votes` table (unique per user per item), `feedback-screenshots` storage bucket, RLS policies, `get_feedback_with_votes` RPC, `toggle_feedback_vote` RPC, `update_feedback_priority` RPC.

### Changed
- **Admin dashboard** — max-width widened from `max-w-4xl` to `max-w-6xl` to accommodate 3-column boards.

## Super admin dashboard (2026-06-02)

### Added
- **`/admin` route** — full-screen admin dashboard outside the main app layout, responsive for desktop and mobile.
- **Email-based auth guard** — only super admins (by email allowlist) can access the dashboard. Non-admins see "Access Denied"; unauthenticated users see a login redirect.
- **Platform overview** — stat cards showing total repps, users, active teams, and active events, fetched from Supabase on load.
- **Verification model selector** — large interactive cards for V1 (Height Ratio) and V2 (Multi-State + Angle Detection) showing name, description, feature list, accuracy assessment, and camera support. Active model highlighted with accent border and badge. Selection persists to `detection_engine` key in `settings` table.
- **Theme switcher** — gradient color swatches for Orange, Blue, and Yellow themes. Selection updates the `theme` setting in real-time — all users see the change instantly via Supabase Realtime.
- **Dab page reads `detection_engine` from settings** — replaces hardcoded V2 default. Falls back to V2 if no setting exists. Query param `?v=1` / `?v=2` still overrides for testing.

### Fixed
- **EventDetail.tsx stray brace** — extra `}` at line 89 broke production builds (rolldown parse error). Removed.

## Fix photo uploads: avatars + team logos (2026-06-02)

### Fixed
- **Avatars bucket not public** — bucket existed but was created without the public flag, so uploads succeeded but images returned 404. Added migration 026 to ensure all 4 storage buckets (avatars, team-logos, event-banners, event-sponsors) are created with public access and full RLS policies.
- **Team logos column missing** — `logo_url`, `pending_logo_url`, and `pending_logo_uploaded_by` columns on `teams` table were never applied to remote. Migration 016 now covered by 026's idempotent bucket setup.
- **RLS policy subquery ambiguity** — "Team members can update team logo" policy had unqualified `id` reference in `WITH CHECK` subqueries, causing "more than one row" errors on update. Fixed with explicit `teams.id` qualification.
- **iPhone HEIC uploads rejected** — file input `accept` attribute and type validation blocked HEIC/HEIF files from iOS. Changed to `accept="image/*"` and added HEIC/HEIF to allowed types with empty-type fallback.
- **Silent upload failures** — avatar upload had no user-facing error message on failure. Both upload flows now show clear error text.
- **Missing contentType on upload** — Supabase storage uploads now pass `contentType: file.type` to ensure correct MIME serving.
- **Cache-buster baked into stored URL** — `?t=timestamp` was stored in the database URL, preventing CDN caching. Now stored as clean URLs.

## Code hygiene: deduplicate shared utilities and components (2026-06-02)

### Added
- `src/lib/format.ts` — shared `formatNumber` + `MEDALS` constant (was copy-pasted in 5 and 3 files respectively)
- `src/lib/eventTime.ts` — shared `formatTimeStatus` (was duplicated in Events + EventDetail)
- `src/hooks/useAnimatedCounter.ts` — shared hook (was duplicated in Home + Landing)
- `src/components/Avatar.tsx` — shared Avatar component (was duplicated in Leaderboard + EventDetail)
- `src/components/ModeIcon.tsx` — unified ModeIcon with `mode`/`size`/`className` props (was duplicated across 4 event pages with inconsistent APIs)
- `src/components/GoogleIcon.tsx` — shared Google OAuth SVG icon (was duplicated in 4 files)

### Removed
- ~450 lines of duplicated code across Home, Landing, Leaderboard, Events, EventDetail, EventJoin, CreateEvent, TeamJoin, Profile

## Medium severity: reliability + UX fixes (2026-06-02)

### Fixed
- **Realtime reconnect** — `useRepsChannel` now handles `TIMED_OUT`, `CLOSED`, and `CHANNEL_ERROR` statuses with automatic reconnect after 3 seconds. Previously the feed silently died on mobile network drops.
- **CDN failure retry** — Dab page now shows a "Try Again" button when WASM/model loading fails (timeout, network error). Permission-denied errors still show only "Back to Home" since retry won't help.
- **Auth loading blank flash** — Dab page shows a spinner instead of blank screen during auth loading.
- **Supabase mutation error handling** — Profile name save, gender select, team leave, logo approve/reject now check for errors instead of silently assuming success.
- **OG image absolute URL** — Social link preview image changed from relative `/repps-icon-512.png` to absolute `https://repps.pro/repps-icon-512.png` so previews render on external platforms.

## Security hardening: critical + high severity fixes (2026-06-02)

### Critical fixes (migration 024)
- **rep_scores RLS** — enabled Row Level Security on the materialized score table; added read-only public policy. Previously any authenticated user could UPDATE scores directly.
- **Reps direct INSERT bypass** — dropped the misnamed permissive INSERT policy from migration 002 that migration 004 failed to remove. Direct inserts now correctly denied; all reps must go through the rate-limited `insert_rep()` RPC.
- **claim_guest_reps auth** — added `auth.uid()` validation. Previously any authenticated user could claim guest reps to any account.
- **insert_guest_rep rate limit** — added 3-second cooldown matching `insert_rep()`. Previously guest rep insertion had zero throttling.

### High severity fixes (migration 025)
- **Team UPDATE policy** — replaced the overly broad "Team members can update team logo" policy with one that enforces captain_id, status, name, and join_code cannot be changed by non-captains.
- **join_team race condition** — added `SELECT ... FOR UPDATE` row lock on the team row to serialize concurrent join attempts, preventing teams from exceeding the 3-member limit.
- **feature_event admin check** — restricted event featuring to admin users (listed in `admin_users` setting). Previously any event creator could globally feature their own official event.
- **Individual streak threshold** — added `individual_daily_target` setting (default 1) separate from `team_daily_target` (5). Solo users can now build streaks with just 1 burpee/day.

## Rebrand "rep/reps" → "repp/repps" across all UI text (2026-06-01)

### Changed
- All user-facing display text updated: "rep" → "repp", "reps" → "repps", "Rep Score" → "Repp Score", "Raw Reps" → "Raw Repps".
- Affected pages: Leaderboard, Profile, Home, Dab, Team, Events, EventDetail, EventJoin, CreateEvent, ActivityHeatmap.
- Variable names, DB columns, and RPC names left unchanged (code-only identifiers).

## Fix link preview showing blue logo (2026-06-01)

### Fixed
- **Favicon in `index.html`** — changed from hardcoded blue icon to default orange (`repps-icon-192.png`). ThemeContext still swaps it dynamically at runtime.
- **PWA manifest** — icons changed from blue to default orange (`repps-icon-192.png`, `repps-icon-512.png`).

### Added
- **Open Graph + Twitter meta tags** — link previews now show the REPPs orange logo, title, and tagline instead of a blank or blue-branded card.

## Theme-aware mascots (2026-06-01)

### Added
- **Yellow mascot variants** — `Repps-Dab-Yellow.png` (DAB pose) and `Repps-Pumped-Yellow.png` (pumped/flexing pose) added to `public/`.
- **`src/lib/mascots.ts`** — central mascot registry mapping theme × pose to image paths. Supports `dab`, `pumped`, and `lfg` poses across `orange`, `blue`, and `yellow` themes. Extensible for future mascots.

### Changed
- **Home page DAB mascot** — now swaps based on active theme via `getMascot(theme, "dab")`.
- **Leaderboard pumped mascot** — now swaps based on active theme via `getMascot(theme, "pumped")`.

## Standardize default avatar colors (2026-06-01)

### Changed
- **Default avatar background** — all user initial avatars now use a consistent yellow (`#FFD600`) background with black text, replacing the previous per-theme accent color. Affects profile, leaderboard, team, event detail, team join, and activity feed.
- Added `avatar-bg` and `avatar-text` design tokens to Tailwind config.

## Event rules, sponsors, richer prizes, banner aspect fix (2026-06-01)

### Added
- **Rules field** — optional textarea (2000 chars) on event creation step 4. Displayed in its own card on the event detail page with `whitespace-pre-line` formatting.
- **Sponsors system** — dynamic list of sponsors per event, each with name, logo upload (to `event-sponsors` storage bucket), and website URL. Add/remove sponsors freely during creation or editing. Displayed as tappable cards on event detail (logo, name, external link icon).
- **Richer prize description** — upgraded from single-line input (200 chars) to textarea (1000 chars) for detailed prize info. Displayed in a dedicated card with medal icon on event detail.
- **Migration 023** — adds `rules` (text, max 2000), `sponsors` (jsonb array of `{name, logo_url, link_url}`), widens `prize_description` to 1000 chars, creates `event-sponsors` storage bucket with RLS, updates `create_event` and `update_event` RPCs with new params.

### Changed
- **Banner aspect ratio** — all event banners now use `aspect-video` (16:9) instead of fixed heights (`h-32`/`h-40`) across CreateEvent upload preview, Events list cards, and EventDetail page. Prevents side-cropping on phone screens.
- **Step 4 label** — renamed from "Prizes" to "Prizes & Rules" in the wizard step indicator.
- **Prize type label** — "Custom Prize" button renamed to "Sponsored / Custom" to better reflect sponsor-backed events.

## Live Sprint mode, location field, edit event, category fix (2026-06-01)

### Added
- **Live Sprint competition mode** — 7th mode: max reps in a timed window, everyone DABs at once. Timer icon, sprint duration picker (5/10/15/30/60 min presets), auto-computed end time from start + duration.
- **Location field** — optional "Where to Meet" text input (max 200 chars) on event creation. Shown with map pin icon on event detail page.
- **Edit Event flow** — organizers can edit draft or announced events via Edit button on event detail. Reuses the create wizard with pre-populated fields. Calls new `update_event` RPC.
- **`update_event` RPC** (migration 022) — accepts all event fields as optional params, validates ownership + status, supports clearing fields via `p_clear_*` booleans.
- **Migration 021** — adds `location` and `sprint_duration_minutes` columns to events, updates `competition_mode` constraint to include `live_sprint`, replaces `create_event` RPC with version accepting new params.

### Fixed
- **Category selector** — removed admin-only gate on "Official" category button. Both Official and Community now visible to all users.

## Phase 16: Create Event Flow + Join Route (2026-06-01)

### Added
- **`/events/create` route** — 5-step wizard for creating events (Identity → Competition → Timing → Prizes → Review). Progress bar at top, back/next navigation, field validation per step.
  - Step 1: Event name (3-60 chars), description (optional, 500 max), banner upload to `event-banners` Supabase Storage bucket, category (Official only for admin), visibility (Public / Invite Only).
  - Step 2: Competition mode selector with 6 visual cards (globe/person/group icons + descriptions), target reps input (shown for target modes), scoring method (Raw Reps / Rep Score), max participants/teams.
  - Step 3: Native `datetime-local` inputs styled with dark color scheme, duration preview ("Runs for X days, Y hours").
  - Step 4: Prize type toggle (Bragging Rights / Custom Prize) with description input.
  - Step 5: Review summary of all fields, "Announce Now" and "Save as Draft" buttons.
- **`/events/join/:code` route** — Deep-link join handler with all states: event info + Join button, already joined ("You're already in this event!" + View Event), event full, event ended (+ View Results), not signed in (Google + Email sign-in buttons with auto-join after auth via `sessionStorage`). Team event validation warns if user has no active team.
- **"+ Create" button** on Events Hub page — accent pill button, top right, visible only to authenticated users.

### Changed
- **`App.tsx`** — added `/events/create` and `/events/join/:code` routes (before `/events/:id` to match first).
- **`Layout.tsx`** — added page title mappings for "Create Event" and join routes.

## Phase 15: Events Hub UI + Event Detail (2026-06-01)

### Added
- **`/events` route** — Events Hub with 4 category tabs (Featured, Official, Community, My Events). Each tab filters events from Supabase with enriched participant counts and progress data via `get_event_progress` RPC.
- **Event card component** — banner thumbnail, event name, competition mode badge with icon (globe/person/group), time status ("Starts in Xd Xh" / "LIVE · Xd remaining" / "Completed"), participant/team count, progress bar for target modes, prize badge for custom prizes.
- **`/events/:id` route** — Event Detail page with banner, event header, progress bar (target modes), Join/Share buttons, Leave option, and organizer controls (Announce, Complete, Feature).
- **Leaderboard tab** — handles all 6 competition modes: `global_target` (collaborative progress bar + contribution list), `individual_most`/`individual_target` (ranked individual list), `team_most`/`team_target` (ranked team list with expandable member breakdown), `team_vs_team` (two-column head-to-head display). Completed events show frozen leaderboard with winner highlighted.
- **Details tab** — description, creator name, category, mode, scoring method, target, prize, late join, retroactive reps, visibility, participant count, start/end times.
- **QR Code tab** — client-side QR generation via `qrcode` package (white on dark brand colors), copy link button, download PNG button.
- **Share button** — Web Share API with template message, copy-to-clipboard fallback (same pattern as team invites).
- **Events tab enabled in bottom nav** — previously stubbed as disabled, now active and navigating to `/events`.
- **Auto-complete** — event detail page triggers `complete_event` RPC when visiting an active event past its `ends_at`.

### Changed
- **`App.tsx`** — added `/events` and `/events/:id` routes.
- **`BottomNav.tsx`** — removed `disabled: true` from Events tab.
- **`Layout.tsx`** — added "Events" page title mapping and scrollable flag for events routes.
- **`CLAUDE.md`** — Phase 15 marked Done, current phase updated to 16.

## Phase 13: Events DB foundation (2026-06-01)

### Added
- **`events` table** — full schema with name (3–60 chars), description (500 max), 6 competition modes (`global_target`, `individual_most`, `individual_target`, `team_most`, `team_target`, `team_vs_team`), scoring method (`raw_reps` / `rep_score`), visibility (`public` / `invite_only`), 5-state lifecycle (`draft` → `announced` → `active` → `completed` → `archived`), participation rules (`max_participants`, `max_teams`, `allow_late_join`, `retroactive_reps`), prizes, and featured flag.
- **`event_participants` table** — links users to events with optional team reference, `unique(event_id, user_id)` constraint, active/withdrawn status.
- **`event_results` table** — materialized rankings on event completion with final reps, score, rank, and winner flag.
- **`event-banners` storage bucket** — public read, authenticated upload/update/delete (same pattern as team-logos).
- **RLS policies** — public reads non-draft events, creator reads own drafts and updates own events, public reads participants and results.
- **Indexes** — on `status`, `is_featured` (partial), `join_code`, `starts_at`, plus `event_id` on participants and results.
- **`EVENTS_SPEC.md`** — canonical spec for the full Events system (Phases 13–17).

## Migration 018: team logo + member update RPCs (2026-06-01)

### Added
- **Migration 018** — team logo and member update RPC additions.

## Fix team logo upload error handling (2026-06-01)

### Fixed
- **Logo upload silently failed on DB error** — the Supabase update call to set `logo_url` or `pending_logo_url` wasn't checking for errors. Upload appeared successful even when the DB write failed. Now captures the error, shows "Upload failed — try again" to the user, and logs to console.

## Yellow theme support (2026-06-01)

### Added
- **Yellow theme palette** — `[data-theme="yellow"]` CSS custom properties with gold accent (`#FFD600`) and secondary (`#FFE857`).
- **Yellow icon assets** — `Repps-Yellow-Icon.png`, `Repps-Yellow-Logo.png`, `repps-yellow-icon-192.png`, `repps-yellow-icon-512.png`.

### Changed
- **ThemeContext** — type expanded from `"orange" | "blue"` to `"orange" | "blue" | "yellow"` with a `parseTheme()` validator replacing hardcoded `=== "blue"` checks. Removed debug console.log/console.warn lines.
- **BottomNav** — refactored from duplicate `TABS_ORANGE` / `TABS_BLUE` arrays to a single `makeTabs(theme)` function. Board and Profile tabs now use inline SVG icons instead of theme-specific PNGs.
- **Layout, Landing, Dab, AddToHomeScreen** — all theme-branching updated to handle three themes (logo, favicon, video overlay logo).

## Fix missing Score leaderboard entries, rename Reps tab (2026-06-01)

### Fixed
- **Score leaderboard missing users** — 5 users (including Ying Liu with 30 reps) had reps but no `rep_scores` rows, so they appeared on the Reps leaderboard but not the Score leaderboard. Backfilled all missing scores via `refresh_user_rep_scores`. Root cause: orphaned reps row with NULL `user_id` crashed the original migration backfill partway through.
- **NULL guard on `refresh_user_rep_scores`** — Function now returns early if passed a NULL `user_id`, preventing trigger crashes from orphaned data.
- **Orphaned reps cleanup** — Deleted reps rows with NULL `user_id` from the database.

### Changed
- **Leaderboard tab label** — Renamed "Reps" to "Repps" to match brand spelling.

## Team header: horizontal layout with camera badge (2026-06-01)

### Changed
- **Team header layout** — Switched from vertically stacked (centered logo above name) to horizontal (logo left, name/status/members right). Saves vertical space.
- **Camera badge** — Small electric blue circle with camera icon on the bottom-right of the team logo, matching the profile page pattern. Replaces the hover overlay which didn't work well on mobile.
- **Pending approval card** — Approve/Reject buttons now side by side instead of stacked.

## Team logo upload with captain approval (2026-06-01)

### Added
- **Team logo** — Any team member can upload a profile image (JPEG/PNG/WebP/GIF, max 5 MB). If uploaded by the captain, it goes live immediately. If uploaded by another member, it's held as pending until the captain approves or rejects it.
- **Captain approval UI** — Captain sees a card with the proposed logo, uploader's name, and Approve/Reject buttons. Non-captain uploaders see a "pending captain approval" notice.
- **Logo display** — Team logo appears on: team page header (tappable to upload), home team card, and team leaderboard rows. Falls back to a groups icon when no logo is set.
- **DB migration** — `logo_url`, `pending_logo_url`, `pending_logo_uploaded_by` columns on `teams`. `team-logos` Supabase Storage bucket with public read and authenticated write.
- **Leaderboard RPC update** — `get_team_score_leaderboard` now returns `team_logo_url`.

## Move scoring button to top of team page, electric blue style (2026-06-01)

### Changed
- **"How to maximize your Rep Score" button** — Moved from below the daily target card to directly under the team name/status header, above the members list. Styled as an electric blue accent pill button with bolt icon to make it stand out.

## Scoring modal: replace emojis with Material icons in brand color (2026-06-01)

### Changed
- **Multiplier icons** — Replaced emoji (🔥📅⚡👥) with filled Google Material Symbols SVGs in electric blue accent color: local_fire_department, date_range, bolt, groups.

## Scoring table: color-coded individual vs team breakdown (2026-06-01)

### Changed
- **Breakdown table redesigned** — 7-column table showing Reps, 3x daily, individual streak, team streak, weekly 2x, and daily total. Blue columns for individual bonuses, green for team bonuses. Includes week-end rows where the ×2 weekly multiplier kicks in. Legend below explains abbreviations.

## Team page: aligned member rows, scoring explainer modal (2026-06-01)

### Fixed
- **Member row alignment** — Captain's checkmark/count circle now stays in the same vertical column as other members. A fixed-width right column with a spacer replaces the variable-width layout caused by the 3-dot menu appearing only on non-captain rows.

### Added
- **"How to maximize your Rep Score" button** — Opens a bottom-sheet modal explaining all 4 multipliers (daily 3x, weekly 2x, individual streak +1→+11, team streak +3→+33) with a 30-day solo vs team comparison (209 pts solo → 1,854 pts with team) and a day-by-day breakdown table.

## Home team card: rank badge, team name, motivational insight (2026-06-01)

### Changed
- **Team card header** — Shows the actual team name (e.g. "LFG Team") instead of generic "Team Today". "today" appears as a secondary label next to the rep count.
- **Rank badge** — Team's leaderboard rank displayed with medal emoji (🥇🥈🥉) for top 3, or `#N` for other positions, matching the leaderboard style.

### Added
- **Motivational insight** — Contextual message below the team card based on leaderboard standing: warns when rivals are closing in, encourages when overtaking is within reach, or shows the gap to the next team.

## Finish screen polish: confetti, Go audio, video view (2026-06-01)

### Fixed
- **Confetti** — DPR-aware rendering so particles appear at correct visual size on high-density screens instead of being nearly invisible.
- **Video preview** — Removed forced 9:16 aspect ratio and `objectFit: cover` that cropped the rep counter and QR code in corners. Video now displays at natural aspect ratio.

### Changed
- **Go audio** — Regenerated with Rachel voice (ElevenLabs) saying "Ready? Let's go!" instead of flat "Go!" for more energy on calibration complete.
- **Confetti particles** — Bumped sizes from 4–15px to 6–22px for more visual impact.

## Landing page responsive fit (2026-06-01)

### Changed
- **Viewport height** -- Switched from `h-screen` to `100dvh` so mobile Safari address bar doesn't cause overflow.
- **Responsive typography** -- Headline and counter use `clamp()` to scale with viewport height instead of fixed sizes.
- **Spacing** -- Replaced fixed margins with `vh`-based gaps so content compresses gracefully on short screens.
- **Video** -- Capped at `22vh` max height so it doesn't push the CTA off-screen on smaller devices.

## DAB flow improvements + milestone date update (2026-06-01)

### Changed
- **Milestone target date** -- Extended from May 31 to June 6 for the 1,000 burpee goal.
- **Camera + mic permission** -- Combined into a single getUserMedia request instead of two separate pop-ups.
- **Video poster frame** -- Summary screen now shows the user's first rep as the video thumbnail instead of a black screen.
- **Summary screen sizing** -- Video and action bar fit entirely within the viewport without scrolling.

### Fixed
- **Guest rep flow** -- Added missing `insert_guest_rep` and `claim_guest_reps` RPCs, fixed scoring trigger crash on null user_id for guest reps.
- **Confetti debugging** -- Added console logging to diagnose confetti canvas sizing on Finish tap.

## Tighten top spacing so CTA is visible on load (2026-06-01)

### Changed
- **Landing page** -- Reduced vertical spacing throughout so "Join the Movement" button is visible without scrolling. Moved video below the CTA.
- **Layout header/main** -- Reduced top padding on header (pt-4 → pt-2) and main content area (pt-2 → pt-1).
- **Home page** -- Removed redundant pt-4 top padding from the Home component.

## Profile charts and heatmap improvements (2026-06-01)

### Added
- **Weekly bar chart** -- 7-day bar chart on Profile showing daily rep counts for the current week, with today highlighted in accent color.
- **Weekly trend chart** -- 8-week sparkline on Profile showing weekly rep totals over time.

### Changed
- **Activity heatmap intensity** -- Switched from relative scale (based on personal max) to absolute thresholds (10/25/50/75/100+). Legend now shows "0" to "100+" instead of "Less" to "More".
- **Profile today count** -- Uses local timezone boundary instead of the RPC's UTC-based count, fixing the same off-by-one issue as the home team card.

## Improve DAB flow: silhouette guide, GO audio, Finish button, confetti, calibration fix (2026-06-01)

### Added
- **"GO!" voice cue** -- ElevenLabs-generated audio plays when calibration completes, alongside the visual flash. Preloaded with rep audio for instant playback.
- **Confetti celebration** -- 2-second particle burst when user taps Finish. Rendered on both the visible overlay and the recording canvas so it appears in shared videos. Triple haptic pulse on tap.
- **Confetti module** (`src/lib/confetti.ts`) -- Lightweight canvas-based particle system with fade-out.

### Changed
- **Silhouette guide redesigned** -- Replaced faint dashed-line outline with a dark mask (60-70% opacity) covering the camera feed, with a body-shaped cutout. Target position is now unmistakable.
- **"I'm Done" button → "Finish"** -- Moved from small floating circle (top-right of camera) to full-width pill button fixed above bottom nav. Only appears after calibration.
- **Summary action bar simplified** -- Removed separate "Save" button. "Share" opens native share sheet (includes save/download on both iOS and Android). Falls back to download if share API unavailable.

### Fixed
- **Burpees not registering after delayed camera setup** -- Stability guard previously only required 2 of 4 core landmarks visible, allowing it to lock in "stable" while user was still across the room. Now requires all 7 key landmarks (nose, shoulders, hips, ankles) visible with vertical torso before stability tracking begins. Also reverts stability if body disappears before calibration completes, preventing a stale baseline.

## Fix home team card counting yesterday's reps (2026-06-01)

### Fixed
- **Home team card showed 19 instead of 11** -- Day boundary used UTC midnight (`T00:00:00Z`) instead of local midnight. In UTC+8 (Shanghai), reps done yesterday evening were counted as today. Now uses `setHours(0,0,0,0)` to match the Team page logic.

## Fix guest reps not saving to database (2026-06-01)

### Fixed
- **Guest reps silently lost** -- Guest (not logged in) rep inserts used direct `.insert()` on the `reps` table, which relies on an anon RLS policy. If that policy was missing or broken, inserts failed silently — reps counted on screen but never reached the database. Now uses `insert_guest_rep()` RPC with `security definer`, matching how authenticated inserts work.

### Migration SQL
```sql
-- Run supabase/migrations/013_guest_insert_rpc.sql
```

## Fix Vercel build failures (2026-06-01)

### Fixed
- **All deployments since landing page commit failed** -- Unused imports (`Landing` in App.tsx, `navigate` in Profile.tsx) caused `tsc -b` build errors. Vercel was still serving the 2-hour-old build.

## Sign out navigates to landing page (2026-06-01)

### Fixed
- **Sign out left user on Profile sign-in form** -- Now redirects to the landing page (`/`) on sign out so users see the front door experience.

## Landing page + streak leaderboard fix (2026-05-31)

### Added
- **Landing page** -- New public-facing hero page at `/` for logged-out users. Shows REPPs blue logo, scrolling ticker (CV-VERIFIED / TRIBAL COMPETITION / GLOBAL COUNTER), mission headline ("Let's Get 1 Million Moving for Good."), live global burpee counter, clean video card with play button, and "Join the Movement" CTA. No sign-up required -- CTA navigates straight to the Home page so users can DAB immediately.
- **`LandingGate` component** -- Routes logged-in users to `/home`, logged-out users see the landing page.
- **Compact video button on Home** -- YouTube thumbnail replaced with a small pill-style "Watch the mission" button at the bottom of the Home page. Opens the same full-screen video overlay.

### Changed
- **Routing** -- Home page moved from `/` to `/home`. Bottom nav, Dab page, and Layout updated to match. Logged-in users auto-redirect from `/` to `/home`.
- **`YouTubeEmbed`** -- Added `compact` prop for the minimal pill button variant used on the Home page.

### Fixed
- **Streak leaderboard not sorted** -- `get_streak_leaderboard()` RPC returned users in arbitrary database iteration order instead of ranked by longest streak. A 3-day streak could appear at rank 7 while 1-day streaks were rank 1. Fixed by accumulating results into a temp table and returning sorted by `longest_streak desc, current_streak desc`.

### Migration SQL
```sql
-- Run supabase/migrations/012_fix_streak_leaderboard_sort.sql
```

## Fix password reset redirect (2026-05-31)

### Fixed
- **Reset password link redirected to home** -- Supabase was stripping the `?type=recovery` param because the redirect URL wasn't in the allow list. Switched to a dedicated `/reset-password` route with path-based detection so the recovery modal triggers reliably.

## Fix team join page sign-in button readability (2026-05-31)

### Fixed
- **Google button text unreadable** -- Text was light on a white background. Changed to dark gray (`text-gray-800`).
- **Email sign-in** -- Now matches Profile page style: elevated pill button with mail icon.

## Home screen cosmetic polish (2026-05-31)

### Changed
- **DAB button** -- "Drop A Burpee" subtitle now appears between "DAB" and "NOW" on the button itself, reinforcing the acronym.
- **Activity feed** -- "Be the first to drop a burpee" text only shows for users who haven't done any reps yet. Hidden once the user has logged at least one burpee.

## Fix Android Google login and team invite sign-in (2026-05-31)

### Fixed
- **Android Google login fails** -- Chrome Custom Tabs open OAuth in a separate browser context that can't read the PKCE `code_verifier` from the originating tab's localStorage. Fixed by using `skipBrowserRedirect: true` and navigating in the same tab via `window.location.href`, keeping the PKCE verifier accessible on return.
- **Team invite page has no sign-in option** -- When opening a `/team/join/:code` link while signed out, users saw "Sign in to join this team" with no way to actually sign in. Added a "Continue with Google" button (redirects back to the invite page after auth) and a "Sign in with Email" fallback link.
- **Removed ngrok config** -- No longer needed since app is served via Vercel.

## Fix team leaderboard expand crash (2026-05-31)

### Fixed
- **Expanding a team row crashed the app** -- `.sort()` mutated React state in-place during render, and `base_reps` could be undefined from the JSONB response. Fixed with spread copy and defensive defaults.

## Leaderboard UX pass (2026-05-31)

### Changed
- **Tab order** -- Leaderboard tabs reordered to Teams → Score → Reps → Streak → Session (team features promoted).
- **Score tab shows reps** -- Each row now displays base reps (secondary) alongside the Rep Score points.
- **Teams tab shows reps** -- Team rows show combined reps next to combined score. Expanded member breakdown also shows per-member reps.
- **Home team card redesigned** -- Each member avatar now has a pill badge showing their today rep count (accent when target hit, muted otherwise). Left side shows team total reps for the day.

### Added
- **Migration 011** -- `get_team_score_leaderboard` RPC updated to return `combined_reps` and per-member `base_reps`.

## Phase 10 — Scoring engine (2026-05-31)

### Added
- **`calculate_user_rep_score(p_user_id, p_period)` RPC** -- Full Rep Score with all 4 multipliers: daily team 3x, weekly team 2x, individual streak bonus (+1→+11), team streak bonus (+3→+33). Supports `daily`, `weekly`, `monthly`, `yearly`, `all` periods. Returns score, base reps, and current streak info.
- **`get_team_streak(p_team_id)` RPC** -- Returns current and longest consecutive-day team streak (days where all 3 members hit the daily target).
- **Performance index** on `reps(user_id, validated_at)` for day-level grouping queries.
- All multiplier values read from `settings` table at runtime (admin-adjustable, not hardcoded).

## Fix YouTube embed loading blank screen (2026-05-31)

### Fixed
- **YouTube embed shows bot detection wall** -- Clicking the video thumbnail on Home opened a modal with a blank white screen / "sign in to confirm you're not a bot" message. Switched to `youtube-nocookie.com`, removed `autoplay=1` (the main bot-detection trigger), and replaced the `paddingBottom` aspect-ratio hack with `aspect-video` for more reliable sizing.
- **Home page content clipped** -- The YouTube embed below the DAB button was cut off because the Home route (`/`) was not in the scrollable routes list. Added `/` to scrollable routes so the full page is reachable by scrolling.

## Forgot password & password visibility toggle (2026-05-31)

### Added
- **Forgot password flow** -- "Forgot password?" link on sign-in screens triggers Supabase `resetPasswordForEmail`. Shows a "Check your email" confirmation screen with the user's email after sending.
- **Password reset modal** -- When user clicks the reset link in their email and returns to the app, a modal appears to set a new password. Listens for Supabase `PASSWORD_RECOVERY` auth event. Shows success confirmation after update.
- **Password visibility toggle** -- Eye icon on all password fields lets users reveal/hide their password to confirm what they typed. Shared `PasswordInput` component used across both Profile and Leaderboard auth forms.

## Fix email registration flow (2026-05-31)

### Fixed
- **Email signup stuck on spinner** -- When Supabase email confirmation is enabled, `signUp()` returns a user but no session. The code tried to create a profile against RLS without a session, and never reset the submitting state, leaving the button stuck on "Creating account..." forever.
- **No confirmation feedback** -- After successful email signup, the UI gave no indication that a confirmation email was sent.

### Added
- **"Check your email" screen** -- After email signup, both the Profile page and Leaderboard overlay now show a confirmation screen with the user's email address and instructions to click the confirmation link before signing in.
- **`signUpWithEmail` returns confirmation state** -- The auth context function now returns `{ confirmationRequired: boolean }` so callers can distinguish between auto-confirmed and email-confirmation flows.

## Enhanced stats & leaderboard boards (2026-05-30)

### Fixed
- **Profile page not scrollable** -- `overflow-hidden` on the profile container clipped the activity heatmap below the fold. Changed to `overflow-y-auto` with bottom padding.
- **Heatmap cells invisible** -- empty cells used `bg-bg-elevated` which was nearly indistinguishable from the card background. Added subtle border and bumped active cell opacity levels.

### Added
- **Activity heatmap** -- GitHub-style contribution grid on Profile page showing daily rep counts over 3 months. Color intensity scales with volume. Tap/hover any cell to see exact count and date.
- **Streak tracking** -- Profile shows current streak (consecutive days with >= 1 rep) and longest streak ever. Streak is considered active if last activity was today or yesterday.
- **Today's count** -- Profile card showing how many reps done today.
- **Best session stats** -- Profile shows personal best session (most reps in one DAB flow) with duration and reps/min. Session defined as reps with < 60s gaps.
- **Days active** -- Profile card showing total distinct days with at least one rep.
- **Best Session leaderboard** -- New board tab ranking users by most reps in a single session, with duration and rate.
- **Streak leaderboard** -- New board tab ranking users by longest unbroken daily streak, with active streak indicator.
- **Board type switcher** -- Leaderboard page now has three tabs: Total Reps, Best Session, Streaks. Time period filter only applies to Total Reps board.
- **Real-time profile stats** -- Profile stats refresh on visibility change and via realtime channel with 2s debounce.

### New RPC functions
- `get_user_daily_counts` -- daily rep counts for heatmap
- `get_user_sessions` -- clusters reps into sessions using 60s gap threshold
- `get_user_streaks` -- current and longest streak for a user
- `get_user_stats_summary` -- single call for all profile stats
- `get_best_session_leaderboard` -- best single session per user, ranked
- `get_streak_leaderboard` -- longest streak per user, ranked

### Migration SQL
```sql
-- Run supabase/migrations/005_stats_and_streaks.sql
```

## Guest-first onboarding (2026-05-30)

### Added
- **Guest DAB flow** -- anyone can tap DAB NOW and do burpees without signing up. Anonymous reps insert with `user_id = NULL`, UUIDs tracked in localStorage via new `guestSession.ts` helper.
- **Email auth** -- `signUpWithEmail` and `signInWithEmail` added to AuthContext alongside existing Google OAuth.
- **Leaderboard signup overlay** -- bottom sheet with Google + Email options appears after a guest DABs. Guest's session reps shown as a highlighted row with burnt orange glow at their correct rank position. "Maybe later" dismisses the overlay.
- **Post-signup rep claiming** -- anonymous reps attached to new `user_id` on signup, gender set from guest session picker, localStorage cleared.
- **Inline gender picker** -- after Share/Save on summary screen, guest picks gender then auto-navigates to leaderboard pre-filtered to their gender + Daily.
- **Guest profile CTA** -- Profile tab shows Google + Email sign-in options for unauthenticated users.
- **`guestSession.ts`** -- localStorage helper for tracking anonymous rep IDs, count, gender, and timestamp.

### Changed
- **Home page** -- "DAB NOW" shown for everyone; removed LFG button and sign-in gate.
- **Summary screen** -- hides "YOUR TOTAL" for guests (no lifetime stats without an account).

### Migration SQL
```sql
-- Run supabase/migrations/002_guest_onboarding.sql
```

## Medium-priority audit fixes (2026-05-30)

### Fixed
- **CSS custom property reads on every frame** -- Dab page read `getComputedStyle()` vars each animation frame for the skeleton overlay color. Now cached once on mount.
- **Blob URL leak** -- video recording blob URLs created via `URL.createObjectURL()` were never revoked, leaking memory. Now revoked on cleanup.
- **No catch-all route** -- navigating to an invalid URL showed a blank page. Added `*` route redirecting to Home.
- **Mover count drift** -- `usePeopleMoving` could drift from the true distinct-user count over long sessions. Now caps local set size and re-syncs periodically.

## Security audit fixes (2026-05-30)

### Changed
- **`insert_rep()` RPC with rate limiting** -- direct `INSERT` into `reps` replaced with a server-side function enforcing a 3-second cooldown per user. Prevents spamming the global counter.
- **PKCE auth flow** -- replaced implicit OAuth grant with PKCE (`flowType: 'pkce'`) for stronger token security.
- **Single shared realtime channel** -- `useRepsChannel` hook replaces 3 separate Supabase Realtime subscriptions (home counter, activity feed, mover count) with one shared channel.
- **`get_user_rank()` RPC** -- replaces client-side rank calculation that fetched up to 1000 rows with a server-side query.
- **Avatar upload validation** -- file type and size checked before uploading to Supabase Storage.

### Fixed
- **Hook ordering in Home.tsx** -- `usePeopleMoving` was referenced before declaration in a useEffect dependency, causing inconsistent behavior.

## Codebase hardening from Brutalist audit (2026-05-30)

### Added
- **React ErrorBoundary** wrapping the router in App.tsx — any component render crash now shows a branded recovery screen with a reload button instead of a white screen.
- **`.env.example`** documenting required Supabase env vars for new clones.
- **`get_leaderboard` RPC** — server-side GROUP BY + COUNT + JOIN replaces client-side fetch-all-reps-then-group. Supports gender filtering, time period filtering (using `now()` server time, not client clock), and configurable limit.
- **`get_mover_count` RPC** — `SELECT COUNT(DISTINCT user_id) FROM reps` replaces downloading every rep row to count unique users.

### Fixed
- **Leaderboard fetched ALL reps client-side** — at scale this would download the entire reps table, group in JS, then slice top 50. Now uses `get_leaderboard` RPC that does everything server-side with a `LIMIT 50`.
- **usePeopleMoving fetched ALL reps** to count distinct users — ran on mount, visibility change, AND subscription reconnect. Now calls `get_mover_count` RPC (single integer response).
- **Client-side time for leaderboard cutoffs** — `Date.now()` meant wrong device clock = wrong filters. Cutoffs now computed server-side with `now() - interval`.
- **ActivityFeed profile cache grew unbounded** — preloaded ALL profiles without limit, cache never evicted. Now preloads most recent 200, evicts oldest entry when cache exceeds cap.
- **Duplicate realtime subscriptions** — Home subscribed to reps INSERT via "home-reps", usePeopleMoving separately via "home-movers". Consolidated into one "home-reps" channel with mover updates piped through callbacks.

### Migration SQL
```sql
-- Run supabase/migrations/003_leaderboard_rpc.sql
```

## Tighten burpee detection — anti-cheat (2026-05-30)

### Fixed
- **Squat no longer counts as a rep** — added nose-to-ankle ratio check on front view. The nose must drop to within 40% of standing height above the ankles to register as DOWN. A squat keeps the head too high to pass.
- **Broken-up burpee no longer double-counts** — added `cycleRepCounted` guard so only one rep can be counted per descent cycle (STANDING → down → back up). Bouncing between DOWN and ASCENDING within the same cycle no longer triggers multiple reps.

## Auth flow hardening (2026-05-30)

### Fixed
- **OAuth redirect race condition** — Google sign-in would sometimes return users to Home still logged out. Root cause: `onAuthStateChange` listener wasn't reliably firing before the component mounted on mobile redirect. Replaced the fragile 3-second fallback timer with eager `getSession()` bootstrap that picks up hash tokens immediately.
- **Silent profile creation failure** — `ensureProfile` upsert error was unchecked, so first-time users could end up with a session but no profile (appearing logged out). Upsert errors are now caught and thrown.
- **Gender prompt reappearing after already set** — DB write was fire-and-forget (not awaited), so local state updated but the database still had `gender_set: false`. Next login re-fetched the stale value and showed the prompt again. Now awaits the DB write and only dismisses the prompt on success.

### Changed
- **Memoized AuthContext** — all auth functions wrapped in `useCallback`, context value wrapped in `useMemo` to eliminate cascading re-renders across all `useAuth()` consumers.
- **Removed debug console.logs** from sign-in flow.

## Summary screen polish + video overlay fixes (2026-05-29)

### Changed
- **Action bar fixed position** — Home | Share | Save bar is now `position: fixed` directly above the bottom nav, can't scroll away.
- **Video overlay uses theme accent color** — rep count text in the recorded video now reads the current CSS `--color-accent` (blue when blue theme is active) instead of hardcoded orange.
- **QR code fully visible** — reduced QR from 80px to 64px and expanded bottom bar from 72px to 80px so the QR code sits fully within the bar with padding.

### Fixed
- **CLAUDE.md build plan** — Phases 4 and 5 now correctly marked as Done.

## Fix video preview, audio volume, iOS recording, and share (2026-05-29)

### Fixed
- **Race condition on "I'm Done"** — `setScreen("summary")` triggered useEffect cleanup which killed camera stream tracks while the MediaRecorder was still flushing data, producing an empty blob or hanging forever. Rewrote `handleStop` with strict ordering: stop detection loop → await recorder stop (stream still alive) → tear down camera → transition to summary. The 2s timeout in `recorder.stop()` remains as a safety net for iOS Safari.
- **Video player appeared blank on iOS** — removed forced `aspectRatio: 3/4` and `objectFit: cover` that hid content before metadata loaded. Added `autoPlay`, `muted`, and `preload="auto"` so iOS Safari plays inline immediately.
- **Audio too quiet** — ElevenLabs TTS clips were barely audible. Added a GainNode (3.0x) in the audio pipeline between BufferSource and destination, applied to both cached and fetch-then-play paths in `repAudio.ts`.
- **iOS Safari `onstop` never firing** — added a 2-second timeout in `videoRecorder.ts` that resolves with whatever chunks exist, plus `requestData()` flush before `stop()`. Wrapped recorder stop in try/catch so summary always renders even if recording fails entirely.
- **iOS Photos compatibility** — MediaRecorder now prefers `video/mp4` codec over `video/webm`, since iOS Photos doesn't support WebM files.

### Changed
- **Summary screen redesign** — compact stats row at top (GLOBAL | +REPS | YOUR TOTAL) with dividers, video fills remaining vertical space with natural aspect ratio, three compact pill buttons (Share, Save, Home) in one row pinned above nav bar. Everything fits on one screen without scrolling.
- **SAVE VIDEO → SHARE VIDEO + SAVE TO FILES** — primary button uses Web Share API (`navigator.share({ files })`) which opens the native share sheet on iOS/Android (Save to Photos, Instagram, WhatsApp, AirDrop, etc.). Secondary "SAVE TO FILES" button provides direct download fallback. Supabase stat totals load asynchronously after summary is visible.

## Audio rep counting + branded video recording (2026-05-29)

### Added
- **Audio rep announcements** — each rep triggers a natural spoken number via pre-generated ElevenLabs TTS clips (1–100). Clips preloaded on mount with progressive prefetch as reps increase.
  - `src/lib/repAudio.ts` — audio cache, preloader, and playback
  - `scripts/generate-rep-audio.mjs` — ElevenLabs API batch generator (100 clips, Rachel voice, turbo v2.5 model)
  - `public/audio/rep-*.mp3` — pre-generated audio assets
- **Branded video recording** — full session recorded with video + MediaPipe skeleton overlay + brand overlay composited in real-time on a hidden canvas:
  - REPPS logo (top-left)
  - QR code linking to `repps.pro/?ref=<userId>` (bottom-right)
  - Live rep count display (bottom-left on semi-transparent bar)
  - 1–3 sponsor logo slots (top-right, stacked vertically) — currently empty, ready for sponsor assets
  - `src/lib/videoRecorder.ts` — QR generation, brand overlay renderer, MediaRecorder wrapper, download helper
- **Video preview + save** on summary screen — recorded video plays inline with controls, "SAVE VIDEO" button downloads the file
- Recording starts automatically when calibration completes, stops when user taps "I'm Done"
- Works with both V1 and V2 detection engines

### Dependencies
- `qrcode` — QR code generation for referral links

## V2 Burpee Detection Engine with stability guard + side-view support (2026-05-29)

### Added
- **Detection engine V2** (`src/lib/detectionV2.ts`) — enhanced burpee verification with:
  - **2-second stability guard** — phone must be stationary (centroid drift < 0.015 stddev over 20+ frames) before calibration starts. Prevents accidental reps while placing the phone on the ground.
  - **Automatic camera angle detection** — votes front vs side during calibration by measuring shoulder X-spread, Z-depth difference, and visibility asymmetry. Locks angle for the session.
  - **Side-view joint angle calculations** — hip angle, knee angle, torso angle from vertical for biomechanically precise verification from the side
  - **4-state machine** — `STANDING → DESCENDING → DOWN → ASCENDING → STANDING` replaces simple `HIGH/LOW`, preventing partial movements from counting
  - **minDuration guard** — rejects reps faster than 1.5s (front) or 2s (side) to filter jitter
  - **Angle-specific thresholds** — front (highRatio 0.70, lowRatio 0.50) vs side (highRatio 0.68, lowRatio 0.40)
- **Detection engine V1** (`src/lib/detectionV1.ts`) — original working detection extracted into a standalone class, identical logic preserved

### Changed
- `Dab.tsx` refactored to use pluggable detection engine classes instead of inline logic
- Default engine is V2; admin can force V1 via `?v=1` URL parameter for instant rollback
- Pre-calibration UI shows "Place your phone down / Finding a stable position…" during stability check (V2 only)
- Debug strip shows detected camera angle (front/side) after calibration (V2)
- Tune mode panel shows engine version, camera angle, and side-view joint angles

## Fix gender prompt delay after selection (2026-05-22)

### Fixed
- Selecting a gender on first login had a noticeable delay before dismissing — two sequential network round-trips to Supabase (update + re-fetch) blocked the UI
- Now uses optimistic local state update via new `updateProfile` method — prompt dismisses instantly, DB write fires in the background

## Fix Google OAuth requiring double sign-in (2026-05-22)

### Fixed
- First Google OAuth sign-in appeared to do nothing — user had to press the button a second time to actually log in
- Root cause: `getSession()` and `onAuthStateChange` both fired on OAuth redirect, racing two concurrent `ensureProfile()` calls. With `ignoreDuplicates: true`, the second upsert silently returned zero rows, causing `.select().single()` to throw `PGRST116`, leaving profile as null
- Split upsert from select in `ensureProfile` — upsert fires first, then a separate fetch always finds the row regardless of race outcome
- Made `onAuthStateChange` the single source of truth for auth events, eliminating the duplicate `loadProfile` call

## Home layout polish — stat order, CTA copy, video sizing (2026-05-22)

### Changed
- Reordered stat columns to GBT | TARGET | TPM — target countdown now center-stage
- Added info icon (ⓘ) next to TPM with "Total People Moving" tooltip
- Added "Be the one to drop a Burpee" tagline above LFG button for unauthenticated users
- Video thumbnail sized to 13.2rem (slightly wider than LFG button) and centered with bottom padding to clear nav bar
- Enlarged video play button 50% (3rem → 4.5rem circle, icon 1.25rem → 2rem) for better visibility
- Non-scrollable pages now reserve 68px bottom padding to clear the fixed nav bar, preventing content from hiding behind it
- Added mascot overlays on CTA buttons — LFG mascot bottom-left, DAB mascot top-right, with pointer-events passthrough
- Added accent-colored glow shadow and gentle breathing pulse animation (2.5s loop) to LFG and DAB NOW buttons
- Removed duplicate "Be The One to Drop a Burpee" text above LFG button to free vertical space
- DAB pose outline made more visible — brighter stroke color (#C8CCD2), thicker lines (3px), higher opacity
- "I'm Done" button restyled with accent background, glow shadow, and pulse animation
- Profile sign-in button given same glow + pulse treatment as Home CTA buttons
- Added leaderboard mascot to top-right of GBT header on Leaderboard page
- Added `.vercel` to `.gitignore`

## Three-stat dashboard + milestone countdown (2026-05-22)

### Changed
- Home hero section redesigned from single centered counter to three-column stat grid:
  - **GBT** — Global Burpee Total (gradient text, animated)
  - **TPM** — Total People Moving with live distinct-user count and "(of 1M)" subtitle
  - **TARGET** — current milestone target (1,000 by May 31) with countdown timer
- Progress bar moved below stat row, now shows milestone completion percentage inline
- Removed settings table fetch from Home (milestone hardcoded for hackathon demo)

### Added
- `usePeopleMoving` hook (`src/hooks/usePeopleMoving.ts`) — fetches distinct user count from `reps` table, maintains a `Set<user_id>` for O(1) dedup on Realtime INSERTs, re-syncs on visibility change and Realtime reconnect

## Fix stats disappearing + theme not updating live (2026-05-22)

### Fixed
- Stats (GBT counter, settings, profile reps) would disappear and require multiple reloads — caused by silent fetch failures with no retry, state resetting to 0 on navigation, and stale realtime connections after phone sleep
- Theme changes in Supabase Studio required a full page reload to take effect

### Changed
- Home page stats use module-level cache — navigating away and back never flashes "0"
- Added `visibilitychange` listener on Home and Profile — refetches from DB whenever the app returns to foreground (phone wake, tab switch)
- Realtime `home-reps` channel refetches true count on (re)subscribe to catch events missed during disconnection
- Exponential backoff retry on all stat fetches (2s → 4s → 6s, capped at 10s)
- ActivityFeed realtime subscription stabilized — moved all logic inside a single `useEffect([])` to prevent repeated unsubscribe/resubscribe cycles that destabilized the websocket
- ThemeContext subscribes to realtime Postgres changes on `settings` table (filtered to `key=theme`) for instant theme switching without reload

## YouTube intro video on Home + Dab UX polish (2026-05-22)

### Added
- YouTube intro video embed on Home page — thumbnail sits at bottom of page above nav, expands to full-screen overlay on tap with autoplay, tap backdrop to dismiss
- `YouTubeEmbed` component with thumbnail/expanded toggle, play button overlay, and dark backdrop

### Changed
- Home page spacing tightened to fit video thumbnail without scrolling
- Dab page "DONE" button replaced with floating circular "I'm Done" button overlaid top-right of camera area (saves vertical space, always accessible)
- Dab progress bar widened (32→80%) and thicker (4px→12px) for better visibility

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
