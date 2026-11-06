import { useEffect, useRef } from 'react';
import { MusicalKey } from '../audio/music';
import { sheetKeyFor } from '../song/ChordSheet';
import type { Song } from '../song/lyrics';
import { KeyRef, SessionItem, SessionRecord, store, uid } from './store';

/** Pasado este tiempo sin canciones, lo siguiente es una sesión nueva. */
const NEW_SESSION_AFTER_MS = 30 * 60 * 1000;

const toRef = (k: MusicalKey | null): KeyRef | null => (k ? { root: k.root, scale: k.scale } : null);

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

/**
 * Registra automáticamente lo que se tocó: cada canción reconocida pasa a
 * ser un ítem de la sesión con el tono y el rango de notas en que se cantó.
 * Una sesión con 2+ canciones seguidas es un medley que se puede guardar.
 */
export function useSessionTracker(opts: {
  song: Song | null;
  keyRef: React.MutableRefObject<MusicalKey | null>;
  /** Se llama con cada nota estable cantada (MIDI redondeado). */
  noteSink: React.MutableRefObject<((midi: number) => void) | null>;
  recordingId: string | null;
}) {
  const session = useRef<SessionRecord | null>(null);
  const notes = useRef<number[]>([]);
  const current = useRef<{ key: string; item: SessionItem } | null>(null);

  // Cada nota estable va al rango de la canción actual
  useEffect(() => {
    opts.noteSink.current = (m) => {
      if (!current.current) return;
      const n = notes.current;
      n.push(Math.round(m));
      if (n.length > 6000) n.splice(0, n.length - 6000);
    };
    return () => {
      opts.noteSink.current = null;
    };
  }, [opts.noteSink]);

  const closeItem = () => {
    const c = current.current;
    const s = session.current;
    if (!c || !s) return;
    const sorted = [...notes.current].sort((a, b) => a - b);
    const enough = sorted.length >= 40;
    const item: SessionItem = {
      ...c.item,
      endedAt: Date.now(),
      sungKey: toRef(opts.keyRef.current),
      low: enough ? percentile(sorted, 0.05) : null,
      high: enough ? percentile(sorted, 0.95) : null,
    };
    s.items = s.items.map((it) => (it === c.item ? item : it));
    s.endedAt = item.endedAt;
    current.current = { key: c.key, item };
    const prev = store.song(c.key);
    store.upsertSong(c.key, item.title, item.artist, {
      sungKey: item.sungKey ?? prev?.sungKey ?? null,
      sungLow: item.low ?? prev?.sungLow ?? null,
      sungHigh: item.high ?? prev?.sungHigh ?? null,
    });
    store.upsertSession({ ...s });
  };

  // Cambio de canción → cerrar la anterior y abrir la nueva
  const songId = opts.song?.id ?? null;
  useEffect(() => {
    const song = opts.song;
    if (current.current) closeItem();
    current.current = null;
    notes.current = [];
    if (!song) return;

    const now = Date.now();
    if (!session.current || now - session.current.endedAt > NEW_SESSION_AFTER_MS) {
      const d = new Date(now);
      session.current = {
        id: uid(),
        name: `Sesión ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        startedAt: now,
        endedAt: now,
        items: [],
        saved: false,
        recordingId: opts.recordingId,
        updated: now,
      };
    }
    const key = sheetKeyFor(song.title);
    const item: SessionItem = {
      songKey: key,
      title: song.title,
      artist: song.artist,
      startedAt: now,
      endedAt: now,
      sungKey: null,
      low: null,
      high: null,
    };
    session.current.items = [...session.current.items, item];
    current.current = { key, item };
    const prev = store.song(key);
    store.upsertSong(key, song.title, song.artist, { plays: (prev?.plays ?? 0) + 1, lastPlayed: now });
    store.upsertSession({ ...session.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  // Guardar tono/rango periódicamente (por si se cierra la app)
  useEffect(() => {
    const id = window.setInterval(() => current.current && closeItem(), 15000);
    const onHide = () => current.current && closeItem();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vincular la grabación a la sesión
  useEffect(() => {
    if (opts.recordingId && session.current && !session.current.recordingId) {
      session.current.recordingId = opts.recordingId;
      store.upsertSession({ ...session.current });
    }
  }, [opts.recordingId]);

  return { sessionId: () => session.current?.id ?? null };
}
