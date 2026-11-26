-- Bogotá Bici: anonymous usage stats, ridden routes and "this stretch is wrong" flags.
-- Same pattern as schema.sql: tables are closed (RLS on, no policies) and the app only calls functions.
-- Nothing here identifies a person: the device id is a random number made on the phone, routes are
-- stored without the parts within 400 m of where a ride starts and ends (so home and work are not saved), and riders can turn it all
-- off in "Capas y opciones".

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  device     uuid not null,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_device_idx on public.events (device, created_at desc);

create table if not exists public.rides (
  id         uuid primary key default gen_random_uuid(),
  device     uuid not null,
  client_id  uuid unique,
  mode       text not null check (mode in ('infra','balanced','fast')),
  km         numeric(6,2) not null check (km between 0 and 300),
  no_cars    int check (no_cars between 0 and 100),
  geom       jsonb not null,        -- [[lng,lat], ...] without 400 m around start and end, ~11 m precision
  created_at timestamptz not null default now()
);
create index if not exists rides_created_idx on public.rides (created_at desc);

create table if not exists public.stretch_flags (
  id         uuid primary key default gen_random_uuid(),
  device     uuid not null,
  client_id  uuid unique,
  lat        double precision not null check (lat between 4.45 and 4.85),
  lng        double precision not null check (lng between -74.25 and -73.98),
  osm_type   text not null check (osm_type in ('ex','sh','pa','ca')),
  real_type  text not null check (real_type in ('ex','sh','pa','ca','none')),
  idu        boolean not null default false,  -- the city's ciclorruta layer covers this stretch
  length_m   int,
  name       text check (char_length(name) <= 120),
  note       text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  done       boolean not null default false     -- set true once it is fixed in OpenStreetMap
);
create index if not exists stretch_flags_created_idx on public.stretch_flags (created_at desc);

alter table public.events enable row level security;
alter table public.rides enable row level security;
alter table public.stretch_flags enable row level security;
revoke all on public.events, public.rides, public.stretch_flags from anon, authenticated;

-- A batch of events from one phone (sent every minute or when the app goes to the background).
-- p_events: [{"n": "nav_start", "p": {...}, "t": 1764000000000}, ...] at most 50 per call.
create or replace function public.log_events(p_device uuid, p_events jsonb)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if p_device is null or jsonb_typeof(p_events) <> 'array' then raise exception 'bad request'; end if;
  if jsonb_array_length(p_events) > 50 then raise exception 'too many events'; end if;
  if (select count(*) from public.events where device = p_device and created_at > now() - interval '1 hour') >= 600 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.events (device, name, props, created_at)
  select p_device, e->>'n',
         case when jsonb_typeof(e->'p') = 'object' and length((e->'p')::text) <= 1000 then e->'p' else '{}'::jsonb end,
         -- events made offline keep their own time, if it is plausible
         case when (e->>'t') ~ '^[0-9]{13}$'
               and to_timestamp((e->>'t')::bigint / 1000.0) between now() - interval '7 days' and now() + interval '5 minutes'
              then to_timestamp((e->>'t')::bigint / 1000.0) else now() end
  from jsonb_array_elements(p_events) e
  where e->>'n' in ('app_open','route_search','route_fail','mode_pick','tramos_open','tramo_select','nav_start','nav_end',
                    'reroute','report_add','report_vote','report_popup','flag_stretch','idu_mismatch','services_open',
                    'place_open','via_add','save_route','share_route','install','lang','stats_off');
  get diagnostics n = row_count;
  return n;
end $$;

