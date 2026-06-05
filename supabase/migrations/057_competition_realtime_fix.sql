-- 057_competition_realtime_fix.sql
-- Enable replica identity full so Realtime filters work on UPDATE events

alter table competition_participants replica identity full;
alter table competition_settings replica identity full;
