# SOCIAL_SPEC.md — REPPs Social Connections (v0.4)

> Canonical specification for the social messaging and nudge system. Companion to APP_SPEC.md and BRAND_SPEC.md.

## Overview

Social connections make REPPs contagious beyond the people standing next to you. Any user can nudge, cheer, or message any other user they discover through leaderboards, events, or teams. The system ships with preset messages (no moderation burden) and is architected so flipping to free text later is a one-line change.

**Design principle:** messaging is a feature of the product, not the product itself. Keep it lightweight — the core loop is still "do burpees, see numbers go up, feel social pressure." Messaging amplifies that pressure.

---

## Core Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Platform-wide (any user → any user) | Social contagion requires reach beyond 3-person teams |
| Message format (v0.4) | Preset messages only | Zero moderation burden, ship fast, still feels personal |
| Message format (future) | Free text | Same DB schema, swap picker for text input, add moderation |
| Architecture | Conversations with participants | Handles DM, team chat, event chat, group DMs — one table |
| Discovery | Leaderboard rows, event participants, team members, profile pages | Users can only message people they've already encountered |
| Nudge | Special message type, rate-limited | 1 per sender per recipient per day, designed to re-engage |
| Push notifications | In-app only for v0.4 | No service worker / web push yet — badge + Realtime |
| Block/mute | v0.4 ships block | Essential safety valve before opening messaging to strangers |
| User profiles | Public profile pages (view-only) | Needed as the "who is this person" context before messaging |

---

## User Discovery — How People Find Each Other

Before you can message someone, you need to see them. REPPs surfaces users in these contexts:

| Surface | What's shown | Action available |
|---|---|---|
| **Leaderboard rows** | Avatar, name, rep count | Tap row → public profile |
| **Event leaderboard** | Avatar, name, event reps | Tap row → public profile |
| **Event participants** | Avatar, name | Tap → public profile |
| **Team member list** | Avatar, name, daily progress | Tap → public profile |
| **Activity feed bubbles** | Name + rep count | Tap bubble → public profile |

**Public profile page** (`/user/:id`) — the gateway to social actions:
- Avatar, name, gender (if not unspecified), member since date
- Total reps, current streak, Rep Score
- Team name (if any), tappable to team page
- **[Send Message]** button → opens preset message picker → sends DM
- **[Nudge]** button → sends a nudge (if not already nudged today)
- **[Block]** option (in overflow menu)

This is NOT the user's own profile page (`/profile`) — it's a read-only public view of another user.

---

## Conversation Model

### Types

| Type | Participants | Created when | Example |
|---|---|---|---|
| `dm` | 2 users | First message sent between them | You message someone from their profile |
| `team` | 2–3 users (team members) | Team reaches `active` status (2+ members) | Team chat on the team page |
| `event` | N users (event participants) | Event is announced (future, v0.5) | Event discussion thread |
| `group` | 2–10 users (future, v0.5) | User creates a group | Friend group chat |

For v0.4, only `dm` and `team` conversations ship.

### Conversation lifecycle

- **DM conversations** are created lazily — when user A first messages user B, the conversation is created. If a conversation already exists between them, reuse it.
- **Team conversations** are created automatically when a team reaches `active` status. If a member leaves and a replacement joins, the new member is added to the existing conversation and can see history from their join date forward.
- Conversations are never deleted. Users can block other users, which hides the conversation from their inbox.

---

## Messages

### Message types

| Type | Content | Use |
|---|---|---|
| `preset` | `message_key` from fixed set | Quick reactions and encouragement |
| `nudge` | No content (the nudge IS the message) | "Hey, do your burpees today" |
| `text` | Free-form `body` (future, v0.5) | Open messaging |
| `system` | Auto-generated `body` | "Sarah joined the team", "Event starting soon" |

### Preset messages (v0.4)

The same 6 presets from the team chat spec, plus 4 new ones for broader social context:

