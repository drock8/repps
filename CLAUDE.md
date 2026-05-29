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

We're building in 6 phases. Phase A is the foundation; D is the hero demo moment; F ships.

| Phase | What | Status |
|---|---|---|
| 1 | Design foundation + routing + auth context + profile auto-create + bottom nav | **Done** |
| 2 | HOME screen — live Total Global Burpees from DB, target progress, DAB NOW / JOIN states | **Done** |
| 3 | DAB NOW flow — camera + pose detection writing reps to DB + session summary | **Done** |
| 4 | Live activity feed + floating bubble animations on HOME | **Done** |
| 5 | LEADERBOARD page — Female/Male/Non-binary × Day/Week/Month/Year/All filtering | **Done** |
| 6 | PROFILE + first-login gender prompt + Vercel deploy + poster + README | **Done** |

**All phases complete.**

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
