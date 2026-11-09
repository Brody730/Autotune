-- Arreglo 2026-11-09: create_band usaba gen_random_bytes (pgcrypto), que en Supabase
-- está en el esquema «extensions» y no se encontraba. Esta versión no necesita extensiones.
-- Ejecutar en Supabase → SQL Editor → New query → pegar → Run.

create or replace function public.create_band(p_name text, p_display_name text, p_role text)
returns public.bands language plpgsql security definer set search_path = public as $$
declare b public.bands; code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from bands where invite_code = code);
  end loop;
  insert into bands (name, invite_code, created_by) values (p_name, code, auth.uid()) returning * into b;
  insert into band_members (band_id, user_id, display_name, role, is_admin)
    values (b.id, auth.uid(), p_display_name, p_role, true);
  return b;
end $$;

grant execute on function public.create_band(text, text, text) to authenticated;
