# EVENTS_SPEC.md — REPPs Events System (v0.3)

> Canonical specification for the Events system. Companion to APP_SPEC.md and BRAND_SPEC.md.

## Overview

Events are time-bound competitions and challenges layered on top of normal REPPs activity. They support both collaborative goals (global targets) and competitive formats (individual and team leaderboards). All reps logged during the event window count toward the event — even if a participant joins late, their reps back to the event start date are retroactively included.

Events have their own self-contained leaderboard accessible via the Events tab in the bottom nav (already stubbed, currently disabled).

---

## Core Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Who can create events? | Any authenticated user | Official vs community category handles discovery/trust |
| Multiple simultaneous events? | Yes | Like Strava challenges — reps count toward all active events |
| Team events — new or existing teams? | Existing REPPs teams only | Team infra already built, avoids event-specific team formation UI |
| Featured events? | Yes, one at a time | Home screen placement for high-visibility events |
| Banner upload? | Yes, Supabase Storage | Same pattern as team logos; needed for Moose Shack Hot event |
| QR code for join? | Yes, client-side generation | `qrcode` package already installed and in use |
| Retroactive rep counting? | Yes, default on | Killer feature — join late, still get credit back to start |
| Competition modes? | All 6 ship together | Team infra exists; no reason to defer team event modes |
| One mode per event? | Yes | Multiple goals = multiple events. Event groups are v0.4 |

---

## Event Categories

| Category | Who creates | Discovery | Use case |
|---|---|---|---|
| `official` | Platform operators (Derrick, admins) | Featured, promoted, top of browse | Moose Shack Hot, global campaigns, sponsored events |
| `community` | Any authenticated user | Browse/search, invite-only option | User-organized challenges, gym competitions, friend groups |

Future: additional categories (e.g., `sponsored`, `partner`) can be added as the platform grows.

---

## Event Identity

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `name` | text | NOT NULL, 3–60 chars | "Moose Shack Hot Burpee Blitz" |
| `description` | text | nullable, max 500 chars | What it's about, context, vibe |
| `banner_url` | text | nullable | Supabase Storage URL (event-banners bucket) |
| `category` | text | CHECK `'official'` / `'community'`, default `'community'` | Controls discovery placement |
| `prize_type` | text | CHECK `'bragging_rights'` / `'custom_prize'`, default `'bragging_rights'` | |
| `prize_description` | text | nullable | "Winner gets a free smoothie" / "Eternal glory" |
| `visibility` | text | CHECK `'public'` / `'invite_only'`, default `'public'` | Public = discoverable by browsing; invite-only = join code required |
| `join_code` | text | UNIQUE, 6-char alphanumeric | Always generated regardless of visibility |
| `created_by` | uuid | FK profiles(id), NOT NULL | The event organizer |

---

## Event Timing

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `starts_at` | timestamptz | NOT NULL | When reps start counting |
| `ends_at` | timestamptz | NOT NULL, must be > starts_at | When reps stop counting |
| `status` | text | CHECK 5 states, default `'draft'` | See lifecycle below |

### Status Lifecycle

```
  DRAFT ──→ ANNOUNCED ──→ ACTIVE ──→ COMPLETED ──→ ARCHIVED
  (configuring)  (visible,     (live, reps    (results     (off feed)
                  joinable,     counting)      frozen)
                  countdown)
```

- **Draft** — organizer is still setting up. Not visible to others.
- **Announced** — visible in Events hub. Joinable. Countdown to start shown.
- **Active** — `starts_at` has passed. Reps counting. Leaderboard live. Still joinable (if `allow_late_join` is true).
- **Completed** — `ends_at` has passed. Results frozen into `event_results`. Winners declared. No more joins.
- **Archived** — organizer removes from the main feed. Still viewable via direct link.

Transition from Announced → Active and Active → Completed: handled client-side on page load for v0.3 (check timestamps, call status update RPC if stale). Supabase cron edge function is a v0.4 optimization.

---

## Competition Modes

Six modes covering all individual/team + open/target combinations:

