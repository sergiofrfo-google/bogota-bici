-- Bogotá Bici community schema.
-- Run this in a NEW Supabase project (free tier), not inside your existing "mapvivid" project.

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in
              ('pothole','closure','missing','danger','theft','repair','air','other')),
  note        text check (char_length(note) <= 280),
  lat         double precision not null check (lat between 4.45 and 4.95),
  lng         double precision not null check (lng between -74.35 and -73.95),
  user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.report_votes (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  vote       text not null check (vote in ('still','fixed')),
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

-- Active reports: not resolved, and not older than 60 days without a "still there" vote.
create or replace view public.reports_active as
select
  r.id, r.type, r.note, r.lat, r.lng, r.created_at,
  count(v.*) filter (where v.vote = 'still') as confirmations,
  count(v.*) filter (where v.vote = 'fixed') as fixed_votes
from public.reports r
left join public.report_votes v on v.report_id = r.id
where r.resolved_at is null
group by r.id
having
  count(v.*) filter (where v.vote = 'fixed') < 3
  and (
    r.created_at > now() - interval '60 days'
    or max(v.created_at) filter (where v.vote = 'still') > now() - interval '60 days'
  );

alter table public.reports enable row level security;
alter table public.report_votes enable row level security;

create policy "anyone can read reports" on public.reports for select using (true);
create policy "signed-in users can report" on public.reports for insert
  with check (auth.uid() is not null and user_id = auth.uid());
create policy "anyone can read votes" on public.report_votes for select using (true);
create policy "signed-in users can vote" on public.report_votes for insert
  with check (auth.uid() is not null and user_id = auth.uid());

grant select on public.reports_active to anon, authenticated;