| Key | Display text | Context |
|---|---|---|
| `lets_go` | "Let's go! 🔥" | General hype |
| `dont_forget` | "Don't forget today! ⏰" | Reminder nudge |
| `just_did_mine` | "Just did mine! ✅" | Social proof |
| `whos_in` | "Who's in? 💪" | Call to action |
| `almost_there` | "Almost there! 🏁" | Encouragement |
| `nice_work` | "Nice work! 👏" | Recognition |
| `impressive` | "Impressive! 🤯" | React to someone's score |
| `keep_it_up` | "Keep it up! 📈" | Streak/consistency encouragement |
| `challenge` | "I challenge you! ⚔️" | Competitive nudge |
| `welcome` | "Welcome to REPPs! 👋" | Greeting new users |

### Nudge behavior

A nudge is a lightweight "poke" designed to get someone to do their burpees:

- **Rate limit:** 1 nudge per sender per recipient per calendar day (UTC)
- **Display:** appears as a special message in the conversation: "[User] nudged you 👊"
- **Notification:** in-app badge on the inbox icon (no push for v0.4)
- **Button state:** after nudging someone, the button shows "Nudged ✓" and is disabled until tomorrow

### Message delivery

- Messages are inserted into the `messages` table
- Supabase Realtime delivers them to open conversation views instantly
- Unread count is derived from `messages.created_at > conversation_participants.last_read_at`
- No push notifications in v0.4 — the unread badge on the inbox nav icon is the notification

---

## Block System

Essential safety feature before opening messaging to strangers.

- **Block** hides all conversations with the blocked user from the blocker's inbox
- Blocked user can still send messages (they don't know they're blocked) — messages just aren't shown to the blocker
- Block is one-directional: A blocks B means A doesn't see B's messages. B still sees A's messages.
- **Unblock** reverses the block. Previously hidden messages become visible again.
- Block is accessible from the public profile page (overflow menu) and from within a conversation
- No "report" system in v0.4 — block is sufficient for preset messages. Report ships with free text.

---

## Inbox

### Route: `/inbox`

The inbox is the central hub for all conversations.

```
┌─────────────────────────────────────────┐
│  Messages                               │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🟠 Sarah Chen                   │    │
│  │    Let's go! 🔥 · 2m ago        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    Team Burpee Bros (3)         │    │
│  │    Derrick: Just did mine! · 1h │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    Mei Wang                     │    │
│  │    👊 Nudged you · 3h ago       │    │
│  └─────────────────────────────────┘    │
│                                         │
│  (empty state if no conversations)      │
│  No messages yet. Tap someone on the    │
│  leaderboard to start a conversation.   │
│                                         │
└─────────────────────────────────────────┘
```

- Conversations sorted by most recent message
- Unread conversations have an orange dot (🟠) and bolder text
- Team conversations show team name + member count
- DM conversations show the other user's avatar + name
- Last message preview: sender name + preset text (truncated) + relative time
- Nudges display as "👊 Nudged you" or "👊 You nudged [name]"
- Tapping a conversation opens the conversation view

### Conversation view

```
┌─────────────────────────────────────────┐
│  ← Sarah Chen                   [···]  │  ← overflow: block, view profile
├─────────────────────────────────────────┤
│                                         │
│           Sarah Chen · 2:14 PM          │
│           Nice work! 👏                  │
│                                         │
│                    You · 2:15 PM        │
│                    Let's go! 🔥          │
│                                         │
│           Sarah Chen · 2:16 PM          │
│           👊 Nudged you                  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [🔥] [⏰] [✅] [💪] [🏁] [👏]          │  ← preset message picker (scrollable)
│  [🤯] [📈] [⚔️] [👋]     [👊 Nudge]    │
│                                         │
└─────────────────────────────────────────┘
```

- Messages grouped by sender, with timestamp
- Sent messages right-aligned, received messages left-aligned
- Preset picker at the bottom: tap to send immediately (no compose step)
- Nudge button separate from presets (different rate limiting)
- Real-time via Supabase Realtime subscription on `messages` table
- Auto-scroll to bottom on new messages
- Mark as read when conversation is opened (`last_read_at = now()`)

### Team conversation view