| Mode | Scope | Target | Winner Logic | Example |
|---|---|---|---|---|
| `global_target` | All participants together | Reach X total reps | Collaborative — everyone wins or everyone falls short | "1,000 burpees as a community by Friday" |
| `individual_most` | Individuals | Open-ended | Whoever has the most reps when time expires | "Top repper of the week" |
| `individual_target` | Individuals | First to X reps | First individual to reach the target wins (event can continue for remaining ranks) | "First to 100 burpees" |
| `team_most` | Teams | Open-ended | Team with the most combined reps when time expires | "Which team dominates this week?" |
| `team_target` | Teams | First to X reps | First team to reach the combined target wins | "First team to 500 burpees" |
| `team_vs_team` | Exactly 2 teams | Open-ended or target | Head-to-head. Most reps (or first to target) between two specific teams | "Team Alpha vs Team Beta showdown" |

### Competition Mode Fields

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `competition_mode` | text | CHECK (6 modes above), NOT NULL | |
| `target_reps` | integer | nullable | Required for `global_target`, `individual_target`, `team_target`. Null for `*_most` and `team_vs_team` (unless target variant). |

---

## Participation Rules

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `max_participants` | integer | nullable | null = unlimited. For individual modes. |
| `max_teams` | integer | nullable | null = unlimited. For team modes. |
| `allow_late_join` | boolean | default true | Can people join after `starts_at`? |
| `retroactive_reps` | boolean | default true | Count reps from before join date (back to `starts_at`)? The core feature. |
| `is_featured` | boolean | default false | Only one event should be featured at a time. |

### Team Event Rules

- For team modes (`team_most`, `team_target`, `team_vs_team`): participants join with their existing REPPs team.
- All active team members are automatically enrolled when any member joins.
- A team must be in `active` status (2+ members) to participate in team events.
- If a team member leaves their REPPs team during an event, their reps up to the leave date still count. The team continues with remaining members.

---

## Scoring

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `scoring_method` | text | CHECK `'raw_reps'` / `'rep_score'`, default `'raw_reps'` | |

- **`raw_reps`** — simple count of burpees in the event window. Straightforward, easy to understand.
- **`rep_score`** — uses the full multiplier system from the scoring engine (Phase 10): daily 3x, weekly 2x, individual streak, team streak. Rewards consistency and teamwork.

### How Event Scoring Works (no extra tables needed)

Event leaderboards query the existing `reps` table:

```sql
SELECT user_id, COUNT(*) as reps
FROM reps
WHERE validated_at BETWEEN event.starts_at AND event.ends_at
  AND user_id IN (SELECT user_id FROM event_participants WHERE event_id = ...)
GROUP BY user_id
ORDER BY reps DESC
```

For `rep_score` mode, the existing `calculate_user_rep_score` RPC is called with the event's date range.

---

## Database Schema

### `events` table

```sql
create table events (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 3 and 60),
  description     text check (description is null or char_length(description) <= 500),
  banner_url      text,
  category        text not null default 'community' check (category in ('official', 'community')),
  competition_mode text not null check (competition_mode in (
    'global_target', 'individual_most', 'individual_target',
    'team_most', 'team_target', 'team_vs_team'
  )),
  target_reps     integer check (target_reps is null or target_reps > 0),
  scoring_method  text not null default 'raw_reps' check (scoring_method in ('raw_reps', 'rep_score')),
  visibility      text not null default 'public' check (visibility in ('public', 'invite_only')),
  join_code       text unique not null,
  prize_type      text not null default 'bragging_rights' check (prize_type in ('bragging_rights', 'custom_prize')),
  prize_description text,
  max_participants integer check (max_participants is null or max_participants > 0),
  max_teams       integer check (max_teams is null or max_teams > 0),
  allow_late_join boolean not null default true,
  retroactive_reps boolean not null default true,
  is_featured     boolean not null default false,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null check (ends_at > starts_at),
  status          text not null default 'draft' check (status in (
    'draft', 'announced', 'active', 'completed', 'archived'
  )),
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now()
);

-- Indexes
create index idx_events_status on events(status);
create index idx_events_featured on events(is_featured) where is_featured = true;
create index idx_events_join_code on events(join_code);
create index idx_events_starts_at on events(starts_at);
```

### `event_participants` table

```sql
create table event_participants (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  team_id   uuid references teams(id),  -- for team events: which team they represent
  joined_at timestamptz not null default now(),
  status    text not null default 'active' check (status in ('active', 'withdrawn')),
  unique(event_id, user_id)
);

create index idx_event_participants_event on event_participants(event_id);
create index idx_event_participants_user on event_participants(user_id);
```

### `event_results` table (materialized on event completion)

```sql
create table event_results (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  user_id     uuid references profiles(id),    -- for individual modes
  team_id     uuid references teams(id),        -- for team modes
  final_reps  integer not null,
  final_score integer,                          -- only if scoring_method = 'rep_score'
  rank        integer not null,
  is_winner   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_event_results_event on event_results(event_id);
```

