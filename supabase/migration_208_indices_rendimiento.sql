create index if not exists idx_team_members_team_id on public.team_members (team_id);

create index if not exists idx_clan_wars_challenger_team_id on public.clan_wars (challenger_team_id);
create index if not exists idx_clan_wars_challenged_team_id on public.clan_wars (challenged_team_id);

create index if not exists idx_bracket_matches_participant1_id on public.bracket_matches (participant1_id);
create index if not exists idx_bracket_matches_participant2_id on public.bracket_matches (participant2_id);
create index if not exists idx_bracket_matches_clan_war_id on public.bracket_matches (clan_war_id);

create index if not exists idx_tournament_group_matches_clan_war_id on public.tournament_group_matches (clan_war_id);

create index if not exists idx_tournament_participants_team_id on public.tournament_participants (team_id);
create index if not exists idx_tournament_participants_user_id on public.tournament_participants (user_id);
