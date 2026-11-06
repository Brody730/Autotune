-- Live Stage Assistant — esquema de Supabase
-- Ejecutar en: Supabase → SQL Editor → New query → pegar → Run.
-- Cada usuario solo puede ver y modificar sus propios datos (Row Level Security).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  vocal_low smallint,
  vocal_high smallint,
  updated bigint not null default 0
);

create table if not exists public.songs (
  user_id uuid not null references auth.users (id) on delete cascade,
  song_key text not null,
  title text not null,
  artist text not null default '',
  sheet text,
  orig_key jsonb,
  my_key jsonb,
  sung_key jsonb,
  sung_low smallint,
  sung_high smallint,
  plays integer not null default 0,
  last_played bigint,
  deleted boolean not null default false,
  updated bigint not null default 0,
  primary key (user_id, song_key)
);

create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  started_at bigint not null,
  ended_at bigint not null,
  items jsonb not null default '[]',
  saved boolean not null default false,
  recording_id text,
  deleted boolean not null default false,
  updated bigint not null default 0
);
create index if not exists sessions_user_idx on public.sessions (user_id);

alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.sessions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own songs" on public.songs;
create policy "own songs" on public.songs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
