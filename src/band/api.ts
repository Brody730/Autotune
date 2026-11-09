import { supabase } from '../lib/supabase';
import type { KeyRef } from '../lib/store';

/** Acceso a datos de bandas / ministerios en Supabase (ver supabase/bands.sql). */

export interface Band {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface Member {
  band_id: string;
  user_id: string;
  display_name: string;
  role: string;
  is_admin: boolean;
  joined_at: string;
}

export interface BandSong {
  id: string;
  band_id: string;
  song_key: string;
  title: string;
  artist: string;
  sheet: string;
  orig_key: KeyRef | null;
  bpm: number | null;
  notes: string;
  updated_by: string | null;
  updated_by_name: string;
  updated_at: string;
  deleted: boolean;
}

export interface EventItem {
  songId: string;
  /** Tono en que se tocará en este servicio (null = original). */
  key: KeyRef | null;
  notes?: string;
}

export interface BandEvent {
  id: string;
  band_id: string;
  title: string;
  kind: 'servicio' | 'ensayo' | 'evento';
  event_date: string; // YYYY-MM-DD
  items: EventItem[];
  notes: string;
  updated_at: string;
  deleted: boolean;
}

function db() {
  if (!supabase) throw new Error('Las cuentas no están configuradas.');
  return supabase;
}

/** Mensaje entendible para errores típicos (p. ej. falta ejecutar bands.sql). */
export function friendly(err: unknown): string {
  const m = (err as { message?: string })?.message ?? String(err);
  if (/relation .* does not exist|Could not find the (table|function)|schema cache/i.test(m)) {
    return 'Falta activar el modo banda en el servidor: ejecuta supabase/bands.sql en Supabase (SQL Editor).';
  }
  if (/JWT|not authenticated|Inicia sesión/i.test(m)) return 'Inicia sesión en «Cuenta» para usar el modo banda.';
  return m;
}

export async function myBands(userId: string): Promise<Band[]> {
  const { data, error } = await db().from('band_members').select('bands(*)').eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as unknown as { bands: Band | null }[]).map((r) => r.bands).filter((b): b is Band => !!b);
}

export async function createBand(name: string, displayName: string, role: string): Promise<Band> {
  const { data, error } = await db().rpc('create_band', { p_name: name, p_display_name: displayName, p_role: role });
  if (error) throw error;
  return data as Band;
}

export async function joinBand(code: string, displayName: string, role: string): Promise<Band> {
  const { data, error } = await db().rpc('join_band', { p_code: code, p_display_name: displayName, p_role: role });
  if (error) throw error;
  return data as Band;
}

export async function members(bandId: string): Promise<Member[]> {
  const { data, error } = await db().from('band_members').select('*').eq('band_id', bandId).order('joined_at');
  if (error) throw error;
  return data as Member[];
}

export async function updateMember(bandId: string, userId: string, patch: Partial<Pick<Member, 'display_name' | 'role' | 'is_admin'>>) {
  const { error } = await db().from('band_members').update(patch).eq('band_id', bandId).eq('user_id', userId);
  if (error) throw error;
}

export async function removeMember(bandId: string, userId: string) {
  const { error } = await db().from('band_members').delete().eq('band_id', bandId).eq('user_id', userId);
  if (error) throw error;
}

export async function renameBand(bandId: string, name: string) {
  const { error } = await db().from('bands').update({ name }).eq('id', bandId);
  if (error) throw error;
}

// ── Bóveda ──────────────────────────────────────────────────────────────────

export async function bandSongs(bandId: string): Promise<BandSong[]> {
  const { data, error } = await db().from('band_songs').select('*').eq('band_id', bandId).eq('deleted', false).order('title');
  if (error) throw error;
  return data as BandSong[];
}

export async function saveBandSong(
  song: Partial<BandSong> & { band_id: string; title: string; song_key: string },
  who: { id: string; name: string },
): Promise<BandSong> {
  const row = { ...song, updated_by: who.id, updated_by_name: who.name, updated_at: new Date().toISOString() };
  const { data, error } = await db().from('band_songs').upsert(row).select().single();
  if (error) throw error;
  return data as BandSong;
}

export async function deleteBandSong(id: string) {
  const { error } = await db().from('band_songs').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ── Servicios / ensayos ─────────────────────────────────────────────────────

export async function bandEvents(bandId: string): Promise<BandEvent[]> {
  const { data, error } = await db()
    .from('band_events')
    .select('*')
    .eq('band_id', bandId)
    .eq('deleted', false)
    .order('event_date', { ascending: false });
  if (error) throw error;
  return data as BandEvent[];
}

export async function saveBandEvent(ev: Partial<BandEvent> & { band_id: string; title: string; event_date: string }, userId: string) {
  const row = { ...ev, updated_by: userId, updated_at: new Date().toISOString() };
  const { data, error } = await db().from('band_events').upsert(row).select().single();
  if (error) throw error;
  return data as BandEvent;
}

export async function deleteBandEvent(id: string) {
  const { error } = await db().from('band_events').update({ deleted: true }).eq('id', id);
  if (error) throw error;
}