-- The part of a route a rider actually followed, for "popular routes" later.
create or replace function public.log_ride(p_device uuid, p_client_id uuid, p_mode text, p_km numeric, p_no_cars int, p_geom jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_device is null or p_client_id is null then raise exception 'bad request'; end if;
  if jsonb_typeof(p_geom) <> 'array' or jsonb_array_length(p_geom) < 2 or jsonb_array_length(p_geom) > 3000 then
    raise exception 'bad geometry';
  end if;
  if (select count(*) from public.rides where device = p_device and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.rides (device, client_id, mode, km, no_cars, geom)
  values (p_device, p_client_id, p_mode, p_km, p_no_cars, p_geom)
  on conflict (client_id) do nothing;
end $$;

-- A rider says a stretch is labelled wrong (e.g. OSM says "with cars" but there is a bike lane).
create or replace function public.flag_stretch(p_device uuid, p_client_id uuid, p_lat double precision, p_lng double precision,
                                               p_osm_type text, p_real_type text, p_idu boolean, p_length int, p_name text, p_note text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_device is null or p_client_id is null then raise exception 'bad request'; end if;
  if (select count(*) from public.stretch_flags where device = p_device and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.stretch_flags (device, client_id, lat, lng, osm_type, real_type, idu, length_m, name, note)
  values (p_device, p_client_id, p_lat, p_lng, p_osm_type, p_real_type, coalesce(p_idu, false), p_length,
          nullif(btrim(left(p_name, 120)), ''), nullif(btrim(left(p_note, 280)), ''))
  on conflict (client_id) do nothing;
end $$;

-- Totals only (no device ids, no places), for the stats page.
create or replace function public.usage_stats(p_days int default 30)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with ev as (
    select * from public.events
    where created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
  ),
  days as (
    select (created_at at time zone 'America/Bogota')::date as d, count(distinct device) as riders,
           count(*) filter (where name = 'route_search') as searches,
           count(*) filter (where name = 'nav_start') as navs
    from ev group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', least(greatest(coalesce(p_days, 30), 1), 365),
    'riders', (select count(distinct device) from ev),
    'riders_7d', (select count(distinct device) from ev where created_at > now() - interval '7 days'),
    'returning_riders', (select count(*) from (select device from ev group by device
                          having count(distinct (created_at at time zone 'America/Bogota')::date) >= 2) x),
    'installed_riders', (select count(distinct device) from ev where name = 'app_open' and props->>'standalone' = 'true'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'riders', riders, 'searches', searches, 'navs', navs) order by d) from days), '[]'::jsonb),
    'events', coalesce((select jsonb_object_agg(name, c) from (select name, count(*) c from ev group by name) x), '{}'::jsonb),
    'modes_started', coalesce((select jsonb_object_agg(m, c) from (select props->>'mode' m, count(*) c from ev where name = 'nav_start' and props ? 'mode' group by 1) x), '{}'::jsonb),
    'nav_finished', (select count(*) from ev where name = 'nav_end' and props->>'arrived' = 'true'),
    'nav_stopped', (select count(*) from ev where name = 'nav_end' and coalesce(props->>'arrived', 'false') <> 'true'),
    'nav_km', (select coalesce(round(sum((props->>'km')::numeric), 1), 0) from ev where name = 'nav_end' and (props->>'km') ~ '^[0-9.]+$'),
    'popup_answers', coalesce((select jsonb_object_agg(a, c) from (select props->>'answer' a, count(*) c from ev where name = 'report_popup' group by 1) x), '{}'::jsonb),
    'lang', coalesce((select jsonb_object_agg(l, c) from (select props->>'lang' l, count(distinct device) c from ev where name = 'app_open' group by 1) x), '{}'::jsonb),
    'route_fail', (select count(*) from ev where name = 'route_fail'),
    'reports_new', (select count(*) from public.reports where not hidden and created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))),
    'flags_open', (select count(*) from public.stretch_flags where not done),
    'rides', (select count(*) from public.rides where created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365)))
  );
$$;

revoke all on function public.log_events(uuid, jsonb), public.log_ride(uuid, uuid, text, numeric, int, jsonb),
  public.flag_stretch(uuid, uuid, double precision, double precision, text, text, boolean, int, text, text),
  public.usage_stats(int) from public;
grant execute on function public.log_events(uuid, jsonb), public.log_ride(uuid, uuid, text, numeric, int, jsonb),
  public.flag_stretch(uuid, uuid, double precision, double precision, text, text, boolean, int, text, text),
  public.usage_stats(int) to anon, authenticated;

-- Old raw events are not needed forever: keep 13 months (run by hand, or from the keep-awake job).
create or replace function public.prune_events()
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.events where created_at < now() - interval '13 months';
$$;
revoke all on function public.prune_events() from public, anon, authenticated;
