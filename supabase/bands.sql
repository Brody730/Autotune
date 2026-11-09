-- Live Stage Assistant — Ministerios / bandas, bóveda de cifrados y servicios
-- Ejecutar DESPUÉS de schema.sql: Supabase → SQL Editor → New query → pegar → Run.
-- Se puede ejecutar varias veces sin problema.

create extension if not exists pgcrypto;

-- ── Tablas ───────────────────────────────────────────────────────────────────

create table if not exists public.bands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.band_members (
  band_id uuid not null references public.bands (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'voz',
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (band_id, user_id)
);
create index if not exists band_members_user_idx on public.band_members (user_id);

-- Bóveda: cifrados compartidos por la banda (texto tipo LaCuerda/Cifraclub)
create table if not exists public.band_songs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands (id) on delete cascade,
  song_key text not null,
  title text not null,
  artist text not null default '',
  sheet text not null default '',
  orig_key jsonb,
  bpm smallint,
  notes text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists band_songs_band_idx on public.band_songs (band_id);

-- Servicios, ensayos y eventos con su lista de canciones (cada una con su tono)
create table if not exists public.band_events (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands (id) on delete cascade,
  title text not null,
  kind text not null default 'servicio', -- servicio | ensayo | evento
  event_date date not null,
  items jsonb not null default '[]',      -- [{songId, key:{root,scale}|null, notes}]
  notes text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists band_events_band_idx on public.band_events (band_id, event_date);

-- ── Seguridad (cada banda solo la ven sus miembros) ──────────────────────────

create or replace function public.is_band_member(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from band_members where band_id = b and user_id = auth.uid());
$$;

create or replace function public.is_band_admin(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from band_members where band_id = b and user_id = auth.uid() and is_admin);
$$;

alter table public.bands enable row level security;
alter table public.band_members enable row level security;
alter table public.band_songs enable row level security;
alter table public.band_events enable row level security;

drop policy if exists "members read band" on public.bands;
create policy "members read band" on public.bands for select using (public.is_band_member(id));
drop policy if exists "admins update band" on public.bands;
create policy "admins update band" on public.bands for update using (public.is_band_admin(id));
drop policy if exists "admins delete band" on public.bands;
create policy "admins delete band" on public.bands for delete using (public.is_band_admin(id));

drop policy if exists "members read members" on public.band_members;
create policy "members read members" on public.band_members for select using (public.is_band_member(band_id));
-- cada quien edita su propio nombre/rol; los admins pueden editar a todos
drop policy if exists "update own membership" on public.band_members;
create policy "update own membership" on public.band_members for update
  using (user_id = auth.uid() or public.is_band_admin(band_id));
drop policy if exists "leave or remove" on public.band_members;
create policy "leave or remove" on public.band_members for delete
  using (user_id = auth.uid() or public.is_band_admin(band_id));

drop policy if exists "members all songs" on public.band_songs;
create policy "members all songs" on public.band_songs for all
  using (public.is_band_member(band_id)) with check (public.is_band_member(band_id));

drop policy if exists "members all events" on public.band_events;
create policy "members all events" on public.band_events for all
  using (public.is_band_member(band_id)) with check (public.is_band_member(band_id));

-- ── Crear banda y unirse con código (funciones seguras) ──────────────────────

create or replace function public.create_band(p_name text, p_display_name text, p_role text)
returns public.bands language plpgsql security definer set search_path = public as $$
declare b public.bands; code text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from bands where invite_code = code);
  end loop;
  insert into bands (name, invite_code, created_by) values (p_name, code, auth.uid()) returning * into b;
  insert into band_members (band_id, user_id, display_name, role, is_admin)
    values (b.id, auth.uid(), p_display_name, p_role, true);
  return b;
end $$;

create or replace function public.join_band(p_code text, p_display_name text, p_role text)
returns public.bands language plpgsql security definer set search_path = public as $$
declare b public.bands;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select * into b from bands where invite_code = upper(trim(p_code));
  if not found then raise exception 'Código de invitación no válido'; end if;
  insert into band_members (band_id, user_id, display_name, role)
    values (b.id, auth.uid(), p_display_name, p_role)
    on conflict (band_id, user_id) do update set display_name = excluded.display_name, role = excluded.role;
  return b;
end $$;

grant execute on function public.create_band(text, text, text) to authenticated;
grant execute on function public.join_band(text, text, text) to authenticated;

-- ── Tiempo real: cambios en la bóveda y servicios se ven al instante ────────
do $$
begin
  begin alter publication supabase_realtime add table public.band_songs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.band_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.band_members; exception when duplicate_object then null; end;
end $$;
