import { buildSong, Song } from './lyrics';
import { cleanTitle, normalize } from './text';

/**
 * Repertorio local: cada canción reconocida o elegida se guarda en este
 * navegador. Al buscar, primero se compara contra el repertorio (sin red,
 * instantáneo y sin gastar consultas de AudD). En iglesias el repertorio se
 * repite mucho, así que la mayoría de cambios de canción se resuelven aquí.
 */

interface StoredSong {
  id: string;
  title: string;
  artist: string;
  duration: number | null;
  synced: string | null;
  plain: string | null;
  lastUsed: number;
}

const KEY = 'lsa.library';
const MAX_SONGS = 80;

const keyOf = (title: string) => normalize(cleanTitle(title) || title);

let cache: Song[] | null = null;

function readStored(): StoredSong[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as StoredSong[];
  } catch {
    return [];
  }
}

export function librarySongs(): Song[] {
  if (cache) return cache;
  cache = readStored()
    .map((s) =>
      buildSong({ id: s.id, title: s.title, artist: s.artist, duration: s.duration, source: 'voz' }, s.synced, s.plain),
    )
    .filter((s): s is Song => s !== null);
  return cache;
}

export function addToLibrary(song: Song) {
  const list = readStored().filter((s) => keyOf(s.title) !== keyOf(song.title));
  list.unshift({
    id: song.id,
    title: song.title,
    artist: song.artist,
    duration: song.duration,
    synced: song.raw.synced,
    plain: song.raw.plain,
    lastUsed: Date.now(),
  });
  const trimmed = list.slice(0, MAX_SONGS);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Sin espacio: guardar menos
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed.slice(0, 30)));
    } catch {
      /* noop */
    }
  }
  cache = null;
}

export const librarySize = () => readStored().length;
