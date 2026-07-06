# COMPETITION_SPEC.md — REPPs Live Competition Dashboard

> Canonical specification for the live competition system. A standalone spectator experience designed for large displays (TVs, projectors), with an admin control surface for organizers. Builds on the existing events infrastructure (Phases 13–16) but adds real-time competition orchestration, a big-screen dashboard, and competition-specific team management.

---

## 1. Product overview

### What it is

A full-screen, real-time competition dashboard that turns REPPs events into live spectator experiences. Think esports broadcast meets fitness competition. Designed for 50–65" TVs and projectors at 1920x1080 (16:9).

### The experience

An organizer creates a competition, opens the join window, and displays the dashboard URL on a big screen. Participants join from their phones — their cards animate onto the screen in real time. When the organizer closes entries and hits "Go," a 3-2-1 countdown fires with audio, and every burpee from every participant updates the dashboard live. When time runs out (or a target is hit), the screen freezes, darkens, and a podium ceremony plays out.

### Key URLs

| Route | Purpose | Audience |
|---|---|---|
| `/compete/:joinCode` | Competition entry point (QR code / share link lands here) | New and existing users |
| `/live/:eventId` | Spectator dashboard (the big screen) | Public or authenticated (organizer chooses) |
| `/live/:eventId/admin` | Organizer control panel | Authenticated organizer only |
| `/events/:eventId` | Existing event detail page (participants use this) | All users |

The dashboard is **not part of the main app navigation**. No bottom nav, no mobile layout constraints. It's a dedicated landscape experience.

The `/compete/:joinCode` route is the primary entry point for competitions. It handles auth (new user registration or existing user sign-in), profile completion, and competition entry in a single streamlined flow. The QR code displayed at venues and shared via links always points here.

---

## 2. Profile additions (core, not competition-specific)

These fields are added to the `profiles` table for all users, not just competition participants.

### New profile fields

| Field | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `nationality` | text | ISO 3166-1 alpha-2 code, nullable | null | For flag display. e.g., 'CN', 'US', 'GB' |
| `date_of_birth` | date | nullable, must be in the past | null | For age-group categories. Not displayed publicly — only used to derive age bracket |
| `city` | text | nullable, max 100 chars | null | For location display on dashboard |
| `country` | text | ISO 3166-1 alpha-2 code, nullable | null | Residence country (may differ from nationality) |

### Existing user migration

Users who signed up before these fields were added will have null values. Two approaches to backfill:

1. **Passive**: Show a "Complete your profile" prompt on the Profile page when any of these fields are null. Non-blocking — users can dismiss it.
2. **Active (competition entry)**: When joining a competition, require these fields if the competition has age-group or location-based categories enabled. A pre-join form collects the missing data and saves it to their profile.

### Age bracket derivation

Age brackets are derived from `date_of_birth` at query time, not stored:

| Bracket | Range |
|---|---|
| Under 18 | < 18 |
| 18–29 | 18–29 |
| 30–39 | 30–39 |
| 40–49 | 40–49 |
| 50–59 | 50–59 |
| 60+ | >= 60 |

---

## 3. Competition-specific database schema

Competitions use **separate tables** from the existing app team system. Competition teams are ephemeral — they exist only for the duration of a competition and can have variable sizes (1–5 members). The existing `teams` table and persistent team memberships are unaffected.

### New tables

#### `competition_teams`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `event_id` | uuid | FK to events, NOT NULL, ON DELETE CASCADE | |
| `name` | text | NOT NULL, 3–24 chars | |
| `created_by` | uuid | FK to profiles, NOT NULL | Team creator |
| `created_at` | timestamptz | default now() | |

Indexes: `(event_id)`, `(event_id, name)` unique.

#### `competition_participants`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `event_id` | uuid | FK to events, NOT NULL, ON DELETE CASCADE | |
| `user_id` | uuid | FK to profiles, NOT NULL, ON DELETE CASCADE | |
| `competition_team_id` | uuid | FK to competition_teams, nullable, ON DELETE SET NULL | null = individual entry |
| `status` | text | NOT NULL, default 'joined' | 'joined' / 'camera_ready' / 'live' / 'withdrawn' |
| `joined_at` | timestamptz | default now() | |
| `entry_type` | text | NOT NULL, default 'individual' | 'individual' / 'existing_team' / 'new_team' |

UNIQUE constraint: `(event_id, user_id)`.

Indexes: `(event_id)`, `(event_id, competition_team_id)`, `(user_id)`.

#### `competition_reps`

Competition reps are **dual-written**: they go into both the existing `reps` table (for the global total) AND this table (for competition-specific tracking with additional metadata).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `event_id` | uuid | FK to events, NOT NULL, ON DELETE CASCADE | |
| `user_id` | uuid | FK to profiles, NOT NULL, ON DELETE CASCADE | |
| `rep_id` | uuid | FK to reps, NOT NULL | Link to the canonical rep record |
| `qualified` | boolean | NOT NULL, default true | false = AI rejected this rep |
| `rejection_reason` | text | nullable | 'incomplete_down' / 'incomplete_up' / 'too_slow' / 'no_jump' / null |
| `bpm_at_time` | numeric(5,2) | nullable | Rolling BPM at the moment this rep was recorded |
| `created_at` | timestamptz | default now() | |

