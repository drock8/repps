# CLAUDE.md — REPPs

> Context for Claude Code. Read this first every session.

## What this project is

**REPPs** is an AI-verified social burpee app built for a 24-hour hackathon (Healthiest Hacker / muShanghai Longevity / Norther Lab, Shanghai, May 21-22 2026).

The hook: **"Can we get 11 people in this room to do 1 burpee right now?"**
The bigger vision: **"Make daily movement socially contagious."**
The product tagline: **"Micro-effort. Macro momentum."**

It's the first product in a planned suite called Livv (sibling apps: Clikk, Stakk, Signall, Drafft, Flokk, etc.).

## The user

Solo founder Derrick (drock8). Lives in browser-first PWAs on Supabase + Vite + React + TypeScript + Tailwind. Works with Claude Code as primary collaborator. Brand palette: warm bone, deep graphite, burnt orange.

## Where the project lives

- Local: `~/code/Sandbox/Hackathons/repps`
- Domain: `repps.pro` (registered, not yet pointed)
- GitHub: not yet pushed
- Deploy target: Vercel
- Supabase project: `repps` (Northeast Asia / Tokyo region)

## Always reference these two companion docs before making decisions

1. **`APP_SPEC.md`** — the canonical specification for v0.1 (what we're building this weekend). Read this when you need to know what to build or how something should behave.
2. **`BRAND_SPEC.md`** — visual identity, design tokens, typography, motion. Read this when you need to know how something should look.

If anything in this file contradicts those two, those win — they're more detailed and canonical.

## The build plan (where we are)

v0.1 shipped in 6 phases (all complete). Now building v0.2 — the team system.

| Phase | What | Status |
|---|---|---|
| 1–6 | v0.1 — core app (auth, home, DAB flow, feed, leaderboard, profile) | **Done** |
| 7 | DB foundation — `teams`, `team_member_history`, `team_messages`, `nudges` tables, `profiles` additions, admin settings rows, RLS policies | **Done** |
| 8 | Team CRUD RPCs — `create_team`, `join_team`, `leave_team` (with double-confirm + replacement grace), captain succession, join code generation | **Done** |
| 9 | Team UI — create team flow, invite via Web Share API, `/team/join/{code}` route, team detail page with member list + daily/weekly progress + team streak | **Done** |
| 10 | Scoring engine — `calculate_user_rep_score` RPC with all 4 multipliers (daily 3x, weekly 2x, individual streak +1→+11, team streak +3→+33) | **Done** |
| 11 | Leaderboard expansion — Rep Score + Team Rep Score board types, points display on profile + home, team progress indicator on home | **Done** |
| 12 | Team social — preset message chat (6 options) + nudge (push notification with in-app fallback), member history timeline on team page | Planned |

**Currently: Phase 10 ready to build.**

### Phase details

**Phase 7 — DB foundation**
- Create `teams` table (id, name, join_code, captain_id, status, created_at)
- Create `team_member_history` table (team_id, user_id, event, created_at)
- Create `team_messages` table (team_id, user_id, message_key, created_at)
- Create `nudges` table (team_id, sender_id, recipient_id, nudged_on, created_at) with unique constraint
- Add `team_id` (nullable FK) and `team_joined_at` to `profiles`
- Seed admin settings: `team_daily_target=5`, `team_daily_multiplier=3`, `team_weekly_days_required=5`, `team_weekly_multiplier=2`, `streak_bonus_base=1`, `streak_bonus_cap=11`, `streak_escalation_interval=10`, `team_streak_bonus_base=3`, `team_streak_bonus_cap=33`
- RLS policies: public read on teams, team members read their own messages/history
- Enable Realtime on `team_messages`
- **Verify:** tables exist, RLS works, settings seeded

**Phase 8 — Team CRUD RPCs**
- `create_team(p_name)` — validate name 3–24 chars, generate 6-char join code, create team, set captain, update profile team_id, log history
- `join_team(p_join_code)` — validate team exists + has space + user has no team, add member, log history, auto-set status to 'active' when 3rd member joins
- `leave_team()` — remove user from team, log history, handle captain succession (longest-tenured member), revert to 'forming' or 'disbanded'
- Replacement grace logic: team streak preserved if new member joins + hits target same calendar day
- **Verify:** create/join/leave cycle works via Supabase Studio, history logged, captain succession works

**Phase 9 — Team UI**
- "Create Team" flow (name input → team created → invite screen)
- Team detail page at `/team` — members, daily progress per member, weekly progress, team streak counter, invite button (captain, when forming)
- Share invite: Web Share API with message template, copy-to-clipboard fallback
- `/team/join/{code}` route — join confirmation, full-team handling, already-on-team handling
- "Leave team" with double confirmation (type "leave")
- Bottom nav or profile link to team page
- **Verify:** full create → invite → join → leave flow on device

**Phase 10 — Scoring engine**
- `calculate_user_rep_score(p_user_id, p_period)` RPC implementing full formula:
  - Base: 1 point per burpee
  - Daily 3x: when all 3 team members hit target
  - Weekly 2x: when all 3 hit target 5/7 days (stacks on daily 3x)
  - Individual streak: `min(11, floor((streak_day - 1) / 10) + 1)`
  - Team streak: `min(33, (floor((team_streak_day - 1) / 10) + 1) × 3)`
- `get_team_streak(p_team_id)` — current and longest team streak
- Read all multiplier values from `settings` table (admin-adjustable)
- **Verify:** manual test with known data against the worked example in APP_SPEC.md (150 burpees over 30 days with perfect team = 1,854 points per member)

**Phase 11 — Leaderboard expansion**
- Add "Rep Score" board type (individual, filtered by gender × time period)
- Add "Team Score" board type (filtered by time period only, shows team name + combined score)
- Team leaderboard rows tappable to see member breakdown
- Points display on Profile page (Rep Score + streak info)
- Team daily progress indicator on Home screen (member avatars with checkmarks)
- **Verify:** all 5 board types work, team board ranks correctly, profile shows points

**Phase 12 — Team social**
- Preset message chat on team page (6 messages, Supabase Realtime, message feed with avatars + timestamps)
- Nudge button: push notification via service worker + in-app fallback badge
- Rate limiting: 1 nudge per sender per recipient per day
- Member history timeline tab on team page
- Push notification permission prompt (on team join or first nudge attempt)
- **Verify:** preset messages appear in real-time for all team members, nudge triggers notification, history shows join/leave events

## Pre-existing files — do not delete or break

- `src/lib/supabase.ts` — working Supabase client, reads from `.env`
- `src/PoseTest.tsx` — working MediaPipe burpee detector with state machine (HIGH → LOW → HIGH). Will be incorporated into the DAB flow in Phase C. Don't include it in routing yet but don't delete it either.
- `.env` — has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Don't touch.

## The Supabase backend (already set up)

Three tables:

**profiles** — extends `auth.users`
- `id` (uuid, FK to auth.users, on delete cascade)
- `name` (text, not null)
- `gender` (text, check constraint: 'female' | 'male' | 'non_binary' | 'unspecified', default 'unspecified')
- `avatar_url` (text, nullable)
- `created_at` (timestamptz, default now())

**reps** — every validated burpee
- `id` (uuid, default gen_random_uuid())
- `user_id` (uuid, FK to profiles, not null, on delete cascade)
- `exercise_type` (text, default 'burpee') — leaves room for future exercises
- `validated_at` (timestamptz, default now())

**settings** — admin-managed via Supabase Studio
- `key` (text, primary key)
- `value` (text, not null)
- `updated_at` (timestamptz, default now())

Seeded with: `global_target=1000000`, `target_date=2026-12-31`, `target_label='1M burpees by Dec 31, 2026'`.

RLS policies:
- Profiles: anyone reads, only owner writes
- Reps: anyone reads, authenticated users insert own
- Settings: anyone reads, no public write

Realtime is enabled on `reps`.

## Tech stack (locked)

- **React 18+** with TypeScript
- **Vite** (NOT Next.js — env vars must use `VITE_` prefix, not `NEXT_PUBLIC_`)
- **Tailwind CSS 3** with custom config
- **React Router DOM** for navigation
- **Supabase JS client** for auth, DB, and realtime
- **MediaPipe Tasks Vision** for pose detection (Pose Landmarker Lite, CPU delegate)
- **Inter font** loaded via `https://rsms.me/inter/inter.css`

## How we work together

- **Build in phases, in order.** Don't skip ahead.
- **At the end of each phase, summarize what changed and what to verify manually.** Don't auto-start the next phase.
- **Match the brand and design spec exactly.** If a color or typography choice isn't in `BRAND_SPEC.md`, ask before improvising.
- **Mobile-first.** The demo runs on phones. Layouts max-width is `28rem` (Tailwind `max-w-md`).
- **Apple-influenced minimalism.** Subtle motion, generous whitespace, restrained color, large tap targets (min 44px), no boxes-within-boxes.
- **Never add features not in `APP_SPEC.md` v0.1.** If it feels like a good idea, add it to the v0.2 backlog comment in the code and move on.

## Things explicitly out of scope for v0.1

These have been discussed but are deferred. If you find yourself wanting to add any of these, stop — they're v0.2:

- Teams, team scoring, team leaderboards
- Achievements / badges
- Multi-exercise selection (architecture supports it, but UI is burpee-only for v0.1)
- Side-view camera support
- Audio clap detection
- Form scoring
- Strict-mode multi-phase detection
- Streaks
- Friend system
- Notifications
- Face verification / anti-cheat
- Public landing page (we use Google OAuth signup for v0.1)
- Admin UI (admin uses Supabase Studio directly)
- "How to do a burpee" tutorial
- Timezone-aware tie-breaking on leaderboard

## Operational notes

- The user runs Vite via `npm run dev -- --host` to expose the network
- iOS Safari testing happens via ngrok: `ngrok http 5173` produces an HTTPS URL needed for camera access
- `vite.config.ts` has `server.allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io']` already configured
- The user's authtoken is in their local ngrok config
- Bedside laptop tested working; the demo will run from phones at the venue

## Communication style

- Be direct and concise. The user is in active build mode with limited time.
- When proposing a tradeoff, give a recommendation, not just options.
- When the user is wrong about something, push back with reasoning rather than acquiescing.
- When you finish a task, briefly state what changed and what to verify. Don't auto-continue to the next thing.
- Don't add commentary or explanations to generated code unless asked.

---

*Last updated: hour 6 of the 24-hour build, ~2:30pm Shanghai time, May 21 2026.*