### Storage bucket

```sql
-- event-banners bucket (same pattern as team-logos)
insert into storage.buckets (id, name, public)
values ('event-banners', 'event-banners', true)
on conflict (id) do nothing;

-- Authenticated users can upload
create policy "Authenticated users can upload event banners"
on storage.objects for insert to authenticated
with check (bucket_id = 'event-banners');

-- Authenticated users can update
create policy "Authenticated users can update event banners"
on storage.objects for update to authenticated
using (bucket_id = 'event-banners');

-- Public read
create policy "Public read access for event banners"
on storage.objects for select to public
using (bucket_id = 'event-banners');

-- Authenticated users can delete
create policy "Authenticated users can delete event banners"
on storage.objects for delete to authenticated
using (bucket_id = 'event-banners');
```

### RLS Policies

```sql
-- Anyone can read public/announced/active events
create policy "Anyone can read non-draft events"
on events for select to public
using (status != 'draft');

-- Event creator can read their own drafts
create policy "Creator can read own drafts"
on events for select to authenticated
using (created_by = auth.uid());

-- Authenticated users can create events
create policy "Authenticated users can create events"
on events for insert to authenticated
with check (created_by = auth.uid());

-- Creator can update their own events
create policy "Creator can update own events"
on events for update to authenticated
using (created_by = auth.uid());

-- Anyone can read event participants (for leaderboards)
create policy "Anyone can read event participants"
on event_participants for select to public
using (true);

-- Anyone can read event results
create policy "Anyone can read event results"
on event_results for select to public
using (true);

-- Write operations via RPCs only (insert/update policies not needed on participants/results)
```

---

## RPCs

| RPC | Purpose | Key Logic |
|---|---|---|
| `create_event(params)` | Create new event | Validate params, generate 6-char join code, insert event, auto-add creator as first participant. For team events, validate creator has an active team. |
| `announce_event(p_event_id)` | Move draft → announced | Only creator. Validates all required fields are set. |
| `join_event(p_join_code)` | Join an event | Validate: event is announced/active, not full, user not already in. For team events: validate user has active team, enroll all team members. |
| `leave_event(p_event_id)` | Withdraw from event | Set participant status to 'withdrawn'. For team events, withdraws all team members. |
| `get_event_leaderboard(p_event_id, p_limit)` | Live rankings | Queries reps table filtered by event window + participants. Aggregates by team for team modes. Returns top N + caller's position. |
| `get_event_progress(p_event_id)` | Progress summary | For target modes: total reps toward target, percentage. For ranked modes: top 3 + total participants. |
| `complete_event(p_event_id)` | Freeze results | Called by creator or auto on page load when past `ends_at`. Materializes rankings into event_results, declares winners. |
| `feature_event(p_event_id)` | Set as featured | Unfeatures any current featured event, features this one. Official events only. |

---

## UI Routes and Pages

### Route Structure

| Route | Page | Access |
|---|---|---|
| `/events` | **Events Hub** | Anyone (bottom nav tab) |
| `/events/create` | **Create Event** | Authenticated users |
| `/events/:id` | **Event Detail** | Anyone (with leaderboard, join, share) |
| `/events/join/:code` | **Join Event** | Deep link handler |

### Events Hub (`/events`)

The Events tab opens a self-contained section with its own tab navigation:

```
┌─────────────────────────────────────────┐
│  Events                    [+ Create]   │
├─────────────────────────────────────────┤
│  FEATURED  │  OFFICIAL  │  COMMUNITY    │  ← category tabs
│            │            │  MY EVENTS    │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  [Banner Image]                 │    │
│  │  Moose Shack Hot Burpee Blitz   │    │
│  │  🏆 Global Target · 1,000 reps  │    │
│  │  LIVE · 2d 14h remaining        │    │
│  │  47 participants                 │    │
│  │  ▓▓▓▓▓▓░░░░░░░░░ 43%           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Weekend Warrior Challenge      │    │
│  │  👤 Individual · Most Reps      │    │
│  │  Starts in 1d 6h                │    │
│  │  12 participants                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Team Alpha vs Team Beta        │    │
│  │  👥 Team vs Team · First to 500 │    │
│  │  LIVE · 5d remaining            │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

**Tab behavior:**
- **Featured** — shows the currently featured event (if any) as a hero card, plus any official events
- **Official** — all official category events (announced, active, recently completed)
- **Community** — all community category events (public visibility only)
- **My Events** — events the user has created or joined

**Event card displays:**
- Banner thumbnail (if uploaded)
- Event name
- Competition mode badge with icon (globe for global, person for individual, group for team)
- Time status: "Starts in Xd Xh" / "LIVE - Xd remaining" / "Completed"
- Participant/team count
- Progress bar (for target modes)
- Prize badge (if custom prize)

### Create Event (`/events/create`)

Multi-step form flow:

**Step 1 — Identity**
- Event name (text input, 3-60 chars)
- Description (textarea, optional, 500 char max)
- Banner upload (tap to upload image, camera icon placeholder)
- Category selector: Official / Community (official only available if user is admin — for now, hardcode Derrick's user ID)
- Visibility: Public / Invite Only

**Step 2 — Competition**
- Competition mode selector (6 options with icons and descriptions):
  - Global Target — "Everyone contributes to one goal"
  - Individual Most — "Whoever gets the most reps wins"
  - Individual Target — "First to hit the target wins"
  - Team Most — "Team with the most combined reps wins"
  - Team Target — "First team to hit the target wins"
  - Team vs Team — "Two teams go head to head"
- Target reps input (shown for global_target, individual_target, team_target)
- Scoring method: Raw Reps / Rep Score
- Max participants/teams (optional)

**Step 3 — Timing**
- Start date + time picker
- End date + time picker
- Preview: "Runs for X days"

**Step 4 — Prizes (optional)**
- Prize type: Bragging Rights / Custom Prize
- Prize description (text input, shown if custom)

**Step 5 — Review & Create**
- Summary of all fields
- "Save as Draft" button
- "Announce Now" button (goes straight to announced status)

### Event Detail (`/events/:id`)

The main event page with its own internal tabs:

```
┌─────────────────────────────────────────┐
│  ← Back to Events                       │
├─────────────────────────────────────────┤
│  [          Banner Image              ] │
│                                         │
│  Moose Shack Hot Burpee Blitz           │
│  🏆 Global Target · 1,000 reps          │
│  LIVE · 2d 14h remaining                │
│                                         │
│  ▓▓▓▓▓▓▓░░░░░░░░░ 43%                  │
│  430 / 1,000 reps                       │
│                                         │
│  [ JOIN EVENT ]     [ SHARE ]           │
│                                         │
├─────────────────────────────────────────┤
│  LEADERBOARD  │  DETAILS  │  QR CODE    │  ← event detail tabs
├─────────────────────────────────────────┤
│                                         │
│  (LEADERBOARD tab — event-specific)     │
│  🥇 Sarah Chen           87 reps        │
│  🥈 Mei Wang             62 reps        │
│  🥉 Derrick              45 reps        │
│  4. Lin Zhang            38 reps        │
│  ...                                    │
│  ─────────                              │
│  YOU: #3 · 45 reps                      │
│                                         │
│  (DETAILS tab)                          │
│  Description text...                    │
│  Prize: Bragging rights                 │
│  Created by: Derrick                    │
│  Scoring: Raw Reps                      │
│  Late join: Allowed                     │
│  Retroactive reps: Yes                  │
│                                         │
│  (QR CODE tab)                          │
│  [Large QR code image]                  │
│  repps.pro/events/join/ABC123           │
│  [ Copy Link ] [ Download QR ]          │
│                                         │
└─────────────────────────────────────────┘
```

**Leaderboard tab behavior by mode:**
- `global_target`: progress bar + individual contribution list (everyone's on the same side)
- `individual_most` / `individual_target`: ranked individual list
- `team_most` / `team_target`: ranked team list, tappable to expand member breakdown
- `team_vs_team`: two-column head-to-head display

**For completed events:** leaderboard is frozen, winner(s) highlighted with gold accent, "COMPLETED" badge.

**Organizer view extras:**
- "Edit Event" (if draft)
- "Announce" (if draft)
- "Complete Event" (manual trigger, or auto on `ends_at`)
- "Archive" (if completed)
- "Feature This Event" (if official category)

### Join Event (`/events/join/:code`)

Deep link landing page:

```
┌─────────────────────────────────────────┐
│                                         │
│  [Banner]                               │
│  Moose Shack Hot Burpee Blitz           │
│  🏆 Global Target · 1,000 reps          │
│  47 participants already joined          │
│                                         │
│  [ JOIN THIS EVENT ]                    │
│                                         │
│  (or if already joined)                 │
│  You're already in this event!          │
│  [ VIEW EVENT ]                         │
│                                         │
│  (or if event is full)                  │
│  This event is full.                    │
│                                         │
│  (or if event is completed)             │
│  This event has ended.                  │
│  [ VIEW RESULTS ]                       │
│                                         │
│  (or if not signed in)                  │
│  Sign in to join this event             │
│  [ SIGN IN WITH GOOGLE ]               │
│  (auto-join after auth)                 │
│                                         │
└─────────────────────────────────────────┘
```

### Home Screen Integration

When a featured event exists, show a compact card on the Home screen between the global counter and the live feed:

```
┌─────────────────────────────────────────┐
│  🔥 FEATURED EVENT                      │
│  Moose Shack Hot Burpee Blitz           │
│  ▓▓▓▓▓▓▓░░░░ 43% · 2d remaining        │
│                              [View →]   │
└─────────────────────────────────────────┘
```

Tapping navigates to `/events/:id`.

---

## QR Code

Generated client-side from the join URL using the existing `qrcode` package:

```
URL: repps.pro/events/join/{join_code}
```

Displayed on:
- Event detail page (QR Code tab)
- Share sheet (if platform supports image sharing)
- Downloadable as PNG image

QR code styling: white on dark (matches brand), with REPPs orange accent corners if the library supports it.

---

## Share Flow

"Share" button triggers Web Share API (same pattern as team invites):

**Share message template:**
```
Join [Event Name] on REPPs! [Description preview — first 100 chars].
[link]
```

**Fallback:** copy-to-clipboard for browsers without Web Share API.

---

## Retroactive Rep Counting — How It Works

This is the key differentiator:

1. Event starts on June 1. User joins on June 3.
2. `retroactive_reps` is true (default).
3. Event leaderboard query counts the user's reps from June 1 onward (not June 3).
4. The user's reps from June 1 and June 2 — done before they knew about the event — still count.

This removes the "I missed the start" friction entirely. It encourages late discovery and sharing.

When `retroactive_reps` is false: only reps from `joined_at` onward count for that participant.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User joins event late with retroactive on | Reps from `starts_at` through `ends_at` all count |
| User joins event late with retroactive off | Only reps from `joined_at` through `ends_at` count |
| User withdraws from event | Status set to 'withdrawn'. Reps stop counting from withdrawal. Previous reps still visible in frozen results. |
| Team member leaves REPPs team during team event | Their reps up to leave date still count for the team total. Remaining members continue. |
| Team drops below 2 members during team event | Team stays enrolled but flagged. Reps still count. The team competes at a disadvantage. |
| Event starts with 0 participants | Valid — participants can join after start (if `allow_late_join`). |
| User is in 5 events simultaneously | All fine — each rep counts toward all 5 event leaderboards. |
| Target reached before `ends_at` | For `global_target`: event can auto-complete or continue (organizer choice). For `individual_target`/`team_target`: first to hit wins, event continues for remaining positions. |
| Two users/teams hit target simultaneously | Whoever's rep was `validated_at` first wins. Tie-breaker: earlier `joined_at`. |
| Event organizer deletes their account | Event persists (cascade would be destructive). `created_by` becomes null or references a deleted profile. v0.4: transfer ownership. |
| `team_vs_team` with only 1 team joined | Event stays in announced/active but is effectively waiting. UI shows "Waiting for opponent." |

---

## The Moose Shack Hot Event (first official event)

| Field | Value |
|---|---|
| name | TBD by Derrick |
| category | `official` |
| competition_mode | Create two events: a `global_target` (collaborative) + `individual_most` (competitive) |
| visibility | `public` |
| is_featured | `true` (the global target one) |
| banner | Custom upload |
| starts_at | When Derrick announces at the venue |
| ends_at | End of the Moose Shack Hot event |
| scoring_method | `raw_reps` (simpler for first event) |
| retroactive_reps | `true` |
| prize_type | Up to Derrick |

---

## Build Phases

### Phase 13 — Events DB Foundation

**What:** Tables, storage bucket, RLS policies, indexes.

**Deliverables:**
- `events` table with all columns and constraints
- `event_participants` table with unique constraint
- `event_results` table
- `event-banners` storage bucket with policies
- RLS policies for all three tables
- Indexes for common query patterns

**Verify:**
- Tables exist in Supabase Studio
- Can manually insert an event row
- Storage bucket accepts uploads
- RLS blocks unauthorized writes

**Estimate:** ~1 hour

---

### Phase 14 — Event RPCs

**What:** All server-side logic for event operations.

**Deliverables:**
- `create_event()` — validate, generate join code, insert, add creator as participant
- `announce_event()` — move draft to announced, validate required fields
- `join_event()` — validate joinability, handle team enrollment for team modes
- `leave_event()` — withdraw participant(s)
- `get_event_leaderboard()` — query reps within event window, handle all 6 modes, return ranked list + caller position
- `get_event_progress()` — aggregate stats for event cards (total reps, percentage, participant count)
- `complete_event()` — freeze results, determine winners, materialize into event_results
- `feature_event()` — toggle featured status (only one at a time)

**Verify:**
- Create an event via Supabase SQL editor
- Join with a test user, verify participant row created
- Insert test reps, call leaderboard RPC, confirm correct ranking
- Complete event, verify results materialized
- Test each competition mode with sample data

**Estimate:** ~2 hours

---

### Phase 15 — Events Hub UI + Event Detail

**What:** The main Events pages — browsing, viewing, and the event-specific leaderboard.

**Deliverables:**
- `/events` route — Events Hub with category tabs (Featured / Official / Community / My Events)
- Event card component with status badges, progress bars, participant counts
- `/events/:id` route — Event Detail page with internal tabs (Leaderboard / Details / QR Code)
- Event leaderboard component (handles all 6 competition modes)
- QR code generation and display (using existing `qrcode` package)
- Share button (Web Share API + copy fallback)
- Enable the Events tab in bottom nav (currently stubbed as disabled)

**Verify:**
- Events tab works in bottom nav
- Can browse events by category
- Event detail shows correct leaderboard for each mode
- QR code scans correctly and opens the join URL
- Share button works on mobile

**Estimate:** ~3 hours

---

### Phase 16 — Create Event Flow + Join Route

**What:** Event creation multi-step form and the deep-link join handler.

**Deliverables:**
- `/events/create` route — multi-step form (Identity → Competition → Timing → Prizes → Review)
- Banner upload to Supabase Storage
- Competition mode selector with visual descriptions
- Date/time pickers for start and end
- Draft save and Announce actions
- `/events/join/:code` route — join confirmation page with all states (join, already joined, full, ended, not signed in)
- Auto-join after auth for unauthenticated users who land on join link

**Verify:**
- Full create flow: fill all fields → save draft → announce
- Upload banner, confirm it displays on event card and detail
- Join via link with signed-in user
- Join via link with signed-out user (sign in → auto-join)
- Team event: verify all team members enrolled on join
- Edge cases: full event, already joined, ended event

**Estimate:** ~2.5 hours

---

### Phase 17 — Home Integration + Event Management

**What:** Featured event on home screen, organizer management tools, auto-status transitions.

**Deliverables:**
- Featured event card on Home screen (compact, tappable)
- Organizer controls on event detail (edit draft, announce, complete, archive, feature)
- Auto-status transition: client-side check on page load updates announced → active and active → completed
- "My Events" tab population (created + joined)
- Event participant count and progress real-time updates (Supabase Realtime on event_participants)

**Verify:**
- Featured event shows on Home
- Organizer can manage event lifecycle (draft → announced → complete → archive)
- Status transitions happen automatically when times pass
- Create the Moose Shack Hot event end-to-end
- Full flow: create → announce → others join via QR → do burpees → see leaderboard → complete

**Estimate:** ~1.5 hours

---

## Future Considerations (v0.4+)

- **Event groups / series** — link related events (e.g., "Moose Shack Hot" global target + individual leaderboard under one umbrella)
- **Event discovery feed** — algorithmic sorting, trending events, recommended events
- **Event comments / chat** — discussion thread on event detail page
- **Recurring events** — "Weekly challenge" that auto-creates a new event each week
- **Sponsored events** — partner branding, sponsored prizes
- **Event templates** — save and reuse event configurations
- **Push notifications** — event starting soon, event ending soon, you're about to lose your #1 spot
- **Event ownership transfer** — if creator deletes account
- **Supabase cron** — server-side status transitions instead of client-side checks
- **Event badges / achievements** — participated in X events, won Y events
- **Event analytics** — organizer dashboard with participation curves, rep velocity, engagement metrics

---

*Spec finalized: June 1, 2026. Build target: Phases 13–17, ~10 hours total.*
