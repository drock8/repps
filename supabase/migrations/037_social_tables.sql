-- Phase 18: Social DB Foundation
-- Tables: conversations, conversation_participants, messages, blocks
-- RLS, indexes, Realtime

-- ─── Create all tables first ───

create table conversations (
  id         uuid primary key default gen_random_uuid(),
  type       text not null default 'dm' check (type in ('dm', 'team', 'event', 'group')),
  team_id    uuid references teams(id),
  event_id   uuid references events(id),
  created_at timestamptz not null default now()
);

create table conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  unique(conversation_id, user_id)
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  message_type    text not null default 'preset' check (message_type in ('preset', 'nudge', 'text', 'system')),
  message_key     text,
  body            text,
  created_at      timestamptz not null default now()
);

create table blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id)
);

-- ─── Indexes ───

create index idx_conversations_team on conversations(team_id) where team_id is not null;
create index idx_conversations_type on conversations(type);
create index idx_convo_participants_user on conversation_participants(user_id);
create index idx_convo_participants_convo on conversation_participants(conversation_id);
create index idx_messages_convo on messages(conversation_id, created_at desc);
create index idx_messages_sender on messages(sender_id);
create index idx_blocks_blocker on blocks(blocker_id);

-- ─── RLS ───

alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;

create policy "Participants can read own conversations"
on conversations for select to authenticated
using (id in (
  select conversation_id from conversation_participants where user_id = auth.uid()
));

create policy "Users can read own participation"
on conversation_participants for select to authenticated
using (user_id = auth.uid());

create policy "Participants can read conversation messages"
on messages for select to authenticated
using (conversation_id in (
  select conversation_id from conversation_participants where user_id = auth.uid()
));

create policy "Users can read own blocks"
on blocks for select to authenticated
using (blocker_id = auth.uid());

create policy "Users can insert own blocks"
on blocks for insert to authenticated
with check (blocker_id = auth.uid());

create policy "Users can delete own blocks"
on blocks for delete to authenticated
using (blocker_id = auth.uid());

-- ─── Realtime ───

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversation_participants;