Same UI as DM but:
- Header shows team name
- Messages show sender avatar + name (since there are 3 participants)
- No block option (you can leave the team instead)
- Accessible from the team page as an embedded section or a "Chat" button

---

## Navigation

### Bottom nav change

Add inbox to the bottom nav. With 6 tabs getting crowded, two options:

**Option A — Replace Teams tab with Inbox:**
```
┌─────────────────────────────────────────┐
│  HOME  │  BOARD  │ EVENTS │ INBOX │ ME  │
└─────────────────────────────────────────┘
```
Team page accessible from profile or home team card. Inbox gets the prime real estate.

**Option B — Keep 5 tabs, add inbox as profile sub-section:**
```
┌─────────────────────────────────────────┐
│  HOME  │  TEAMS  │ BOARD  │ EVENTS │ ME │
└─────────────────────────────────────────┘
```
Inbox accessible from profile page with an unread badge on the Profile tab icon.

**Recommendation: Option A.** Messaging is a daily touchpoint; team page is not. The team card on Home already links to /team. An unread badge on the Inbox tab drives engagement.

### Unread badge

- Orange dot on the Inbox tab icon when unread messages exist
- Count badge (number) if unread count > 0, just the dot if count > 9 (keeps it clean)
- Badge updates via Realtime subscription (global, in the BottomNav component)

---

## Database Schema

### `conversations` table

```sql
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  type       text not null default 'dm' check (type in ('dm', 'team', 'event', 'group')),
  team_id    uuid references teams(id),     -- for team conversations
  event_id   uuid references events(id),    -- for event conversations (future)
  created_at timestamptz not null default now()
);

create index idx_conversations_team on conversations(team_id) where team_id is not null;
create index idx_conversations_type on conversations(type);
```

### `conversation_participants` table

```sql
create table conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  unique(conversation_id, user_id)
);

create index idx_convo_participants_user on conversation_participants(user_id);
create index idx_convo_participants_convo on conversation_participants(conversation_id);
```

### `messages` table

```sql
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  message_type    text not null default 'preset' check (message_type in ('preset', 'nudge', 'text', 'system')),
  message_key     text,          -- for preset messages
  body            text,          -- for text/system messages (future)
  created_at      timestamptz not null default now()
);

create index idx_messages_convo on messages(conversation_id, created_at desc);
create index idx_messages_sender on messages(sender_id);
```

### `blocks` table

```sql
create table blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id)
);

create index idx_blocks_blocker on blocks(blocker_id);
```

### RLS Policies

```sql
-- Conversations: participants can read their own
create policy "Participants can read own conversations"
on conversations for select to authenticated
using (id in (
  select conversation_id from conversation_participants where user_id = auth.uid()
));

-- Conversation participants: read own
create policy "Users can read own participation"
on conversation_participants for select to authenticated
using (user_id = auth.uid());

-- Messages: participants can read messages in their conversations
create policy "Participants can read conversation messages"
on messages for select to authenticated
using (conversation_id in (
  select conversation_id from conversation_participants where user_id = auth.uid()
));

-- Blocks: users can read and manage their own blocks
create policy "Users can read own blocks"
on blocks for select to authenticated
using (blocker_id = auth.uid());

create policy "Users can insert own blocks"
on blocks for insert to authenticated
with check (blocker_id = auth.uid());

create policy "Users can delete own blocks"
on blocks for delete to authenticated
using (blocker_id = auth.uid());

-- Write operations on conversations/messages/participants via RPCs only
```

### Realtime

```sql
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversation_participants;
```

---

## RPCs

| RPC | Purpose | Key Logic |
|---|---|---|
| `send_message(p_recipient_id, p_message_key)` | Send a preset DM | Find or create DM conversation, insert preset message, return conversation_id |
| `send_nudge(p_recipient_id)` | Nudge a user | Rate-limit check (1/day), find or create DM conversation, insert nudge message |
| `send_team_message(p_message_key)` | Send to team chat | Find team conversation, insert preset message |
| `get_inbox()` | List conversations | Return conversations with last message, unread count, other participant info. Exclude blocked users' DM conversations. |
| `get_conversation_messages(p_conversation_id, p_limit, p_before)` | Paginated messages | Validate caller is participant, return messages ordered by created_at desc |
| `mark_read(p_conversation_id)` | Mark conversation read | Update `last_read_at` to now() on caller's participation row |
| `get_unread_count()` | Total unread count | Count conversations where latest message > last_read_at, excluding blocked users |
| `block_user(p_user_id)` | Block a user | Insert into blocks table |
| `unblock_user(p_user_id)` | Unblock a user | Delete from blocks table |
| `get_public_profile(p_user_id)` | Public profile data | Return name, avatar, gender, total reps, streak, Rep Score, team info |

