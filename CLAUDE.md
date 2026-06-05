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

1. **`docs/APP_SPEC.md`** — the canonical specification for v0.1 (what we're building this weekend). Read this when you need to know what to build or how something should behave.
2. **`docs/BRAND_SPEC.md`** — visual identity, design tokens, typography, motion. Read this when you need to know how something should look.

If anything in this file contradicts those two, those win — they're more detailed and canonical.

## The build plan (where we are)

v0.1 (core app) and v0.2 (teams + events + social) are complete. Now in v0.3 territory — growth, competition, and polish.

| Phase | What | Status |
|---|---|---|
| 1–6 | v0.1 — core app (auth, home, DAB flow, feed, leaderboard, profile) | **Done** |
| 7 | DB foundation — teams, team_member_history, team_messages, nudges tables | **Done** |
| 8 | Team CRUD RPCs — create, join, leave, captain succession, join codes | **Done** |
| 9 | Team UI — create flow, invite, join route, team detail page | **Done** |
| 10 | Scoring engine — `calculate_user_rep_score` with 4 stacking multipliers | **Done** |
| 11 | Leaderboard expansion — Rep Score + Team Score boards, profile points | **Done** |
| 12 | Team social — preset chat, nudge system, member history | **Done** |
| 13 | Events DB — events, event_participants, event_results, storage, RLS | **Done** |
| 14 | Event RPCs — create, join, leave, leaderboard, progress, complete, feature | **Done** |
| 15 | Events Hub UI + Event Detail — browse, view, leaderboard, QR, share | **Done** |
| 16 | Create Event Flow + Join Route — multi-step form, banner upload, deep link | **Done** |
| 17 | Home Integration + Event Management — featured event, organizer controls | **Done** |
| 18 | Reward Engine — bonus_points table, profile completion rewards (DOB, nationality) | **Done** |
| 19 | Referral Sparks — referral codes, /r/:code route, 11+4 pts, QR share | **Done** |
| 20 | Social Messaging — DMs, nudge, public profiles, inbox, conversations | **Done** |
| 21 | Leaderboard v2 — 3D system (scope × metric × filter), consistency, rhythm heatmap | **Done** |
| 22 | Guest flow + landing polish — guest sessions, claim-spot, rotating headlines | **Done** |
| — | Live Competition Dashboard (COMPETITION_SPEC.md) | **Planned** |
| — | Tiered Teams (Duos/Trios/Squads up to 6, GROWTH_SPEC.md) | **Planned** |
| — | Audio Coaching v2 (COACHING_SPEC.md enhancements) | **Planned** |

**Current state: 22 phases shipped. The app is feature-complete for demo and early users.**

## Pre-existing files — do not delete or break

- `src/lib/supabase.ts` — working Supabase client, reads from `.env`
- `src/PoseTest.tsx` — early MediaPipe burpee detector (V1 state machine). Preserved for reference.
- `.env` — has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Don't touch.

## The Supabase backend

### Core tables

**profiles** — extends `auth.users`
- `id`, `name`, `gender`, `avatar_url`, `created_at`
- `team_id` (nullable FK), `team_joined_at`
- `referral_code` (unique 6-char), `dob`, `nationality_code`, `nationality_name`

**reps** — every validated burpee
- `id`, `user_id`, `exercise_type` (default 'burpee'), `validated_at`

**settings** — admin key-value store
- `key` (PK), `value`, `updated_at`

### Team tables
- `teams` — id, name, join_code, captain_id, status (forming/active/disbanded)
- `team_member_history` — join/leave/promotion events
- `team_messages` — preset message chat (Realtime enabled)
- `nudges` — rate-limited daily nudges

### Events tables
- `events` — 6 competition modes, scoring, visibility, lifecycle status
- `event_participants` — user/team enrollment
- `event_results` — final scores and rankings

### Social / Growth tables
- `referrals` — referrer tracking with status progression
- `bonus_points` — reward engine (profile completion, referral sparks, achievements)
- `conversations` / `conversation_participants` / `messages` — DM and team chat
- `blocks` — user blocking

### Storage
- `event-banners` bucket (public read, authenticated write)

Realtime is enabled on `reps`, `team_messages`, `messages`.

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

## Things explicitly out of scope (deferred)

- Live competition spectator dashboard (COMPETITION_SPEC.md — planned)
- Tiered teams beyond 3 members (GROWTH_SPEC.md — planned)
- Multi-exercise selection (architecture supports it, but UI is burpee-only)
- Side-view camera support
- Audio clap detection
- Form scoring / difficulty tiers in UI
- Face verification / anti-cheat
- "How to do a burpee" tutorial
- Timezone-aware day boundaries (server uses UTC — see MEMORY)
- Video streaming for competitions (LiveKit — v2 feature)
- Free-text messaging (preset-only for now, no moderation burden)

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

*Last updated: June 5, 2026. 22 phases shipped, app feature-complete for demo/pitch.*
