-- 018_team_logo_member_update.sql — Allow team members to update logo columns
--
-- The existing "Captain can update own team" policy blocks non-captain
-- members from setting pending_logo_url. This policy lets any team member
-- update only the logo-related columns on their own team's row.

create policy "Team members can update team logo"
  on teams for update
  to authenticated
  using (
    id in (select p.team_id from profiles p where p.id = auth.uid())
  );
