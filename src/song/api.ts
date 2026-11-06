import { buildSong, Song } from './lyrics';
import { cleanTitle, normalize } from './text';

/**
 * Servicios externos (todos con CORS abierto, sin backend propio):
 *  - AudD findLyrics: busca canciones por un fragmento de letra (sin token, con límites).
 *  - AudD recognize: huella de audio tipo Shazam (solo grabaciones; token recomendado).
 *  - LRCLIB: letras, muchas sincronizadas en formato LRC. Gratis y sin clave.
 */
const AUDD = 'https://api.audd.io';
const LRCLIB = 'https://lrclib.net/api';

export interface Candidate {
  title: string;
  artist: string;
}

interface LrclibItem {
  id: number;
  trackName: string;
  artistName: string;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

async function getJson<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Busca canciones cuyo texto contenga el fragmento escuchado. */
export async function findByLyrics(fragment: string, token: string, signal?: AbortSignal): Promise<Candidate[]> {
  const u = new URL(`${AUDD}/findLyrics/`);
  u.searchParams.set('q', fragment);
  if (token) u.searchParams.set('api_token', token);
  const data = await getJson<{ status: string; result?: { title: string; artist: string }[]; error?: { error_message: string } }>(
    u.toString(),
    undefined,
    signal,
  );
  if (data.status !== 'success') throw new Error(data.error?.error_message ?? 'AudD error');
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of data.result ?? []) {
    const k = normalize(cleanTitle(r.title)) + '|' + normalize(r.artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: r.title, artist: r.artist });
  }
  return out;
}

export interface Recognition extends Candidate {
  /** Posición (s) dentro de la grabación donde empieza el fragmento. */
  timecode: number | null;
}

/** Huella de audio: envía unos segundos grabados del micrófono. */
export async function recognizeAudio(blob: Blob, token: string, signal?: AbortSignal): Promise<Recognition | null> {
  const fd = new FormData();
  fd.append('file', blob, 'clip.webm');
  if (token) fd.append('api_token', token);
  const data = await getJson<{
    status: string;
    result: { title: string; artist: string; timecode?: string } | null;
    error?: { error_message: string };
  }>(`${AUDD}/`, { method: 'POST', body: fd }, signal);
  if (data.status !== 'success') throw new Error(data.error?.error_message ?? 'AudD error');
  if (!data.result) return null;
  const tc = data.result.timecode?.split(':').map(Number);
  const timecode = tc && tc.every((n) => !Number.isNaN(n)) ? tc.reduce((acc, n) => acc * 60 + n, 0) : null;
  return { title: data.result.title, artist: data.result.artist, timecode };
}

function pickBest(items: LrclibItem[], wanted?: Candidate): LrclibItem | null {
  const usable = items.filter((i) => !i.instrumental && (i.syncedLyrics || i.plainLyrics));
  if (!usable.length) return null;
  const wa = wanted ? normalize(wanted.artist) : '';
  const rank = (i: LrclibItem) =>
    (i.syncedLyrics ? 2 : 0) + (wa && normalize(i.artistName).includes(wa.split(' ')[0] ?? '') ? 3 : 0);
  return [...usable].sort((a, b) => rank(b) - rank(a))[0];
}

function toSong(item: LrclibItem, source: Song['source']): Song | null {
  return buildSong(
    { id: `lrclib:${item.id}`, title: item.trackName, artist: item.artistName, duration: item.duration, source },
    item.syncedLyrics,
    item.plainLyrics,
  );
}

/** Obtiene la letra de una canción concreta (título + artista). */
export async function fetchLyrics(c: Candidate, source: Song['source'], signal?: AbortSignal): Promise<Song | null> {
  const title = cleanTitle(c.title) || c.title;
  const u = new URL(`${LRCLIB}/search`);
  u.searchParams.set('track_name', title);
  u.searchParams.set('artist_name', c.artist);
  let items = await getJson<LrclibItem[]>(u.toString(), undefined, signal);
  if (!pickBest(items, c)) {
    // El artista a veces no coincide (versiones, "en Español", etc.): buscar solo por título
    const u2 = new URL(`${LRCLIB}/search`);
    u2.searchParams.set('track_name', title);
    items = await getJson<LrclibItem[]>(u2.toString(), undefined, signal);
  }
  const best = pickBest(items, c);
  return best ? toSong(best, source) : null;
}

/** Búsqueda manual por título / artista (repertorio). */
export async function searchSongs(query: string, signal?: AbortSignal): Promise<Song[]> {
  const u = new URL(`${LRCLIB}/search`);
  u.searchParams.set('q', query);
  const items = await getJson<LrclibItem[]>(u.toString(), undefined, signal);
  const seen = new Set<string>();
  return items
    .filter((i) => !i.instrumental && (i.syncedLyrics || i.plainLyrics))
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
    .filter((i) => {
      const k = normalize(i.trackName) + '|' + normalize(i.artistName);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8)
    .map((i) => toSong(i, 'manual'))
    .filter((s): s is Song => s !== null);
}
