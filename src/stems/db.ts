import { useEffect, useState } from 'react';
import { EngineTrack } from './api';

/**
 * Biblioteca de pistas separadas, guardada en este dispositivo (IndexedDB):
 * los MP3 de cada instrumento y el análisis. Una vez guardada, la canción se
 * puede practicar sin el motor y sin internet.
 */

export interface TrackEdit {
  semitones: number;
  speed: number;
}

export interface StoredTrack extends EngineTrack {
  /** Tono y velocidad con que están guardados los audios. */
  edit: TrackEdit;
  volumes: Record<string, number>;
  /** Cifrado (acordes + letra si se encontró), en el tono original. */
  sheet: string;
  /** Letra sincronizada (LRC) si se encontró. */
  lrc: string | null;
  size: number;
}

const DB = 'lsa-tracks';
const META = 'meta';
const AUDIO = 'audio';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(AUDIO); // clave: [id, pista]
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        const r = fn(t);
        t.oncomplete = () => resolve(r ? (r.result as T) : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('Sin espacio para guardar la pista'));
      }),
  );
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function listTracks(): Promise<StoredTrack[]> {
  const all = await tx<StoredTrack[]>([META], 'readonly', (t) => t.objectStore(META).getAll());
  return all.sort((a, b) => b.created - a.created);
}

export const getTrack = (id: string) => tx<StoredTrack | undefined>([META], 'readonly', (t) => t.objectStore(META).get(id));

export async function saveTrack(track: StoredTrack, audio: Record<string, Blob>) {
  const size = Object.values(audio).reduce((n, b) => n + b.size, 0);
  await tx([META, AUDIO], 'readwrite', (t) => {
    // Quitar audios de una versión anterior (p. ej. otro tono)
    t.objectStore(AUDIO).delete(IDBKeyRange.bound([track.id, ''], [track.id, '￿']));
    for (const [stem, blob] of Object.entries(audio)) t.objectStore(AUDIO).put(blob, [track.id, stem]);
    t.objectStore(META).put({ ...track, size });
  });
  notify();
}

export async function updateTrack(id: string, patch: Partial<StoredTrack>) {
  await tx([META], 'readwrite', (t) => {
    const s = t.objectStore(META);
    const g = s.get(id);
    g.onsuccess = () => g.result && s.put({ ...g.result, ...patch });
  });
  notify();
}

export async function getStems(track: StoredTrack): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const stem of track.stems) {
    const b = await tx<Blob | undefined>([AUDIO], 'readonly', (t) => t.objectStore(AUDIO).get([track.id, stem]));
    if (b) out[stem] = b;
  }
  return out;
}

export async function deleteTrack(id: string) {
  await tx([META, AUDIO], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    t.objectStore(AUDIO).delete(IDBKeyRange.bound([id, ''], [id, '￿']));
  });
  notify();
}

export function useTracks() {
  const [list, setList] = useState<StoredTrack[] | null>(null);
  useEffect(() => {
    const load = () => void listTracks().then(setList).catch(() => setList([]));
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, []);
  return list;
}
