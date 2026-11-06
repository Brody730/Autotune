import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

/**
 * Datos del usuario, "local primero":
 *  - Siempre se guardan en este dispositivo (localStorage) → funciona sin
 *    internet y sin cuenta.
 *  - Con sesión iniciada se sincronizan con Supabase (último cambio gana).
 * Las grabaciones de audio NO van aquí (son grandes): ver recordings.ts.
 */

export interface KeyRef {
  root: number;
  scale: 'major' | 'minor';
}

export interface SongRecord {
  key: string; // título normalizado
  title: string;
  artist: string;
  /** Cifrado en el tono original. */
  sheet: string | null;
  /** Tono original indicado a mano (si no, se estima del cifrado). */
  origKey: KeyRef | null;
  /** Tono elegido para MI voz. */
  myKey: KeyRef | null;
  /** Tono y rango (MIDI) en que se cantó la última vez. */
  sungKey: KeyRef | null;
  sungLow: number | null;
  sungHigh: number | null;
  plays: number;
  lastPlayed: number | null;
  updated: number;
  deleted?: boolean;
}

export interface SessionItem {
  songKey: string;
  title: string;
  artist: string;
  startedAt: number;
  endedAt: number;
  sungKey: KeyRef | null;
  low: number | null;
  high: number | null;
}

export interface SessionRecord {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  items: SessionItem[];
  /** Guardada por el usuario como medley / lista para repetir. */
  saved: boolean;
  recordingId: string | null;
  updated: number;
  deleted?: boolean;
}

export interface Profile {
  displayName: string;
  vocalLow: number | null;
  vocalHigh: number | null;
  updated: number;
}

interface Data {
  songs: Record<string, SongRecord>;
  sessions: Record<string, SessionRecord>;
  profile: Profile;
}

const KEY = 'lsa.data.v1';
const emptyProfile = (): Profile => ({ displayName: '', vocalLow: null, vocalHigh: null, updated: 0 });

function load(): Data {
  let d: Data = { songs: {}, sessions: {}, profile: emptyProfile() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) d = { ...d, ...(JSON.parse(raw) as Data) };
    // Migración: cifrados guardados por la versión anterior
    const old = localStorage.getItem('lsa.sheets');
    if (old) {
      const sheets = JSON.parse(old) as Record<string, { text: string; key: KeyRef | null; title: string; artist: string; updated: number }>;
      for (const [k, s] of Object.entries(sheets)) {
        if (!d.songs[k]) d.songs[k] = { ...newSong(k, s.title, s.artist), sheet: s.text, origKey: s.key, updated: s.updated };
      }
      localStorage.removeItem('lsa.sheets');
    }
  } catch {
    /* datos corruptos o almacenamiento bloqueado */
  }
  return d;
}

let data: Data = load();
const listeners = new Set<() => void>();
const dirty = { songs: new Set<string>(), sessions: new Set<string>(), profile: false };
let syncUser: string | null = null;
let pushTimer = 0;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* sin espacio */
  }
  listeners.forEach((l) => l());
  if (syncUser) {
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void pushDirty(), 1500);
  }
}

export function newSong(key: string, title: string, artist: string): SongRecord {
  return {
    key,
    title,
    artist,
    sheet: null,
    origKey: null,
    myKey: null,
    sungKey: null,
    sungLow: null,
    sungHigh: null,
    plays: 0,
    lastPlayed: null,
    updated: Date.now(),
  };
}

// ── API ─────────────────────────────────────────────────────────────────────

export const store = {
  get: () => data,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  song: (key: string): SongRecord | null => {
    const s = data.songs[key];
    return s && !s.deleted ? s : null;
  },

  upsertSong(key: string, title: string, artist: string, patch: Partial<SongRecord>) {
    const prev = data.songs[key] && !data.songs[key].deleted ? data.songs[key] : newSong(key, title, artist);
    data = { ...data, songs: { ...data.songs, [key]: { ...prev, ...patch, key, deleted: false, updated: Date.now() } } };
    dirty.songs.add(key);
    persist();
  },

  deleteSong(key: string) {
    const prev = data.songs[key];
    if (!prev) return;
    data = { ...data, songs: { ...data.songs, [key]: { ...prev, deleted: true, updated: Date.now() } } };
    dirty.songs.add(key);
    persist();
  },

  upsertSession(s: SessionRecord) {
    data = { ...data, sessions: { ...data.sessions, [s.id]: { ...s, updated: Date.now() } } };
    dirty.sessions.add(s.id);
    persist();
  },

  deleteSession(id: string) {
    const prev = data.sessions[id];
    if (!prev) return;
    data = { ...data, sessions: { ...data.sessions, [id]: { ...prev, deleted: true, updated: Date.now() } } };
    dirty.sessions.add(id);
    persist();
  },

  setProfile(patch: Partial<Profile>) {
    data = { ...data, profile: { ...data.profile, ...patch, updated: Date.now() } };
    dirty.profile = true;
    persist();
  },
};

export function useStore<T>(select: (d: Data) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(data));
}

export const uid = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ── Sincronización con Supabase ────────────────────────────────────────────

