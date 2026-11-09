import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Band, BandEvent, BandSong, bandEvents, bandSongs, friendly, Member, members, myBands } from './api';

/**
 * Estado del ministerio / banda activa. Se mantiene al día en tiempo real
 * (cuando alguien edita la bóveda o un servicio, se ve al instante) y se
 * guarda una copia local para que funcione con mala señal en la iglesia.
 */

interface BandState {
  userId: string | null;
  bands: Band[];
  activeId: string | null;
  members: Member[];
  songs: BandSong[];
  events: BandEvent[];
  loading: boolean;
  error: string | null;
}

const ACTIVE_KEY = 'lsa.band.active';
const cacheKey = (id: string) => `lsa.band.cache.${id}`;

let state: BandState = {
  userId: null,
  bands: [],
  activeId: readActive(),
  members: [],
  songs: [],
  events: [],
  loading: false,
  error: null,
};
const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function set(patch: Partial<BandState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function saveCache() {
  if (!state.activeId) return;
  try {
    localStorage.setItem(
      cacheKey(state.activeId),
      JSON.stringify({ members: state.members, songs: state.songs, events: state.events }),
    );
  } catch {
    /* sin espacio */
  }
}

function loadCache(id: string) {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(id)) || 'null') as Pick<BandState, 'members' | 'songs' | 'events'> | null;
    if (c) set({ members: c.members ?? [], songs: c.songs ?? [], events: c.events ?? [] });
  } catch {
    /* noop */
  }
}

async function refreshActive(part?: 'songs' | 'events' | 'members') {
  const id = state.activeId;
  if (!id || !supabase || !state.userId) return;
  try {
    const [m, s, e] = await Promise.all([
      !part || part === 'members' ? members(id) : Promise.resolve(state.members),
      !part || part === 'songs' ? bandSongs(id) : Promise.resolve(state.songs),
      !part || part === 'events' ? bandEvents(id) : Promise.resolve(state.events),
    ]);
    if (state.activeId !== id) return;
    set({ members: m, songs: s, events: e, error: null });
    saveCache();
  } catch (err) {
    set({ error: friendly(err) });
  }
}

function subscribe(id: string) {
  if (channel) void supabase?.removeChannel(channel);
  channel = null;
  if (!supabase) return;
  const filter = `band_id=eq.${id}`;
  channel = supabase
    .channel(`band-db:${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_songs', filter }, () => void refreshActive('songs'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_events', filter }, () => void refreshActive('events'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_members', filter }, () => void refreshActive('members'))
    .subscribe();
}

export const bandStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Llamar al cambiar el usuario (inicio / cierre de sesión). */
  async setUser(userId: string | null) {
    if (userId === state.userId) return;
    set({ userId, bands: [], members: [], songs: [], events: [], error: null });
    if (!userId) {
      if (channel) void supabase?.removeChannel(channel);
      channel = null;
      return;
    }
    set({ loading: true });
    try {
      const bands = await myBands(userId);
      let activeId = state.activeId;
      if (!activeId || !bands.some((b) => b.id === activeId)) activeId = bands[0]?.id ?? null;
      set({ bands, loading: false });
      await bandStore.setActive(activeId);
    } catch (err) {
      set({ loading: false, error: friendly(err) });
    }
  },

  async setActive(id: string | null) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* noop */
    }
    set({ activeId: id, members: [], songs: [], events: [] });
    if (!id) return;
    loadCache(id);
    subscribe(id);
    await refreshActive();
  },

  async reloadBands() {
    if (!state.userId) return;
    try {
      set({ bands: await myBands(state.userId), error: null });
    } catch (err) {
      set({ error: friendly(err) });
    }
  },

  refresh: refreshActive,

  /** Actualización optimista tras guardar (el tiempo real confirma después). */
  upsertSongLocal(s: BandSong) {
    const songs = state.songs.filter((x) => x.id !== s.id);
    if (!s.deleted) songs.push(s);
    songs.sort((a, b) => a.title.localeCompare(b.title));
    set({ songs });
    saveCache();
  },
  upsertEventLocal(e: BandEvent) {
    const events = state.events.filter((x) => x.id !== e.id);
    if (!e.deleted) events.push(e);
    events.sort((a, b) => b.event_date.localeCompare(a.event_date));
    set({ events });
    saveCache();
  },
};

export function useBand<T>(select: (s: BandState) => T): T {
  return useSyncExternalStore(bandStore.subscribe, () => select(state));
}

export const activeBand = () => state.bands.find((b) => b.id === state.activeId) ?? null;
export const myMember = () => state.members.find((m) => m.user_id === state.userId) ?? null;

/** Cifrado de la bóveda de la banda para una canción (por título normalizado). */
export function vaultSongByKey(songKey: string): BandSong | null {
  return state.songs.find((s) => s.song_key === songKey && !s.deleted) ?? null;
}
