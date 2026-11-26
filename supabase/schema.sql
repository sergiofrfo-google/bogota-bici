-- Bogotá Bici shared rider reports (Supabase project "bogota-bici", free tier).
-- Riders need no account. Each phone keeps a random id (localStorage bb_device) that is only used
-- to give one vote per phone per report and to rate-limit posting. The app never reads tables directly:
-- RLS is on with no policies, and all access goes through the three functions below.

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('pothole','closure','missing','danger','theft','other')),
  note       text check (char_length(note) <= 280),
  lat        double precision not null check (lat between 4.45 and 4.85),
  lng        double precision not null check (lng between -74.25 and -73.98),
  device     uuid not null,
  created_at timestamptz not null default now(),
  hidden     boolean not null default false   -- for manual moderation in the dashboard
);
create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_device_idx on public.reports (device, created_at desc);

create table if not exists public.report_votes (
  report_id  uuid not null references public.reports(id) on delete cascade,
  device     uuid not null,
  vote       text not null check (vote in ('still','fixed')),
  created_at timestamptz not null default now(),
  primary key (report_id, device)
);
create index if not exists report_votes_device_idx on public.report_votes (device, created_at desc);

alter table public.reports enable row level security;
alter table public.report_votes enable row level security;
revoke all on public.reports, public.report_votes from anon, authenticated;

-- Active reports: not hidden; posted or confirmed "still there" in the last 60 days;
-- dropped once at least 3 riders say fixed and they outnumber "still there".
create or replace function public.list_reports()
returns table (id uuid, type text, note text, lat double precision, lng double precision,
               created_at timestamptz, still int, fixed int)
language sql stable security definer set search_path = '' as $$
  select r.id, r.type, r.note, r.lat, r.lng, r.created_at,
         count(*) filter (where v.vote = 'still')::int,
         count(*) filter (where v.vote = 'fixed')::int
  from public.reports r
  left join public.report_votes v on v.report_id = r.id
  where not r.hidden
  group by r.id
  having greatest(r.created_at, coalesce(max(v.created_at) filter (where v.vote = 'still'), r.created_at))
           > now() - interval '60 days'
     and not (count(*) filter (where v.vote = 'fixed') >= 3
              and count(*) filter (where v.vote = 'fixed') > count(*) filter (where v.vote = 'still'))
  order by r.created_at desc
  limit 2000;
$$;

create or replace function public.add_report(p_type text, p_note text, p_lat double precision,
                                             p_lng double precision, p_device uuid)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare new_id uuid;
begin
  if p_device is null then raise exception 'device required'; end if;
  if (select count(*) from public.reports where device = p_device and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.reports where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.reports (type, note, lat, lng, device)
  values (p_type, nullif(btrim(left(p_note, 280)), ''), p_lat, p_lng, p_device)
  returning id into new_id;
  insert into public.report_votes (report_id, device, vote) values (new_id, p_device, 'still');
  return new_id;
end $$;

create or replace function public.vote_report(p_report uuid, p_vote text, p_device uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_device is null then raise exception 'device required'; end if;
  if (select count(*) from public.report_votes where device = p_device and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.report_votes (report_id, device, vote) values (p_report, p_device, p_vote)
  on conflict (report_id, device) do nothing;
end $$;

revoke all on function public.list_reports(), public.add_report(text, text, double precision, double precision, uuid),
  public.vote_report(uuid, text, uuid) from public;
grant execute on function public.list_reports(), public.add_report(text, text, double precision, double precision, uuid),
  public.vote_report(uuid, text, uuid) to anon, authenticated;
