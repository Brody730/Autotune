import { useEffect, useState } from 'react';
import { uid } from './store';

/**
 * Grabaciones en vivo guardadas en IndexedDB (en el dispositivo).
 * El audio se escribe en trozos de 2 s mientras se graba: si se cierra la
 * pestaña o se acaba la batería, lo grabado hasta ese momento no se pierde.
 */

export interface Marker {
  /** Segundos desde el inicio de la grabación. */
  t: number;
  title: string;
}

export interface RecordingMeta {
  id: string;
  name: string;
  sessionId: string | null;
  startedAt: number;
  duration: number;
  mime: string;
  size: number;
  markers: Marker[];
  finished: boolean;
}

const DB = 'lsa-recordings';
const META = 'meta';
const CHUNKS = 'chunks';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore(META, { keyPath: 'id' });
      d.createObjectStore(CHUNKS); // clave: [id, seq]
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
        t.onabort = () => reject(t.error);
      }),
  );
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function listRecordings(): Promise<RecordingMeta[]> {
  const all = await tx<RecordingMeta[]>([META], 'readonly', (t) => t.objectStore(META).getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRecordingBlob(id: string): Promise<Blob | null> {
  const meta = await tx<RecordingMeta | undefined>([META], 'readonly', (t) => t.objectStore(META).get(id));
  if (!meta) return null;
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  const parts = await tx<Blob[]>([CHUNKS], 'readonly', (t) => t.objectStore(CHUNKS).getAll(range));
  return new Blob(parts, { type: meta.mime });
}

export async function updateRecording(id: string, patch: Partial<RecordingMeta>) {
  await tx([META], 'readwrite', (t) => {
    const s = t.objectStore(META);
    const g = s.get(id);
    g.onsuccess = () => g.result && s.put({ ...g.result, ...patch });
  });
  notify();
}

export async function deleteRecording(id: string) {
  await tx([META, CHUNKS], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    t.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
  notify();
}

export function useRecordings() {
  const [list, setList] = useState<RecordingMeta[]>([]);
  useEffect(() => {
    const load = () => void listRecordings().then(setList).catch(() => setList([]));
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, []);
  return list;
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  const est = await navigator.storage?.estimate?.();
  return est ? { used: est.usage ?? 0, quota: est.quota ?? 0 } : null;
}

/** Graba un MediaStream a IndexedDB con marcadores por canción. */
export class LiveRecorder {
  readonly id = uid();
  private rec: MediaRecorder;
  private seq = 0;
  private size = 0;
  private t0 = 0;
  private markers: Marker[] = [];
  private meta: RecordingMeta;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(stream: MediaStream, name: string, sessionId: string | null) {
    const mime =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      ) ?? '';
    this.rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 128000 });
    this.meta = {
      id: this.id,
      name,
      sessionId,
      startedAt: Date.now(),
      duration: 0,
      mime: this.rec.mimeType || mime || 'audio/webm',
      size: 0,
      markers: [],
      finished: false,
    };
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const seq = this.seq++;
      this.size += e.data.size;
      const blob = e.data;
      this.writing = this.writing.then(() =>
        tx([CHUNKS, META], 'readwrite', (t) => {
          t.objectStore(CHUNKS).put(blob, [this.id, seq]);
          t.objectStore(META).put({ ...this.meta, size: this.size, duration: this.elapsed(), markers: this.markers });
        }),
      );
    };
  }

  elapsed() {
    return this.t0 ? (performance.now() - this.t0) / 1000 : 0;
  }

  async start() {
    await tx([META], 'readwrite', (t) => void t.objectStore(META).put(this.meta));
    this.t0 = performance.now();
    this.rec.start(2000);
    notify();
  }

  mark(title: string) {
    const last = this.markers[this.markers.length - 1];
    if (last?.title === title) return;
    this.markers.push({ t: Math.round(this.elapsed()), title });
  }

  async stop(): Promise<RecordingMeta> {
    const done = new Promise<void>((r) => (this.rec.onstop = () => r()));
    if (this.rec.state !== 'inactive') this.rec.stop();
    await done;
    await this.writing;
    this.meta = { ...this.meta, duration: this.elapsed(), size: this.size, markers: this.markers, finished: true };
    await tx([META], 'readwrite', (t) => void t.objectStore(META).put(this.meta));
    notify();
    return this.meta;
  }
}

export function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtSize(b: number) {
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
}