Indexes: `(event_id, user_id)`, `(event_id, qualified)`.

#### `competition_settings`

Per-competition configuration set by the organizer during creation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `event_id` | uuid | PK, FK to events, ON DELETE CASCADE | |
| `team_size` | integer | NOT NULL, default 3, CHECK 1–5 | 1 = individual-only competition |
| `duration_seconds` | integer | nullable | Fixed timer. null = target-based |
| `target_reps` | integer | nullable | Target-based. null = timer-based |
| `target_type` | text | NOT NULL, default 'timer' | 'timer' / 'target' |
| `join_window_mode` | text | NOT NULL, default 'manual' | 'manual' (organizer opens/closes) / 'timed' (auto-close at time) |
| `join_window_minutes` | integer | nullable | For 'timed' mode: minutes before start |
| `join_cutoff_at` | timestamptz | nullable | For 'timed' mode: hard cutoff time |
| `allow_individual` | boolean | NOT NULL, default true | Can players enter without a team? |
| `allow_new_teams` | boolean | NOT NULL, default true | Can players form new teams for this competition? |
| `allow_existing_teams` | boolean | NOT NULL, default true | Can players enter with their app team? |
| `dashboard_public` | boolean | NOT NULL, default true | false = only authenticated users can view the dashboard |
| `show_video` | boolean | NOT NULL, default false | v2: enable live video thumbnails via WebRTC |
| `winner_categories` | jsonb | NOT NULL, default '["overall"]' | Array of enabled category keys |
| `custom_categories` | jsonb | NOT NULL, default '[]' | Array of custom category definitions |
| `crowd_vote_enabled` | boolean | NOT NULL, default false | Enable the popular vote / audio meter feature |
| `auto_match_orphans` | boolean | NOT NULL, default true | Auto-group players whose teammates didn't show |
| `orphan_match_minutes` | integer | NOT NULL, default 3 | Minutes before start to trigger orphan matching |

### Winner category system

Categories are identified by string keys. The organizer selects which to enable.

**Built-in categories:**

| Key | Label | Grouping | Notes |
|---|---|---|---|
| `overall` | Overall | None | Top individual(s) regardless of demographics |
| `team` | Best Team | By competition team | Total team reps / score |
| `male` | Top Male | gender = 'male' | |
| `female` | Top Female | gender = 'female' | |
| `non_binary` | Top Non-Binary | gender = 'non_binary' | |
| `age_under_18` | Under 18 | DOB-derived bracket | |
| `age_18_29` | 18–29 | DOB-derived bracket | |
| `age_30_39` | 30–39 | DOB-derived bracket | |
| `age_40_49` | 40–49 | DOB-derived bracket | |
| `age_50_59` | 50–59 | DOB-derived bracket | |
| `age_60_plus` | 60+ | DOB-derived bracket | |
| `crowd_favorite` | Crowd Favorite | Audio meter vote | Only if crowd_vote_enabled |

**Custom categories** are defined as objects in the `custom_categories` jsonb array:

```json
{
  "key": "women_30_39",
  "label": "Women 30–39",
  "filters": {
    "gender": "female",
    "age_bracket": "30_39"
  }
}
```

Filters can combine: `gender`, `age_bracket`, `nationality`, `city`. This allows arbitrary intersections like "Men over 50 from Shanghai."

---

## 4. Competition lifecycle

### States

The competition lifecycle extends the existing event `status` field with a more granular state machine managed via the `competition_settings` and real-time state.

```
DRAFT → ANNOUNCED → JOIN_OPEN → JOIN_CLOSED → COUNTDOWN → LIVE → FINISHED → RESULTS
```

| State | What's happening | Dashboard shows | Admin can do |
|---|---|---|---|
| `DRAFT` | Organizer is configuring | Nothing (not accessible) | Edit settings |
| `ANNOUNCED` | Published, not yet open | "Coming soon" splash | Edit settings, open join window |
| `JOIN_OPEN` | Join window is open | Pre-lobby: participants appearing | Close join window, start countdown |
| `JOIN_CLOSED` | Entries locked, waiting for start | Pre-lobby: all participants shown, "Ready" | Start countdown, re-open join window |
| `COUNTDOWN` | 3-2-1-GO sequence playing | Countdown overlay with audio | Cancel (reverts to JOIN_CLOSED) |
| `LIVE` | Competition in progress | Main dashboard with live metrics | Emergency stop |
| `FINISHED` | Time's up or target hit | Frozen dashboard with flash | Trigger results ceremony |
| `RESULTS` | Ceremony playing | Podium overlay, category winners | Dismiss, archive |

State transitions are managed by the organizer via the admin panel (phone or overlay), except:
- `LIVE → FINISHED`: automatic when timer hits 0 or target is reached
- `ANNOUNCED → JOIN_OPEN`: automatic if `join_window_mode = 'timed'` and the window time arrives

### Join flow (participant side)

The join flow handles two types of users: **existing REPPs users** (already registered) and **new users** (never used the app). Both arrive via the same entry point — a QR code scanned at the venue, a share link tapped, or browsing the Events Hub. The goal is to get a brand-new user from scan to competition entry in under 60 seconds.

#### Entry point URL

All competition entry flows start at one URL:

