-- Enable Realtime on event_participants for live participant count updates
alter publication supabase_realtime add table event_participants;
