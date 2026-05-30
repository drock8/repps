# REPPs

**AI-verified social burpee tracker.** Do a burpee in front of your phone, get it counted by computer vision, and contribute to a global movement counter visible to everyone in real time.

*Micro-effort. Macro momentum.*

Built for the Healthiest Hacker / muShanghai Longevity / Norther Lab hackathon (Shanghai, May 2026). REPPs is the first product in the planned **Livv** suite.

## What it does

- **AI burpee detection** -- MediaPipe pose estimation validates each rep through a full HIGH-LOW-HIGH body cycle
- **Global counter** -- every verified rep feeds a live Total Global Burpees count targeting 1M by end of 2026
- **Real-time activity feed** -- floating bubbles show reps happening worldwide as they happen via Supabase Realtime
- **Leaderboards** -- filterable by gender (Female / Male / Non-binary) and time period (Daily / Weekly / Monthly / Yearly / All-time), computed server-side
- **Branded video recording** -- sessions are recorded with a skeleton overlay, rep counter, logo, and QR code composited in real-time
- **Audio rep counting** -- natural spoken numbers on each rep via pre-generated TTS clips

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 3 |
| Routing | React Router DOM 7 |
| Backend | Supabase (Auth, Postgres, Realtime, RLS) |
| Vision | MediaPipe Tasks Vision (Pose Landmarker Lite, CPU) |
| Auth | Google OAuth |
| Deploy | Vercel |

## Getting started

### Prerequisites

- Node.js 18+
- A Supabase project with the required tables and RLS policies (see [Database](#database) below)
- Google OAuth configured in Supabase Auth

### Setup

```bash
git clone https://github.com/drock8/repps.git
cd repps
npm install
cp .env.example .env   # then fill in your Supabase credentials
npm run dev
```

### Environment variables

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Mobile testing

Camera access requires HTTPS. For local mobile testing:

```bash
npm run dev -- --host
ngrok http 5173
```

Use the ngrok HTTPS URL on your phone.

## Database

Three tables in Supabase:

- **profiles** -- extends `auth.users` with name, gender, avatar
- **reps** -- one row per validated burpee, linked to user
- **settings** -- admin-managed key/value pairs (global target, target date, etc.)

Migrations live in `supabase/migrations/`. Run them in order against your Supabase project via the SQL editor.

RLS is enforced: anyone can read, only authenticated users can write their own data.

## Project structure

```
src/
  pages/          Home, Dab (camera + detection), Leaderboard, Profile
  components/     BottomNav, ActivityFeed, ErrorBoundary, GenderPrompt, Layout
  lib/            Supabase client, video recorder, audio, guest session utils
  hooks/          Realtime subscriptions, auth context
public/
  audio/          Pre-generated TTS clips (1-100)
  *.png           App icons, logos, mascots
supabase/
  migrations/     SQL migration files
```

## License

Private. All rights reserved.