```
repps.pro/compete/:joinCode
```

This is distinct from the existing `/events/join/:code` route. The `/compete` route is purpose-built for the competition flow and handles auth, onboarding, and entry in a single streamlined sequence.

#### Flow for new users (not registered)

```
Scan QR / tap link
→ /compete/:joinCode
→ Competition splash screen (event name, banner, start time, "Join this competition")
→ Tap "Join" → Google OAuth sign-in
→ Quick onboarding form (single screen):
    • Name (pre-filled from Google)
    • Gender (4 options — required for leaderboard)
    • Nationality (country picker with flag preview — required)
    • Date of birth (date picker — required if age categories enabled, optional otherwise)
    • City (text input — optional)
→ Entry type selection (see below)
→ Entered. Dashboard shows their card.
```

The quick onboarding form replaces the normal first-login gender-only prompt. It collects everything needed for the competition in one shot. All fields save to the user's `profiles` record so they never have to enter them again.

**Design principle:** No friction that doesn't serve the competition. Name and gender are always required (existing v0.1 behavior). Nationality is required because the dashboard shows flags. DOB is required only if the competition has age-group categories. City is always optional.

#### Flow for existing users (already registered)

```
Scan QR / tap link
→ /compete/:joinCode
→ Competition splash screen (event name, banner, start time, "Join this competition")
→ Tap "Join" → Already authenticated (skip OAuth)
→ Profile completeness check:
    • If missing required fields (nationality, and DOB if age categories enabled):
      → Show a short "Complete your profile" form with only the missing fields
    • If profile is complete: skip straight to entry type selection
→ Entry type selection (see below)
→ Entered. Dashboard shows their card.
```

#### Entry type selection

After auth and profile are complete, the user chooses how to enter:

1. **"Enter with [Team Name]"** (if they have an existing app team and `allow_existing_teams` is true)
   - All team members are notified (in-app)
   - If teammates don't join within `orphan_match_minutes` of the competition start, the participant is prompted: "Your teammates haven't joined. Would you like to be auto-matched with other players, or enter individually?"
   - Auto-match groups orphaned players by available slot count
2. **"Create a competition team"** (if `allow_new_teams` is true)
   - Enter a team name (3–24 chars)
   - Share a join link / QR code with friends at the venue
   - Friends tap the link → join that competition team directly
3. **"Enter individually"** (if `allow_individual` is true)
   - Placed in an "Individuals" pool
   - If team_size > 1 and auto_match_orphans is true: may be grouped into an ad-hoc team before competition starts

If only one entry type is available (e.g., individual-only competition), skip the selection screen entirely.

#### Profile data requirements by competition configuration

| Competition has... | Required fields | Optional fields |
|---|---|---|
| No special categories | name, gender, nationality | DOB, city |
| Age-group categories | name, gender, nationality, DOB | city |
| Location categories | name, gender, nationality, city | DOB |
| Both age + location | name, gender, nationality, DOB, city | — |

#### Competition splash screen design

The splash screen is the first thing a user sees after scanning the QR code. It must communicate immediately what's happening and make the action obvious.

```
┌─────────────────────────────────────────┐
│                                         │
│  [Event Banner Image — full width]      │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                         │
│  REPPS LIVE                             │
│  [Event Name]                           │
│                                         │
│  📅 Starting in 4 minutes               │
│  👥 12 participants joined              │
│  🏆 Teams of 3 · 5 min competition     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         JOIN NOW  ⚡            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Already have an account? Sign in       │
│                                         │
└─────────────────────────────────────────┘
```

- **"JOIN NOW"** triggers Google OAuth for new users, or goes straight to entry type selection for existing users
- **"Already have an account? Sign in"** is the same OAuth flow (UX cue, not a different path) — mirrors the existing Home page pattern
- If the join window is closed: the button says "Entries closed" (disabled) and shows "Watch live →" linking to the dashboard
- If the competition is finished: show results summary instead

### Status progression (per participant)

```
JOINED → CAMERA_READY → LIVE
```

- `JOINED`: User has entered the competition. Their card appears on the dashboard with a pulsing "Joining..." indicator.
- `CAMERA_READY`: User has opened the DAB flow and the camera + pose detector is initialized. Dashboard card shows a green "Ready" badge. (v2: video stream connected to SFU.)
- `LIVE`: Competition has started and the user is actively doing reps. Dashboard card shows live metrics.

Status updates are pushed to the `competition_participants` table via Supabase Realtime. The app updates the participant's status as they progress through the flow.

---

## 5. Dashboard design — Pre-lobby ("Ready to Rumble")

Displayed during `JOIN_OPEN` and `JOIN_CLOSED` states. Full-screen, landscape, 1920x1080.

### Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                         ┌─────────────────────┐                         │
│                         │   REPPS LIVE         │                         │
│                         │   ━━━━━━━━━━━━━━━━   │                         │
│                         │   [Event Name]       │                         │
│                         │   Entries close in    │                         │
│                         │      04:32            │                         │
│                         └─────────────────────┘                         │
│                                                                         │
│    ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │
│    │Avatar│  │Avatar│  │Avatar│  │Avatar│  │Avatar│  │Avatar│         │
│    │ Name │  │ Name │  │ Name │  │ Name │  │ Name │  │ Name │         │
│    │ 🇨🇳  │  │ 🇺🇸  │  │ 🇬🇧  │  │ 🇯🇵  │  │ 🇩🇪  │  │ 🇫🇷  │         │
│    │Join… │  │Ready │  │Join… │  │Ready │  │Join… │  │Join… │         │
│    └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘         │
│                                                                         │
│    ┌──────┐  ┌──────┐  ┌──────┐                                         │
│    │Avatar│  │Avatar│  │Avatar│     +3 more joining...                   │
│    │ Name │  │ Name │  │ Name │                                         │
│    │ 🇧🇷  │  │ 🇰🇷  │  │ 🇦🇺  │                                         │
│    │Ready │  │Join… │  │Join… │                                         │
│    └──────┘  └──────┘  └──────┘                                         │
│                                                                         │
│                     12 / 15 participants joined                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Animations

- **Card entry**: Each participant card animates in with a pop/scale effect (scale 0 → 1 over 300ms, ease-apple). Cards fill left-to-right, top-to-bottom.
- **Status transition**: "Joining..." pulses gently (opacity 0.5 → 1 loop). When status changes to "Ready," the card border briefly glows green (200ms flash).
- **Participant counter**: Ticks up with the standard number animation (600ms ease-apple).

### Card design (pre-lobby)

Each pre-lobby card is compact:
- 120×140px
- Profile photo (64px circle) or initial fallback
- Name (truncated to ~12 chars, body-lg)
- Nationality flag emoji (derived from ISO code)
- Status badge: "Joining..." (amber) or "Ready" (green)

### Team grouping in pre-lobby

If competition has teams, cards cluster into team blocks with a subtle team name header above each group of 2–5 cards. Individual entrants appear in an "Individuals" section.

---

## 6. Dashboard design — Live competition

Displayed during `LIVE` state. The main event.

### Layout — 16:9, 1920×1080

```
┌──────────────────────────────────────────────────────┬──────────────────┐
│                                                      │                  │
│  EVENT NAME                           🔴 LIVE  4:32  │  LEADERBOARD     │
│  ═══════════════════════════════════════════════════  │  ────────────    │
│                                                      │                  │
│  ┌─── Team Alpha ────────────────────────────────┐   │  TEAMS           │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐       │   │  1. Alpha   47   │
│  │ │  Avatar   │ │  Avatar   │ │  Avatar   │       │   │  ██████████░░   │
│  │ │  Sarah    │ │  Mei      │ │  Aisha    │       │   │  2. Bravo   39  │
│  │ │  🇨🇳 SH   │ │  🇺🇸 NYC  │ │  🇬🇧 LON  │       │   │  ████████░░░░  │
│  │ │          │ │          │ │          │       │   │  3. Delta   31  │
│  │ │  12 reps │ │  8 reps  │ │  6 reps  │       │   │  ██████░░░░░░   │
│  │ │  ✗ 2     │ │  ✗ 0     │ │  ✗ 1     │       │   │                  │
│  │ │  4.2 BPM │ │  3.1 BPM │ │  2.8 BPM │       │   │  ────────────    │
│  │ │  #1      │ │  #4      │ │  #7      │       │   │                  │
│  │ └──────────┘ └──────────┘ └──────────┘       │   │  INDIVIDUALS     │
│  │                              Team: 26 reps    │   │  1. Sarah    12  │
│  └───────────────────────────────────────────────┘   │  2. Kai      10  │
│                                                      │  3. Mei       8  │
│  ┌─── Team Bravo ────────────────────────────────┐   │                  │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐       │   │                  │
│  │ │  Avatar   │ │  Avatar   │ │  Avatar   │       │   │                  │
│  │ │  Kai      │ │  Lin      │ │  Yuki     │       │   │                  │
│  │ │  🇯🇵 TKY  │ │  🇩🇪 BER  │ │  🇰🇷 SEL  │       │   │                  │
│  │ │          │ │          │ │          │       │   │                  │
│  │ │  10 reps │ │  7 reps  │ │  5 reps  │       │   │                  │
│  │ │  ✗ 1     │ │  ✗ 0     │ │  ✗ 3     │       │   │                  │
│  │ │  3.8 BPM │ │  2.9 BPM │ │  2.1 BPM │       │   │                  │
│  │ │  #2      │ │  #5      │ │  #8      │       │   │                  │
│  │ └──────────┘ └──────────┘ └──────────┘       │   │                  │
│  │                              Team: 22 reps    │   │                  │
│  └───────────────────────────────────────────────┘   │                  │
│                                                      │                  │
│  ┌────────────────────────────────────────────────┐  │                  │
│  │  🌍 TOTAL COMPETITION REPS: 156               │  │                  │
│  └────────────────────────────────────────────────┘  │                  │
│                                                      │                  │
└──────────────────────────────────────────────────────┴──────────────────┘
```

### Grid calculations — sizing for a 55" TV

At 1920×1080 with the sidebar taking ~280px, the main area is ~1640×1080.

**Player card (live):** 200×240px minimum for legibility at 8–10 feet viewing distance.
- Avatar: 56px circle
- Name: 20px (Inter 600)
- Location: 16px (flag + city abbreviation)
- Metrics: 18px each line
- Total card padding: 16px

