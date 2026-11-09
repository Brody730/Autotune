import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * JAM en vivo: quien dirige (normalmente el teléfono de la voz principal,
 * que escucha el micrófono) transmite por Supabase Realtime lo que está
 * pasando; cada integrante lo ve en su pantalla según su rol.
 *
 * Canal: `jam:<bandId>` · eventos: state (anfitrión → todos), cue (avisos del
 * director: «Coro», «Final»…), hello (alguien entra y pide el estado).
 */

export interface JamChord {
  pos: number;
  /** Acorde ya transportado, en la notación del anfitrión. */
  name: string;
  /** Nota del bajo (raíz o la nota tras «/»). */
  bass: string;
}

export interface JamLine {
  lyric: string;
  chords: JamChord[];
}

export interface JamState {
  host: { userId: string; name: string };
  song: { title: string; artist: string; songKey: string } | null;
  line: number;
  lines: { prev: string | null; cur: string | null; next: string | null; next2: string | null };
  chordLines: { cur: JamLine | null; next: JamLine | null };
  /** Tono que se está cantando y tono destino de los acordes. */
  keyLabel: string | null;
  targetLabel: string | null;
  shift: number;
  note: string | null;
  live: boolean;
  bpm: number | null;
  /** Servicio en curso y posición en su lista. */
  setlist: { title: string; songs: string[]; index: number } | null;
  ts: number;
}

export interface JamCue {
  text: string;
  from: string;
  ts: number;
}

export interface JamPeer {
  userId: string;
  name: string;
  role: string;
  host: boolean;
}

export type JamMode = 'off' | 'host' | 'listen';

export const CUES = ['Coro', 'Estrofa', 'Puente', 'Repetir', 'Instrumental', 'Subir 🔥', 'Bajar 🙏', 'Solo voz', 'Final'];

export function useJam(opts: {
  bandId: string | null;
  mode: JamMode;
  me: { userId: string; name: string; role: string } | null;
}) {
  const { bandId, mode, me } = opts;
  const [peers, setPeers] = useState<JamPeer[]>([]);
  const [state, setState] = useState<JamState | null>(null);
  const [cue, setCue] = useState<JamCue | null>(null);
  const [connected, setConnected] = useState(false);
  const chan = useRef<RealtimeChannel | null>(null);
  const lastState = useRef<JamState | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!supabase || !bandId || !me || mode === 'off') {
      setPeers([]);
      setConnected(false);
      return;
    }
    const c = supabase.channel(`jam:${bandId}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: me.userId } },
    });
    c.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (modeRef.current === 'listen') setState(payload as JamState);
    })
      .on('broadcast', { event: 'cue' }, ({ payload }) => setCue(payload as JamCue))
      .on('broadcast', { event: 'hello' }, () => {
        // Alguien entró: el anfitrión le manda el estado completo
        if (modeRef.current === 'host' && lastState.current) {
          void c.send({ type: 'broadcast', event: 'state', payload: lastState.current });
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const ps = c.presenceState<JamPeer>();
        setPeers(Object.values(ps).map((arr) => arr[0]).filter(Boolean));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          await c.track({ userId: me.userId, name: me.name, role: me.role, host: mode === 'host' });
          if (mode === 'listen') void c.send({ type: 'broadcast', event: 'hello', payload: {} });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnected(false);
        }
      });
    chan.current = c;
    return () => {
      chan.current = null;
      setConnected(false);
      void supabase?.removeChannel(c);
    };
  }, [bandId, mode, me?.userId, me?.name, me?.role]);

  // Latido: reenviar el estado cada 4 s (por si alguien se perdió un mensaje)
  useEffect(() => {
    if (mode !== 'host') return;
    const id = window.setInterval(() => {
      if (chan.current && lastState.current) {
        void chan.current.send({ type: 'broadcast', event: 'state', payload: { ...lastState.current, ts: Date.now() } });
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [mode]);

  return {
    peers,
    state,
    cue,
    connected,
    publish(s: JamState) {
      lastState.current = s;
      if (chan.current && modeRef.current === 'host') {
        void chan.current.send({ type: 'broadcast', event: 'state', payload: s });
      }
    },
    sendCue(text: string) {
      if (!me) return;
      const p: JamCue = { text, from: me.name, ts: Date.now() };
      setCue(p);
      void chan.current?.send({ type: 'broadcast', event: 'cue', payload: p });
    },
  };
}