const toRowSong = (u: string, s: SongRecord) => ({
  user_id: u,
  song_key: s.key,
  title: s.title,
  artist: s.artist,
  sheet: s.sheet,
  orig_key: s.origKey,
  my_key: s.myKey,
  sung_key: s.sungKey,
  sung_low: s.sungLow,
  sung_high: s.sungHigh,
  plays: s.plays,
  last_played: s.lastPlayed,
  deleted: !!s.deleted,
  updated: s.updated,
});
type SongRow = ReturnType<typeof toRowSong>;
const fromRowSong = (r: SongRow): SongRecord => ({
  key: r.song_key,
  title: r.title,
  artist: r.artist,
  sheet: r.sheet,
  origKey: r.orig_key,
  myKey: r.my_key,
  sungKey: r.sung_key,
  sungLow: r.sung_low,
  sungHigh: r.sung_high,
  plays: r.plays,
  lastPlayed: r.last_played,
  deleted: r.deleted,
  updated: r.updated,
});

const toRowSession = (u: string, s: SessionRecord) => ({
  user_id: u,
  id: s.id,
  name: s.name,
  started_at: s.startedAt,
  ended_at: s.endedAt,
  items: s.items,
  saved: s.saved,
  recording_id: s.recordingId,
  deleted: !!s.deleted,
  updated: s.updated,
});
type SessionRow = ReturnType<typeof toRowSession>;
const fromRowSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  name: r.name,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  items: r.items,
  saved: r.saved,
  recordingId: r.recording_id,
  deleted: r.deleted,
  updated: r.updated,
});

export type SyncState = 'off' | 'syncing' | 'ok' | 'error';
let syncState: SyncState = 'off';
const syncListeners = new Set<() => void>();
function setSyncState(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l());
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncState,
  );
}

async function pushDirty() {
  if (!supabase || !syncUser) return;
  const u = syncUser;
  const songs = [...dirty.songs].map((k) => data.songs[k]).filter(Boolean);
  const sessions = [...dirty.sessions].map((k) => data.sessions[k]).filter(Boolean);
  const pushProfile = dirty.profile;
  dirty.songs.clear();
  dirty.sessions.clear();
  dirty.profile = false;
  if (!songs.length && !sessions.length && !pushProfile) return;
  setSyncState('syncing');
  try {
    if (songs.length) {
      const { error } = await supabase.from('songs').upsert(songs.map((s) => toRowSong(u, s)), { onConflict: 'user_id,song_key' });
      if (error) throw error;
    }
    if (sessions.length) {
      const { error } = await supabase.from('sessions').upsert(sessions.map((s) => toRowSession(u, s)), { onConflict: 'id' });
      if (error) throw error;
    }
    if (pushProfile) {
      const p = data.profile;
      const { error } = await supabase.from('profiles').upsert({
        id: u,
        display_name: p.displayName,
        vocal_low: p.vocalLow,
        vocal_high: p.vocalHigh,
        updated: p.updated,
      });
      if (error) throw error;
    }
    setSyncState('ok');
  } catch (err) {
    console.error('[LSA] sync push', err);
    // reintentar en el próximo cambio
    songs.forEach((s) => dirty.songs.add(s.key));
    sessions.forEach((s) => dirty.sessions.add(s.id));
    if (pushProfile) dirty.profile = true;
    setSyncState('error');
  }
}

/** Al iniciar sesión: baja lo de la nube, mezcla (gana lo más reciente) y sube lo local. */
export async function startSync(userId: string) {
  if (!supabase) return;
  syncUser = userId;
  setSyncState('syncing');
  try {
    const [songsRes, sessRes, profRes] = await Promise.all([
      supabase.from('songs').select('*'),
      supabase.from('sessions').select('*'),
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    ]);
    if (songsRes.error) throw songsRes.error;
    if (sessRes.error) throw sessRes.error;
    const songs = { ...data.songs };
    for (const r of (songsRes.data ?? []) as SongRow[]) {
      const remote = fromRowSong(r);
      const local = songs[remote.key];
      if (!local || remote.updated > local.updated) songs[remote.key] = remote;
      else if (local.updated > remote.updated) dirty.songs.add(local.key);
    }
    for (const k of Object.keys(songs)) if (!(songsRes.data ?? []).some((r) => r.song_key === k)) dirty.songs.add(k);

    const sessions = { ...data.sessions };
    for (const r of (sessRes.data ?? []) as SessionRow[]) {
      const remote = fromRowSession(r);
      const local = sessions[remote.id];
      if (!local || remote.updated > local.updated) sessions[remote.id] = remote;
      else if (local.updated > remote.updated) dirty.sessions.add(local.id);
    }
    for (const k of Object.keys(sessions)) if (!(sessRes.data ?? []).some((r) => r.id === k)) dirty.sessions.add(k);

    let profile = data.profile;
    const pr = profRes.data as { display_name: string; vocal_low: number | null; vocal_high: number | null; updated: number } | null;
    if (pr && pr.updated > profile.updated) {
      profile = { displayName: pr.display_name ?? '', vocalLow: pr.vocal_low, vocalHigh: pr.vocal_high, updated: pr.updated };
    } else if (profile.updated > (pr?.updated ?? -1)) dirty.profile = true;

    data = { songs, sessions, profile };
    persist();
    await pushDirty();
    setSyncState('ok');
  } catch (err) {
    console.error('[LSA] sync pull', err);
    setSyncState('error');
  }
}

export function stopSync() {
  syncUser = null;
  setSyncState('off');
}