### `send_message` detail

```
1. Check recipient exists and is not blocked by sender (sender shouldn't message someone they blocked)
2. Look for existing DM conversation between sender and recipient
3. If none exists, create conversation + add both as participants
4. Insert message with message_type='preset', message_key=p_message_key
5. Return { success: true, conversation_id }
```

### `send_nudge` detail

```
1. Check rate limit: no existing nudge-type message from sender to recipient's DM conversation today
2. Find or create DM conversation (same as send_message)
3. Insert message with message_type='nudge'
4. Return { success: true } or { success: false, error: 'already_nudged_today' }
```

---

## Migration from team_messages

The existing `team_messages` table (Phase 7) has data that needs to coexist:

- **Phase 18**: Create new tables alongside `team_messages`. Team chat continues using old table.
- **Phase 21**: Create team conversations, migrate historical `team_messages` data into `messages` table, switch Team page UI to use new conversation system.
- **Post-migration**: `team_messages` table can be dropped (or kept as archive).

The `nudges` table (Phase 7) is superseded by nudge-type messages in the `messages` table. The rate-limiting logic moves into the `send_nudge` RPC (checking for nudge messages in the conversation within the current day). The old `nudges` table has no data in it (never built the UI), so it can be left in place and ignored.

---

## Public Profile Page

### Route: `/user/:id`

A read-only view of another user's public information. This is NOT the same as `/profile` (the user's own editable profile).