**Team block:** 3 cards side-by-side = 640px wide + 32px internal gaps + 24px padding = ~696px. With team header (24px) and team total footer (24px), each block is ~696×288px.

**Capacity:** Main area fits 2 team blocks per row × 3 rows = **6 teams (18 players)** comfortably. With tighter spacing, up to **8 teams (24 players)**. For team_size=2, fits up to 10 teams (20 players). For team_size=5, fits 4 teams (20 players).

**Overflow rule:** When participants exceed screen capacity, show the **top-performing teams** based on current total reps. A subtle footer shows "+ X teams off-screen" and the sidebar leaderboard shows all teams regardless.

**Individual cards** (no team): arranged in a separate "Individuals" row at the bottom, same card size but no team block wrapper.

### Sidebar leaderboard

Fixed 280px width, right side. Configurable display mode:

| Mode | Content |
|---|---|
| `teams_only` | Team rankings with progress bars |
| `individuals_only` | Individual rankings |
| `both_teams_first` | Teams at top, individuals below, divided |
| `both_individuals_first` | Individuals at top, teams below, divided |

**Selector:** A small toggle in the top-right of the sidebar (or admin-controlled). Defaults to `both_teams_first`.

Each leaderboard row:
- Rank number (accent color for top 3)
- Name (truncated)
- Rep count (bold, accent)
- Progress bar (filled proportional to the leader's count)

The leaderboard is **static-ordered** (alphabetical or by seed) with animated progress bars, rather than rows jumping around. This prevents visual chaos. The rank number updates to reflect actual position.

### Header bar

Full width, 64px tall:
- Left: Event name (headline weight)
- Center: Global competition rep counter (display-lg, accent gradient text, animates on every rep)
- Right: `🔴 LIVE` indicator (pulsing red dot) + countdown timer (display-md, monospace `tabular-nums`)

### Timer

- **Timer-based:** Counts down from `duration_seconds`. Turns amber at 60s remaining, red at 10s.
- **Target-based:** Counts up (elapsed time) with a "Target: X reps" indicator and a progress bar showing completion percentage.

---

## 7. Dashboard design — Finish sequence

Triggered when timer hits 0 or target is reached.

### Sequence (3 seconds)

1. **Flash** (0–500ms): Screen flashes white at 50% opacity, then fades
2. **Freeze** (500ms–1000ms): All counters stop. Timer shows `00:00` or "TARGET REACHED". A "FINAL" badge replaces the "LIVE" indicator.
3. **Dim** (1000ms–3000ms): The main grid dims to 30% opacity. The global counter and top 3 individual + top team stats remain visible in a centered overlay.

### Post-finish stats overlay

Before the podium ceremony, show a brief stats summary (5–10 seconds):

```
┌─────────────────────────────────────────┐
│                                         │
│          COMPETITION COMPLETE           │
│                                         │
│     Total Reps:  156                    │
│     Participants: 18                    │
│     Fastest BPM:  6.2 (Sarah)           │
│     Average BPM:  3.4                   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 8. Dashboard design — Podium ceremony

Triggered by the organizer from the admin panel after the finish sequence.

### Layout

Full-screen overlay, dark semi-transparent background (bg-base at 85% opacity) over the frozen competition grid.

**Team podium** (if team competition):

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                          🏆 CHAMPIONS 🏆                             │
│                                                                     │
│                        ┌─────────────┐                              │
│                        │  🥇          │                              │
│                        │  Team Alpha  │                              │
│                        │  47 reps     │                              │
│                        │  ┌──┐┌──┐┌──┐│                              │
│                        │  │S ││M ││A ││                              │
│                        │  └──┘└──┘└──┘│                              │
│              ┌─────────┤              ├─────────┐                    │
│              │  🥈      │              │  🥉      │                    │
│              │  Bravo   │              │  Delta   │                    │
│              │  39 reps │              │  31 reps │                    │
│              │ ┌──┐┌──┐┌──┐          │ ┌──┐┌──┐┌──┐                  │
│              │ │K ││L ││Y │          │ │D ││E ││F │                  │
│              │ └──┘└──┘└──┘          │ └──┘└──┘└──┘                  │
│              └─────────┘              └─────────┘                    │
│                                                                     │
│                     ▸ Next: Category Awards                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Individual podium** (if individual competition or individual category):

Same structure but with single player cards showing avatar, name, flag, city, and rep count.

### Category awards

After the main podium, the organizer can cycle through category winners. Each category gets a slide:

```
┌─────────────────────────────────────────┐
│                                         │
│     🏅 TOP FEMALE                       │
│                                         │
│     🥇 Sarah Chen     12 reps           │For the podium layout there should be three different levels bronze and silver should not be at the same level silver should be slightly higher for a proper podium For the podium layout, there should be three different levels. Bronze and silver should not be at the same level. Silver should be slightly higher for a proper podium. 
│     🥈 Mei Wang        8 reps           │
│     🥉 Aisha Patel     6 reps           │
│                                         │
│              3 of 7 categories          │
│                                         │
└─────────────────────────────────────────┘
```

The organizer advances through categories using the admin panel (next/previous controls).

---

## 9. Crowd vote / Popular vote

An optional post-competition ceremony where the audience picks a favorite via cheering volume.

### How it works

1. Organizer enables `crowd_vote_enabled` in competition settings
2. After the podium ceremony, the organizer taps "Start Crowd Vote" in the admin panel
3. The dashboard shows a carousel of participant cards (or all participants in a grid)
4. The organizer taps a participant's card to "spotlight" them
5. A large VU meter (audio level indicator) appears on screen
6. The device displaying the dashboard (laptop/TV) activates its microphone via `getUserMedia({ audio: true })` using the Web Audio API (`AnalyserNode`)
7. A 5-second countdown runs. The audience cheers. The peak and average dB are recorded.
8. The organizer taps the next participant. Repeat.
9. After all spotlighted participants have had their turn, the dashboard shows the ranking by dB level
10. Winner gets the "Crowd Favorite" category award

### Technical implementation

```
navigator.mediaDevices.getUserMedia({ audio: true })
→ AudioContext → AnalyserNode → getByteFrequencyData()
→ Calculate RMS amplitude → Map to 0–100 scale → Display as animated bar
→ Record peak + average over 5-second window
```

No server-side audio processing. Everything happens in the browser displaying the dashboard.

### VU meter design

A vertical bar (or horizontal, matching the brand), using the accent gradient fill. Scale markings at 25%, 50%, 75%, 100%. The bar animates in real-time as the audience noise changes. A peak marker (small horizontal line) holds for 1 second before dropping.

---

## 10. Admin control panel

### Dedicated admin page (`/live/:eventId/admin`)

A mobile-optimized control surface the organizer uses from their phone while the dashboard runs on the big screen.

### Controls by state

**ANNOUNCED:**
- Edit competition settings
- Open join window (→ JOIN_OPEN)

**JOIN_OPEN:**
- View participant list with status indicators
- Close join window (→ JOIN_CLOSED)
- Start countdown directly (→ COUNTDOWN, skips JOIN_CLOSED)

**JOIN_CLOSED:**
- View final participant list
- Re-open join window (→ JOIN_OPEN)
- Trigger orphan matching (if auto_match_orphans, shows preview of proposed groupings before confirming)
- Start countdown (→ COUNTDOWN)

**COUNTDOWN:**
- Cancel countdown (→ JOIN_CLOSED)

**LIVE:**
- View live leaderboard
- Emergency stop (→ FINISHED, with confirmation dialog)

**FINISHED:**
- View final results
- Trigger podium ceremony (→ RESULTS)
- Select which categories to present

**RESULTS:**
- Next category / previous category
- Start crowd vote
- Dismiss ceremony
- Archive competition

### Floating admin overlay (on the dashboard itself)

A small floating button in the bottom-left corner of the dashboard (only visible to the authenticated organizer). Tapping it opens a compact control panel overlay with the same controls as the mobile admin page. This allows the organizer to control the competition directly from the machine displaying the dashboard, without needing their phone.

The overlay is semi-transparent and can be minimized to just the floating button.

---

## 11. Competition team management

### Entry flow decision tree

```
User taps "Enter Competition"
│
├─ Has existing app team?
│   ├─ YES → "Enter with [Team Name]?" / "Create new team" / "Enter individually"
│   └─ NO  → "Create new team" / "Enter individually"
│
├─ If "Enter with existing team":
│   ├─ Creates a competition_team mirroring the app team
│   ├─ Other app team members get notified
│   ├─ If team_size differs from app team size:
│   │   └─ Error: "This competition requires teams of [X]. Your team has [Y] members."
│   └─ If teammates don't join by orphan_match_minutes before start:
│       └─ Prompt: "Your teammates haven't joined. Auto-match, enter individually, or wait?"
│
├─ If "Create new team":
│   ├─ Enter team name → get share link / QR code
│   ├─ Friends scan QR / tap link → join that competition team
│   └─ If team not full by start: treated as orphaned (auto-match or solo)
│
└─ If "Enter individually":
    ├─ competition_team_id = null
    ├─ If auto_match_orphans AND team_size > 1:
    │   └─ May be grouped into ad-hoc team before start
    └─ Otherwise: competes as individual
```

### QR code for venue team formation

When a user creates a competition team, they can display a QR code on their phone. Others scan it to join that specific competition team. The QR code encodes a URL: `repps.pro/events/join/:eventCode?team=:competitionTeamId`.

### Orphan matching algorithm

Run `orphan_match_minutes` before competition start (or when organizer manually triggers it):

1. Collect all participants where `competition_team_id IS NULL` or where their team has fewer than `team_size` members
2. Sort by `joined_at` (first-come, first-grouped)
3. Fill incomplete teams first (e.g., a team of 2 in a teams-of-3 competition gets a solo player added)
4. Group remaining solos into new ad-hoc teams named "Team [A/B/C/...]"
5. Leftover players (not enough to form a full team) compete individually
6. All affected participants are notified in-app
7. Any participant can opt out of their auto-assigned team and compete individually instead

---

## 12. Data flow and Realtime

### During competition

1. Participant's phone: Burpee detector validates a rep
2. App inserts into `reps` table (existing flow — counts toward global total)
3. App also inserts into `competition_reps` table with `qualified`, `rejection_reason`, and `bpm_at_time`
4. App updates `competition_participants.status` as needed (joined → camera_ready → live)
5. Dashboard subscribes to Supabase Realtime on:
   - `competition_participants` (for status changes during pre-lobby)
   - `competition_reps` (for live rep counting)
6. Dashboard recalculates per-player metrics on each rep event:
   - Total qualified reps
   - Failed/disqualified reps
   - Rolling BPM (reps in last 60 seconds)
   - Individual rank (by qualified reps, desc)
   - Team total (sum of members' qualified reps)

### BPM calculation

**Rolling BPM** (during competition): Count of qualified reps in the last 60 seconds.

```
BPM = count of qualified reps where created_at > (now - 60 seconds)
```

Calculated client-side on the dashboard from the stream of rep events. Updated every time a new rep arrives.

**Post-competition stats:**
- **Peak BPM**: Highest 60-second rolling BPM achieved during the competition
- **Average BPM**: Total qualified reps ÷ competition duration in minutes

### Global counter

The dashboard displays a "Total Competition Reps" counter that sums ALL qualified reps across all participants. This updates in real-time with the standard number tick-up animation.

These reps also feed into the main app's "Total Global Burpees" counter since they're dual-written to the `reps` table.

---

## 13. BPM and rep quality feedback (v1.1)

### Failed rep feedback

When the AI rejects a rep, the app should provide immediate feedback to the user explaining why:

| Rejection reason | User-facing message |
|---|---|
| `incomplete_down` | "Go lower! Get your chest to the ground." |
| `incomplete_up` | "Stand up fully and jump!" |
| `too_slow` | "Too slow — complete the rep within 8 seconds." |
| `no_jump` | "Add a jump at the top!" |

This feedback appears briefly (2 seconds) on the camera screen as a toast/banner. The competition dashboard shows the failed rep count but not the reason (to avoid clutter on the big screen).

### Rep quality enhancements (future)

- Form scoring (0–100 per rep based on depth, jump height, speed)
- Side-view camera support for better depth detection
- Audio clap detection for jump validation
- These are noted for v2+ and don't affect the competition spec

---

## 14. Offline resilience (v2)

For v1, stable WiFi is assumed. Notes for v2 offline support:

- **Service worker caching**: Cache the dashboard shell, assets, and fonts for instant load
- **Local rep buffering**: If the network drops, the app queues reps locally and syncs when reconnected. The `competition_reps` table gets a `synced_at` field.
- **Dashboard reconnection**: If the Realtime subscription drops, show a "Reconnecting..." banner and auto-reconnect. On reconnect, fetch the full state (not just the delta) to ensure consistency.
- **Offline-first dashboard**: Store competition state in IndexedDB. The dashboard can render from local state while waiting for reconnection.

---

## 15. Video streaming (v2)

### Architecture

Each participant's phone streams their front camera to the dashboard via a Selective Forwarding Unit (SFU).

**Recommended: LiveKit**
- Open-source SFU with a managed cloud option
- React SDK (`@livekit/components-react`) drops into the existing stack
- Pricing: ~$0.01/min/participant (12 participants × 10 min ≈ $1.20 per competition)
- Free tier covers small competitions

### v1 preparation

- The `competition_participants.status` field already models the 3-state progression (joined → camera_ready → live) that maps to video states
- The `competition_settings.show_video` toggle is already in the schema
- Player card layout reserves space for a video thumbnail (the avatar area, 56px in v1, expands to 120×90px video in v2)
- No LiveKit dependencies are added in v1

### v2 implementation outline

1. Add LiveKit Cloud credentials to `.env` (`VITE_LIVEKIT_URL`, `VITE_LIVEKIT_API_KEY`)
2. Server-side: Generate participant tokens via a Supabase Edge Function
3. Phone app: When entering DAB flow for a competition, connect to the LiveKit room
4. Dashboard: Subscribe to all tracks in the LiveKit room, render as video elements inside player cards
5. `show_video` toggle: When false, the dashboard doesn't subscribe to video tracks (reduces bandwidth)

---

## 16. New RPCs needed

### Competition management

| RPC | Parameters | Description |
|---|---|---|
| `create_competition_settings` | event_id, team_size, duration_seconds, target_reps, target_type, join_window_mode, join_window_minutes, allow_individual, allow_new_teams, allow_existing_teams, dashboard_public, winner_categories, custom_categories, crowd_vote_enabled | Creates competition settings for an existing event |
| `update_competition_settings` | event_id, [same fields] | Updates settings (only in DRAFT/ANNOUNCED state) |
| `transition_competition_state` | event_id, new_state | Validates and executes state transitions. Only the organizer can call. |

### Competition participation

| RPC | Parameters | Description |
|---|---|---|
| `enter_competition` | event_id, entry_type, team_name? | Enter a competition as individual, with existing team, or creating a new team |
| `join_competition_team` | competition_team_id | Join an existing competition team (via QR/link) |
| `leave_competition` | event_id | Withdraw from a competition (only before LIVE state) |
| `update_participant_status` | event_id, status | Update own status (joined → camera_ready → live) |
| `auto_match_orphans` | event_id | Trigger orphan matching (organizer only) |
| `opt_out_auto_match` | event_id | Opt out of auto-assigned team, compete individually |

### Competition data

| RPC | Parameters | Description |
|---|---|---|
| `record_competition_rep` | event_id, rep_id, qualified, rejection_reason?, bpm_at_time? | Record a rep in the competition context (called alongside the normal rep insert) |
| `get_competition_dashboard` | event_id | Full dashboard state: participants, teams, reps, settings, current lifecycle state |
| `get_competition_leaderboard` | event_id, category_key? | Live leaderboard, optionally filtered by category |
| `get_competition_results` | event_id | Final results with all category winners |
| `record_crowd_vote` | event_id, user_id, peak_db, avg_db | Record a crowd vote measurement |
| `get_crowd_vote_results` | event_id | All crowd vote recordings ranked by peak_db |

---

## 17. Visual design notes

### Follows BRAND_SPEC.md with these additions for the dashboard context:

**Typography scaling for big screens:**
All dashboard text sizes are 1.5–2x the mobile spec to ensure legibility at 8–10 feet.

| Element | Mobile size | Dashboard size |
|---|---|---|
| Player name | 17px (body-lg) | 20px |
| Metrics (reps, BPM) | 15px (body) | 18px |
| Team name | 22px (headline) | 28px |
| Timer | 32px (display-md) | 64px (display-xl) |
| Global counter | 44px (display-lg) | 80px (custom) |
| Leaderboard rows | 15px (body) | 18px |

**Color additions:**

| Token | Hex | Use |
|---|---|---|
| `status.joining` | `#FFC857` (accent.gold) | "Joining..." status badge |
| `status.ready` | `#34C759` (success) | "Ready" status badge |
| `status.live` | `#FF453A` (error) | Pulsing "LIVE" indicator |

**No new colors are introduced** — these reuse existing tokens in a new context.

### Dashboard-specific motion

- **Card pop-in**: scale(0) → scale(1.05) → scale(1), 300ms, ease-apple. Staggered 50ms between cards.
- **Rep flash**: When a player's rep count increments, the number briefly scales to 110% and flashes accent color, then settles (200ms).
- **Timer color transition**: Smooth hue shift from ink-primary → accent.gold (at 60s) → error (at 10s) over 200ms.
- **Finish flash**: Full-screen white overlay, opacity 0 → 0.5 → 0, 500ms.
- **Podium entrance**: Staggered from 3rd → 2nd → 1st, each sliding up from below with a 200ms delay.

### Sound design

Audio is played from the device displaying the dashboard:

| Event | Sound | Notes |
|---|---|---|
| Player joins (pre-lobby) | Soft chime | Subtle, not distracting |
| Countdown 3-2-1 | Beep (ascending pitch) | Clear, arcade-style |
| GO | Air horn / buzzer | Energetic, unmistakable |
| Competition end | Double buzzer | Distinct from GO |
| Podium reveal | Fanfare / victory jingle | Celebratory |

Audio files: small MP3s bundled with the app. No external audio service.

---

## 18. Implementation phases

This is a suggested build order. Each phase is independently demoable.

| Phase | What | Depends on |
|---|---|---|
| C1 | Profile additions (nationality, DOB, city, country) + existing user migration prompt | — |
| C2 | Competition DB schema (competition_teams, competition_participants, competition_reps, competition_settings) + RLS | C1 |
| C3 | Competition RPCs (create, enter, join team, leave, state transitions, record rep) | C2 |
| C4 | Competition creation UI (extend existing CreateEvent with competition settings) | C3 |
| C5 | Competition join flow (entry type selection, team formation, QR code, orphan matching) | C3 |
| C6 | Dashboard — Pre-lobby (participant cards populating, status indicators, animations) | C3 |
| C7 | Dashboard — Live competition (player cards with metrics, timer, sidebar leaderboard, global counter) | C6 |
| C8 | Dashboard — Finish sequence + stats overlay | C7 |
| C9 | Dashboard — Podium ceremony + category awards | C8 |
| C10 | Admin control panel (mobile page + floating overlay on dashboard) | C7 |
| C11 | Crowd vote / audio meter | C9, C10 |
| C12 | Sound design (countdown audio, chimes, fanfare) | C7 |
| C13 | Video streaming via LiveKit (v2) | C7 |
| C14 | Offline resilience (v2) | C7 |

---

## 19. Open questions / future considerations

1. **Competition replays**: Should we record the full event timeline (every rep with timestamp) so it can be replayed later? The data is already in `competition_reps.created_at` — the replay is just a frontend concern.

2. **Spectator count**: Should the dashboard show how many people are watching the public URL? Could be a simple presence count via Supabase Realtime.

3. **Commentary mode**: Could the organizer or a commentator have a text overlay on the dashboard for live commentary? (e.g., "Sarah is on fire!" scrolling across the bottom)

4. **Multi-screen**: For very large competitions (30+ teams), should we support multiple dashboard instances showing different "pages" of teams? Or a single dashboard that auto-rotates through team groups?

5. **Sound effects per rep**: Should each rep trigger a subtle sound on the dashboard (like a coin drop)? Could get noisy with many participants.

6. **Integration with existing events**: Should every event have the option to be a "live competition" (with the dashboard), or is this a separate event type? Current spec treats it as an extension of the existing event system via `competition_settings`.

---

*Last updated: 2026-06-02. Feature spec for the live competition dashboard system.*