```
┌─────────────────────────────────────────┐
│  ← Back                                 │
├─────────────────────────────────────────┤
│                                         │
│         [Avatar — 80px]                 │
│         Sarah Chen                      │
│         Female · Joined Mar 2026        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Total Reps    Rep Score        │    │
│  │     247           1,854         │    │
│  │                                 │    │
│  │  Streak         Team            │    │
│  │   25 days       Burpee Bros →   │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [ 💬 Message ]    [ 👊 Nudge ]         │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ··· Block user                  │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

- Tapping "Message" opens the conversation view (creating DM conversation if needed)
- Tapping "Nudge" sends a nudge immediately (with toast confirmation)
- Team name is tappable, navigates to `/team/:id` (future: public team page)
- Block is in a subtle overflow/bottom section — not prominent but accessible

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User messages someone who blocked them | Message is inserted (sender doesn't know they're blocked), but recipient never sees it |
| User blocks someone mid-conversation | Conversation disappears from blocker's inbox. Unblocking brings it back with full history. |
| Team member leaves team | Stays in team conversation as participant but can no longer send team messages. Sees history up to leave date. |
| New team member joins | Added to existing team conversation. Can see messages from their join date forward (not historical). |
| User deletes account | Cascade deletes their messages, participation, blocks. Conversations persist for other participants (messages show "[Deleted user]"). |
| Same user nudged twice in one day | Second nudge returns error, button stays in "Nudged ✓" state |
| User views their own public profile | Redirect to `/profile` (the editable version) |
| Conversation between user and themselves | Prevented in RPC — sender_id must differ from recipient_id |
| 100+ unread messages | Badge shows "9+" to stay visually clean |

---

## Build Phases

### Phase 18 — Social DB Foundation

**What:** Tables, RLS policies, indexes, Realtime.

**Deliverables:**
- `conversations` table with type check constraint
- `conversation_participants` table with unique constraint
- `messages` table with message_type check
- `blocks` table with unique constraint
- RLS policies for all four tables
- Realtime enabled on `messages` and `conversation_participants`
- Indexes for common query patterns

**Verify:**
- Tables exist in Supabase Studio
- Can manually insert test data
- RLS blocks unauthorized reads

**Estimate:** ~1 hour

---

### Phase 19 — Social RPCs + Public Profile RPC

**What:** All server-side logic for messaging, nudging, blocking, and public profile data.

**Deliverables:**
- `send_message()` — find or create DM, insert preset message
- `send_nudge()` — rate-limited nudge as message
- `send_team_message()` — team conversation message (replaces old team_messages insert)
- `get_inbox()` — conversations with last message, unread count, block filtering
- `get_conversation_messages()` — paginated message fetch
- `mark_read()` — update last_read_at
- `get_unread_count()` — for badge
- `block_user()` / `unblock_user()`
- `get_public_profile()` — stats for public profile page
- Auto-create team conversation when team reaches active (trigger or in join_team RPC)

**Verify:**
- Send message between two test users via SQL
- Verify rate limiting on nudge
- Verify block hides conversation from inbox
- Verify unread count changes with mark_read

**Estimate:** ~2.5 hours

---

### Phase 20 — Public Profile Page + Social Buttons

**What:** The `/user/:id` route and social action buttons across the app.

**Deliverables:**
- `/user/:id` route — public profile page with stats, message/nudge buttons, block option
- Make leaderboard rows tappable → navigate to `/user/:id`
- Make event leaderboard rows tappable → navigate to `/user/:id`
- Make activity feed bubbles tappable → navigate to `/user/:id`
- Nudge button on public profile (with rate-limit state)
- Message button on public profile (opens conversation or creates one)
- Block option on public profile (with confirmation)

**Verify:**
- Tap leaderboard row → see public profile
- Tap "Nudge" → nudge sent, button disabled
- Tap "Message" → conversation opens
- Block user → their conversations hidden from inbox

**Estimate:** ~2 hours

---

### Phase 21 — Inbox + Conversation UI

**What:** The `/inbox` route, conversation list, conversation detail view, preset picker.

**Deliverables:**
- `/inbox` route — conversation list sorted by recency, unread indicators
- Conversation detail view — message feed with Realtime, preset message picker, nudge button
- Bottom nav update: replace Teams tab with Inbox, add unread badge
- Team page: add "Chat" button linking to team conversation in inbox
- Empty states for inbox and conversations
- Overflow menu in conversation: block, view profile

**Verify:**
- Send preset message from conversation view → appears in real-time
- Unread badge appears on inbox tab when new message arrives
- Block user from conversation → conversation hidden
- Team chat accessible from team page via inbox

**Estimate:** ~3 hours

---

### Phase 22 — Team Chat Migration

**What:** Migrate team chat from `team_messages` to the new conversation system.

**Deliverables:**
- Auto-create team conversations for existing active teams (migration script)
- Migrate historical `team_messages` rows into `messages` table
- Update Team page chat section to use new conversation UI
- Remove direct `team_messages` table reads from frontend
- Verify old team chat history is preserved

**Verify:**
- Existing team messages appear in the new conversation view
- New team messages use the `messages` table
- Team conversation auto-created for new teams reaching active

**Estimate:** ~1.5 hours

---

## Future Considerations (v0.5+)

- **Free text messages** — change `message_type` to `text`, swap preset picker for text input, add content moderation (profanity filter, report system)
- **Push notifications** — service worker + web push for nudges, new messages, team activity
- **Event chat** — auto-create event conversation on announce, participants join on event join
- **Group DMs** — create group conversations with selected users
- **Message reactions** — react to individual messages with emoji
- **Read receipts** — show when the other person has read your message
- **Online status** — show green dot for users active in last 5 minutes
- **User search** — find users by name (currently discovery is through existing surfaces only)
- **Report system** — needed when free text ships, flag messages for admin review
- **Message deletion** — delete your own messages
- **Mute conversations** — stop unread badge for a specific conversation without blocking
- **Rich messages** — share rep sessions, achievements, event invites as message cards

---

*Spec finalized: June 2, 2026. Build target: Phases 18–22, ~10 hours total.*
