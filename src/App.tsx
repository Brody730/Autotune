import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetectedFrame, PitchEngine } from './audio/engine';
import {
  centsOff,
  chordName,
  diatonicChords,
  inferKey,
  keyLabel,
  keyUsesFlats,
  MAJOR_SCALE,
  MINOR_SCALE,
  midiToNoteName,
  MusicalKey,
  Notation,
  pc,
  pcName,
  suggestChord,
} from './audio/music';
import { LyricsStrip, SongBar } from './song/SongBar';
import { chordToString, inferSheetKey, mapLyricsToSheet, parseSheet, shiftedKey, transposeShift } from './song/chords';
import { keyName, loadSheet, SheetEditor, StoredSheet, Transpose } from './song/ChordSheet';
import { useSongFollower } from './song/useSongFollower';
import { useAuth } from './lib/auth';
import { showDonations, DONATE_URL } from './lib/config';
import { fmtDuration, LiveRecorder } from './lib/recordings';
import { useSessionTracker } from './lib/sessionTracker';
import { useStore } from './lib/store';
import { AccountPanel } from './views/AccountPanel';
import { BandEvent } from './band/api';
import { bandStore, useBand, vaultSongByKey } from './band/bandStore';
import { JamLine, JamMode, JamState, useJam } from './band/jam';
import { roleById } from './band/roles';
import { BandPanel } from './views/band/BandPanel';
import { CueBanner, JamView, PeerChips } from './views/band/JamView';
import { bassOf, SheetLine, sheetLyrics } from './song/chords';
import { sheetKeyFor } from './song/ChordSheet';
import { buildSong, Song } from './song/lyrics';
import { librarySongs, setExtraSongs } from './song/library';
import { keyShiftBetween } from './lib/voice';
import { LibraryPanel } from './views/LibraryPanel';

/** Recordatorio de donación: como mucho una vez cada 14 días, y solo tras grabar. */
function shouldNudge(): boolean {
  if (!showDonations) return false;
  try {
    const last = Number(localStorage.getItem('lsa.nudge') || 0);
    if (Date.now() - last < 14 * 24 * 3600 * 1000) return false;
    localStorage.setItem('lsa.nudge', String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

type MicStatus = 'idle' | 'starting' | 'active' | 'suspended' | 'error';

const HISTORY_HALF_LIFE_S = 25; // memoria de la tonalidad
const KEY_EVAL_MS = 250;
const KEY_SWITCH_EVALS = 6; // ~1.5 s de consistencia para cambiar de tono
const NOTE_HOLD_MS = 450; // la nota sigue visible tras dejar de cantar
const TRAIL_LEN = 14;

interface TrailNote {
  id: number;
  pc: number;
}

function readPref<T extends string>(k: string, fallback: T): T {
  try {
    return (localStorage.getItem(k) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* noop */
  }
}

export default function App() {
  const engineRef = useRef<PitchEngine | null>(null);

  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => readPref('lsa.device', ''));
  const [deviceLabel, setDeviceLabel] = useState('');
  const [restart, setRestart] = useState(0);
  const [notation, setNotation] = useState<Notation>(() => readPref<Notation>('lsa.notation', 'latin'));

  // Estado musical
  const [level, setLevel] = useState(0);
  const [midi, setMidi] = useState<number | null>(null);
  const [freq, setFreq] = useState<number | null>(null);
  const [live, setLive] = useState(false); // ¿hay voz ahora mismo?
  const [key, setKey] = useState<MusicalKey | null>(null);
  const [keyLocked, setKeyLocked] = useState(false);
  const [trail, setTrail] = useState<TrailNote[]>([]);
  const [histogram, setHistogram] = useState<number[]>(() => new Array(12).fill(0));

  // Reconocimiento de canción + letra
  const [songCfg, setSongCfg] = useState(() => ({
    listen: readPref('lsa.listen', 'on') === 'on',
    lang: readPref('lsa.lang', 'es-MX'),
    token: readPref('lsa.audd', ''),
  }));
  const updateSongCfg = (p: Partial<typeof songCfg>) => {
    setSongCfg((c) => {
      const n = { ...c, ...p };
      writePref('lsa.listen', n.listen ? 'on' : 'off');
      writePref('lsa.lang', n.lang);
      writePref('lsa.audd', n.token);
      return n;
    });
  };
  const getStream = useCallback(() => engineRef.current?.mediaStream ?? null, []);

  // Cuenta (inicia la sincronización si hay sesión), vistas y grabación
  const { user } = useAuth();
  const profileName = useStore((d) => d.profile.displayName);
  const [view, setView] = useState<'stage' | 'library' | 'account' | 'band'>('stage');
  const [jamMode, setJamMode] = useState<JamMode>('off');
  const [jamEvent, setJamEvent] = useState<BandEvent | null>(null);
  const [setIndex, setSetIndex] = useState(0);
  const pendingShift = useRef<number | null>(null);
  const recorderRef = useRef<LiveRecorder | null>(null);
  const [recInfo, setRecInfo] = useState<{ id: string; t0: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; library?: boolean; donate?: boolean } | null>(null);
  const keyRef = useRef<MusicalKey | null>(null);
  const noteSink = useRef<((m: number) => void) | null>(null);
  const onStage = useRef(true);
  onStage.current = view === 'stage';
  const follower = useSongFollower(getStream, songCfg);
  const { jumpTo, line: lyricLine, song } = follower;

  // Flechas ↑/↓ o PageUp/PageDown (pedal Bluetooth) para mover la letra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!song || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        jumpTo(lyricLine + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        jumpTo(lyricLine - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [song, lyricLine, jumpTo]);

  // Refs de procesamiento (no disparan renders)
  const recentMidi = useRef<number[]>([]);
  const hist = useRef<number[]>(new Array(12).fill(0));
  const lastFrameAt = useRef(performance.now());
  const lastVoicedAt = useRef(0);
  const stablePc = useRef<{ pc: number; since: number; pushed: boolean } | null>(null);
  const trailId = useRef(0);
  const keyCandidate = useRef<{ k: MusicalKey; count: number } | null>(null);
  const keyLockedRef = useRef(keyLocked);
  keyLockedRef.current = keyLocked;

  const handleFrame = useCallback((f: DetectedFrame) => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - lastFrameAt.current) / 1000);
    lastFrameAt.current = now;
    setLevel((prev) => (f.level > prev ? f.level : prev * 0.85 + f.level * 0.15));

    if (f.midi === null) {
      if (now - lastVoicedAt.current > NOTE_HOLD_MS) {
        setLive(false);
        recentMidi.current = [];
      }
      return;
    }

    lastVoicedAt.current = now;
    // Mediana de las últimas 5 lecturas: elimina saltos de octava espurios
    const buf = recentMidi.current;
    buf.push(f.midi);
    if (buf.length > 5) buf.shift();
    const sorted = [...buf].sort((a, b) => a - b);
    const m = sorted[sorted.length >> 1];
    setMidi(m);
    setFreq(440 * Math.pow(2, (m - 69) / 12));
    setLive(true);
    // Solo cuenta para el rango de la canción si se está en el escenario
    // (no durante la prueba de rango vocal u otras pantallas)
    if (onStage.current) noteSink.current?.(m);

    // Histograma con decaimiento exponencial, ponderado por duración
    const decay = Math.pow(0.5, dt / HISTORY_HALF_LIFE_S);
    const h = hist.current;
    for (let i = 0; i < 12; i++) h[i] *= decay;
    const notePc = pc(m);
    // Notas desafinadas (> 35 cents) cuentan menos: suelen ser transiciones
    h[notePc] += dt * (Math.abs(centsOff(m)) > 35 ? 0.3 : 1);

    // Rastro de notas: solo notas sostenidas > 120 ms
    const s = stablePc.current;
    if (!s || s.pc !== notePc) {
      stablePc.current = { pc: notePc, since: now, pushed: false };
    } else if (!s.pushed && now - s.since > 120) {
      s.pushed = true;
      setTrail((t) => [...t.slice(-(TRAIL_LEN - 1)), { id: trailId.current++, pc: notePc }]);
    }
  }, []);

  // Arranque / reinicio del motor de audio
  useEffect(() => {
    const engine = new PitchEngine();
    engineRef.current = engine;
    let cancelled = false;

    (async () => {
      setMicStatus('starting');
      setErrorMessage(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('Este navegador no permite acceder al micrófono (¿página sin HTTPS?)'), {
            name: 'NotSupportedError',
          });
        }
        try {
          await engine.start(handleFrame, deviceId || undefined);
        } catch (err) {
          // Si el dispositivo guardado ya no existe, reintentar con el predeterminado
          if (deviceId && (err as Error).name === 'OverconstrainedError') {
            setDeviceId('');
            writePref('lsa.device', '');
            return;
          }
          throw err;
        }
        if (cancelled) return;
        setDeviceLabel(engine.trackLabel);
        setMicStatus(engine.state === 'running' ? 'active' : 'suspended');
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(list.filter((d) => d.kind === 'audioinput'));
      } catch (err) {
        if (cancelled) return;
        console.error('[LSA] mic error:', err);
        const name = (err as Error)?.name ?? 'Error';
        const msg =
          name === 'NotAllowedError'
            ? 'Permiso de micrófono denegado. Haz clic en el icono del candado/micrófono de la barra de direcciones y permite el acceso.'
            : name === 'NotFoundError'
              ? 'No se encontró ningún micrófono conectado.'
              : name === 'NotReadableError'
                ? 'El micrófono está siendo usado por otra aplicación.'
                : `${name}: ${(err as Error)?.message ?? 'desconocido'}`;
        setErrorMessage(msg);
        setMicStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      void engine.stop();
    };
  }, [deviceId, restart, handleFrame]);

  // Evaluación periódica de la tonalidad (con histéresis)
  useEffect(() => {
    const id = window.setInterval(() => {
      setHistogram([...hist.current]);
      if (keyLockedRef.current) return;
      const k = inferKey(hist.current);
      if (!k) return;
      setKey((current) => {
        if (!current) return k;
        if (k.root === current.root && k.scale === current.scale) {
          keyCandidate.current = null;
          return { ...current, confidence: k.confidence };
        }
        const c = keyCandidate.current;
        if (c && c.k.root === k.root && c.k.scale === k.scale) {
          c.count++;
          if (c.count >= KEY_SWITCH_EVALS) {
            keyCandidate.current = null;
            return k;
          }
        } else {
          keyCandidate.current = { k, count: 1 };
        }
        return current;
      });
    }, KEY_EVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Mantener la pantalla encendida en escenario
  useEffect(() => {
    if (micStatus !== 'active') return;
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinel> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      void lock?.release();
    };
  }, [micStatus]);

  const resumeAudio = async () => {
    await engineRef.current?.resume();
    if (engineRef.current?.state === 'running') setMicStatus('active');
  };

  const [sheetStored, setSheetStored] = useState<StoredSheet | null>(null);
  const [editingSheet, setEditingSheet] = useState(false);
  const [manualShift, setManualShift] = useState<number | null>(null);

  const resetSession = () => {
    hist.current = new Array(12).fill(0);
    setHistogram(new Array(12).fill(0));
    setKey(null);
    setKeyLocked(false);
    setTrail([]);
    keyCandidate.current = null;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  // ── Derivados ─────────────────────────────────────────────────────────────
  const flats = keyUsesFlats(key);
  const note = midi !== null ? midiToNoteName(midi, notation, flats) : null;
  const cents = midi !== null ? centsOff(midi) : 0;
  const notePc = midi !== null ? pc(midi) : null;
  const chords = useMemo(() => (key ? diatonicChords(key) : []), [key]);
  const suggested = live && notePc !== null ? suggestChord(chords, notePc) : null;
  const scalePcs = key ? (key.scale === 'major' ? MAJOR_SCALE : MINOR_SCALE).map((i) => (key.root + i) % 12) : [];
  const inScale = notePc !== null && key ? scalePcs.includes(notePc) : true;
  const histMax = Math.max(...histogram, 1e-6);
  const tuneClass = Math.abs(cents) <= 10 ? 'in-tune' : Math.abs(cents) <= 25 ? 'near' : 'off';

  // ── Cifrado original + transposición al tono cantado ──────────────────────
  const songId = song?.id;
  // El cifrado de la bóveda de la banda tiene prioridad sobre el personal
  const sheetFromVault = (title: string): StoredSheet | null => {
    const v = vaultSongByKey(sheetKeyFor(title));
    return v?.sheet ? { text: v.sheet, key: v.orig_key, title: v.title, artist: v.artist, updated: Date.parse(v.updated_at) } : null;
  };
  useEffect(() => {
    setSheetStored(song ? sheetFromVault(song.title) ?? loadSheet(song.title) : null);
    // Si se eligió desde la lista del servicio, usar el tono acordado
    setManualShift(pendingShift.current);
    pendingShift.current = null;
    if (song) {
      // Medley: la canción nueva puede ir en otro tono → olvidar casi todo el anterior
      hist.current = hist.current.map((v) => v * 0.2);
      keyCandidate.current = null;
      setKeyLocked(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);
  const sheetLines = useMemo(() => (sheetStored ? parseSheet(sheetStored.text) : null), [sheetStored]);
  const origKey = useMemo<MusicalKey | null>(
    () => (sheetStored?.key ? { ...sheetStored.key, confidence: 1 } : sheetLines ? inferSheetKey(sheetLines) : null),
    [sheetStored, sheetLines],
  );
  const autoShift = origKey && key ? transposeShift(origKey, key) : 0;
  const shift = manualShift ?? autoShift;
  const targetKey = origKey ? shiftedKey(origKey, shift) : null;
  const tp: Transpose = { shift, notation, flats: keyUsesFlats(targetKey) };
  const lyricMap = useMemo(
    () => (song && sheetLines ? mapLyricsToSheet(song.lines.map((l) => l.tokens), sheetLines) : null),
    [song, sheetLines],
  );
  const sheetFor =
    lyricMap && sheetLines ? (i: number) => (lyricMap[i] !== undefined && lyricMap[i] >= 0 ? sheetLines[lyricMap[i]] : null) : undefined;
  const lineSheet = sheetFor && lyricLine >= 0 ? sheetFor(lyricLine) : null;
  const shiftLabel = shift === 0 ? 'mismo tono' : `${shift > 0 ? '+' : '−'}${Math.abs(shift)} semitono${Math.abs(shift) === 1 ? '' : 's'}`;

  // ── Modo banda: bóveda, servicios y JAM en vivo ───────────────────────────
  const userId = user?.id ?? null;
  useEffect(() => {
    void bandStore.setUser(userId);
  }, [userId]);
  const bandId = useBand((s) => s.activeId);
  const vaultSongs = useBand((s) => s.songs);
  const bandMembers = useBand((s) => s.members);
  // Si alguien de la banda edita el cifrado de la canción actual, se actualiza al instante
  useEffect(() => {
    if (song) {
      const v = sheetFromVault(song.title);
      if (v) setSheetStored(v);
    }
    // Las canciones de la bóveda también se reconocen por voz (aunque no estén en internet)
    setExtraSongs(
      vaultSongs
        .map((v) =>
          buildSong({ id: `band:${v.id}`, title: v.title, artist: v.artist, source: 'banda' }, null, sheetLyrics(v.sheet)),
        )
        .filter((s): s is Song => s !== null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultSongs]);

  const me = bandMembers.find((m) => m.user_id === userId) ?? null;
  const [jamRole, setJamRole] = useState<string>(() => readPref('lsa.jamRole', ''));
  const effectiveRole = jamRole || me?.role || 'voz';
  const jamMe = useMemo(
    () => (userId ? { userId, name: me?.display_name || profileName || 'Integrante', role: jamMode === 'host' ? me?.role ?? 'voz' : effectiveRole } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, me?.display_name, me?.role, profileName, jamMode, effectiveRole],
  );
  const jam = useJam({ bandId, mode: jamMode, me: jamMe });

  // Lista del servicio en la JAM: elegir canción a mano (si el reconocimiento no la agarra)
  const pickSetlistSong = (i: number, ev: BandEvent | null = jamEvent) => {
    if (!ev) return;
    const it = ev.items[i];
    const v = vaultSongs.find((s) => s.id === it?.songId);
    if (!it || !v) return;
    setSetIndex(i);
    const lib = librarySongs().find((s) => sheetKeyFor(s.title) === v.song_key && s.synced);
    const built = lib ?? buildSong({ id: `band:${v.id}`, title: v.title, artist: v.artist, source: 'banda' }, null, sheetLyrics(v.sheet));
    const orig = v.orig_key ?? (() => {
      const k = inferSheetKey(parseSheet(v.sheet));
      return k ? { root: k.root, scale: k.scale } : null;
    })();
    pendingShift.current = it.key && orig ? keyShiftBetween(orig, it.key) : null;
    if (built) follower.chooseSong(built);
  };
  // Si el reconocimiento cambia de canción y está en la lista, avanzar el marcador
  useEffect(() => {
    if (!jamEvent || !song) return;
    const k = sheetKeyFor(song.title);
    const idx = jamEvent.items.findIndex((it) => vaultSongs.find((v) => v.id === it.songId)?.song_key === k);
    if (idx >= 0) setSetIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  // Transmitir el estado a la banda (quien dirige)
  const noteLabel = live && note ? `${note.name}${note.octave}` : null;
  const lastNotePub = useRef(0);
  const lastSig = useRef('');
  useEffect(() => {
    if (jamMode !== 'host' || !userId) return;
    const now = Date.now();
    const toJamLine = (l: SheetLine | null): JamLine | null =>
      l
        ? {
            lyric: l.lyric,
            chords: l.chords.map((c) => ({
              pos: c.pos,
              name: chordToString(c.chord, shift, notation, tp.flats),
              bass: bassOf(c.chord, shift, notation, tp.flats),
            })),
          }
        : null;
    const s: JamState = {
      host: { userId, name: jamMe?.name ?? '' },
      song: song ? { title: song.title, artist: song.artist, songKey: sheetKeyFor(song.title) } : null,
      line: lyricLine,
      lines: {
        prev: song && lyricLine > 0 ? song.lines[lyricLine - 1]?.text ?? null : null,
        cur: song && lyricLine >= 0 ? song.lines[lyricLine]?.text ?? null : null,
        next: song ? song.lines[lyricLine + 1]?.text ?? null : null,
        next2: song ? song.lines[lyricLine + 2]?.text ?? null : null,
      },
      chordLines: {
        cur: sheetFor && lyricLine >= 0 ? toJamLine(sheetFor(lyricLine)) : null,
        next: sheetFor ? toJamLine(sheetFor(lyricLine + 1)) : null,
      },
      keyLabel: key ? keyLabel(key, notation) : null,
      targetLabel: targetKey ? keyLabel(targetKey, notation) : null,
      shift,
      note: noteLabel,
      live,
      bpm: song ? vaultSongByKey(sheetKeyFor(song.title))?.bpm ?? null : null,
      setlist: jamEvent
        ? {
            title: jamEvent.title,
            songs: jamEvent.items.map((it) => vaultSongs.find((v) => v.id === it.songId)?.title ?? '—'),
            index: setIndex,
          }
        : null,
      ts: now,
    };
    // La nota cambia muy seguido: si SOLO cambió la nota, como mucho 4 envíos por segundo
    const sig = JSON.stringify({ ...s, note: null, live: null, ts: 0 });
    const onlyNote = sig === lastSig.current;
    if (onlyNote && now - lastNotePub.current < 250) return;
    lastSig.current = sig;
    lastNotePub.current = now;
    jam.publish(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jamMode, songId, lyricLine, shift, notation, sheetLines, key?.root, key?.scale, noteLabel, live, jamEvent, setIndex]);

  // Enlace de invitación (?unirse=CODIGO): abrir el panel de la banda
  useEffect(() => {
    if (new URLSearchParams(location.search).get('unirse')) setView(user ? 'band' : 'account');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  // ── Sesiones (medleys) y grabación en vivo ────────────────────────────────
  keyRef.current = key;
  const tracker = useSessionTracker({ song, keyRef, noteSink, recordingId: recInfo?.id ?? null });

  const startRecording = async () => {
    const stream = engineRef.current?.mediaStream;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setToast({ text: 'No se puede grabar: el micrófono no está activo en este navegador.' });
      return;
    }
    const d = new Date();
    const r = new LiveRecorder(
      stream,
      `En vivo ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      tracker.sessionId(),
    );
    await r.start();
    if (song) r.mark(song.title);
    recorderRef.current = r;
    setRecInfo({ id: r.id, t0: Date.now() });
    navigator.storage?.persist?.().catch(() => undefined); // pedir que el navegador no borre las grabaciones
  };

  const stopRecording = async () => {
    const r = recorderRef.current;
    if (!r) return;
    recorderRef.current = null;
    setRecInfo(null);
    const meta = await r.stop();
    setToast({ text: `⏺ Grabación guardada (${fmtDuration(meta.duration)}). Está en Biblioteca → Grabaciones.`, library: true, donate: shouldNudge() });
  };

  // Marcar en la grabación cada canción que se reconoce
  useEffect(() => {
    if (song && recorderRef.current) recorderRef.current.mark(song.title);
  }, [song]);

  // Cronómetro de la grabación
  const [, tick] = useState(0);
  useEffect(() => {
    if (!recInfo) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [recInfo]);

  // Avisar antes de cerrar la pestaña si se está grabando
  useEffect(() => {
    if (!recInfo) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [recInfo]);

  const LEDS = 16;
  const litLeds = Math.round(level * LEDS);

  return (
    <div className={`stage ${live ? 'is-live' : ''}`}>
      <div className="spotlight" aria-hidden />

      {/* ── Barra superior ─────────────────────────── */}
      <header className="topbar">
        <div className="brand">
          <span className={`onair ${micStatus === 'active' ? 'on' : ''}`}>ON AIR</span>
          <span className="brand-name">
            Live Stage Assistant
            <small>Para ministerios de alabanza</small>
          </span>
        </div>

        <button
          className={`ctl rec ${recInfo ? 'on' : ''}`}
          onClick={() => void (recInfo ? stopRecording() : startRecording())}
          disabled={micStatus !== 'active'}
          title={recInfo ? 'Detener y guardar la grabación' : 'Grabar en vivo'}
        >
          <span className="rec-dot" />
          {recInfo ? `${fmtDuration((Date.now() - recInfo.t0) / 1000)} · Detener` : 'REC'}
        </button>
        <button
          className={`ctl nav ${jamMode !== 'off' ? 'amber' : ''}`}
          onClick={() => (jamMode === 'listen' ? setView('stage') : setView('band'))}
          title="Ministerio: servicios, bóveda de cifrados y JAM en vivo"
        >
          👥 <span>{jamMode === 'host' ? `JAM · ${jam.peers.length}` : 'Banda'}</span>
        </button>
        <button className="ctl nav" onClick={() => setView('library')} title="Canciones, medleys y grabaciones">
          📚 <span>Biblioteca</span>
        </button>
        <button className="ctl nav account" onClick={() => setView('account')} title="Cuenta">
          <span className="avatar sm">{(profileName || user?.email || '').slice(0, 1).toUpperCase() || '👤'}</span>
          <span>{user ? 'Cuenta' : 'Entrar'}</span>
        </button>

        <div className="meter" title="Nivel de entrada">
          {Array.from({ length: LEDS }, (_, i) => (
            <span
              key={i}
              className={`led ${i < litLeds ? 'lit' : ''} ${i >= LEDS - 2 ? 'red' : i >= LEDS - 5 ? 'amber' : ''}`}
            />
          ))}
        </div>

        <div className="controls">
          <select
            className="ctl device"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              writePref('lsa.device', e.target.value);
            }}
            title={deviceLabel || 'Micrófono'}
          >
            <option value="">🎤 Predeterminado</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Micrófono ${i + 1}`}
                </option>
              ))}
          </select>
          <div className="seg" role="group" aria-label="Notación">
            {(['latin', 'english'] as Notation[]).map((n) => (
              <button
                key={n}
                className={notation === n ? 'on' : ''}
                onClick={() => {
                  setNotation(n);
                  writePref('lsa.notation', n);
                }}
              >
                {n === 'latin' ? 'Do' : 'C'}
              </button>
            ))}
          </div>
          <button className="ctl icon" onClick={resetSession} title="Reiniciar tonalidad">
            ↺
          </button>
          <button className="ctl icon" onClick={toggleFullscreen} title="Pantalla completa">
            ⛶
          </button>
        </div>
      </header>

      <div className="bars">
        <SongBar
          f={follower}
          settings={{ ...songCfg, onChange: updateSongCfg }}
          hasSheet={!!sheetStored}
          onEditSheet={() => setEditingSheet(true)}
        />
        {jamMode === 'host' ? (
          <section className="jambar">
            <span className={`onair ${jam.connected ? 'on' : ''}`}>JAM</span>
            <PeerChips peers={jam.peers} />
            {jamEvent ? (
              <span className="jb-set">
                <button className="ctl small" disabled={setIndex <= 0} onClick={() => pickSetlistSong(setIndex - 1)} title="Canción anterior del servicio">
                  ⏮
                </button>
                <select value={setIndex} onChange={(e) => pickSetlistSong(Number(e.target.value))}>
                  {jamEvent.items.map((it, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {vaultSongs.find((v) => v.id === it.songId)?.title ?? '—'}
                    </option>
                  ))}
                </select>
                <button
                  className="ctl small"
                  disabled={setIndex >= jamEvent.items.length - 1}
                  onClick={() => pickSetlistSong(setIndex + 1)}
                  title="Siguiente canción del servicio"
                >
                  ⏭
                </button>
              </span>
            ) : null}
            <span className="cues">
              {['Coro', 'Repetir', 'Puente', 'Final', 'Subir 🔥', 'Bajar 🙏'].map((c) => (
                <button key={c} className="ctl small" onClick={() => jam.sendCue(c)}>
                  {c}
                </button>
              ))}
            </span>
            <button
              className="ctl small danger"
              onClick={() => {
                setJamMode('off');
                setJamEvent(null);
              }}
            >
              Terminar JAM
            </button>
          </section>
        ) : null}
      </div>
      {jamMode === 'host' ? <CueBanner cue={jam.cue} /> : null}
      {editingSheet && song ? (
        <SheetEditor
          title={song.title}
          artist={song.artist}
          notation={notation}
          onClose={() => setEditingSheet(false)}
          onSaved={(s) => {
            setSheetStored(s);
            setEditingSheet(false);
          }}
        />
      ) : null}

      {/* ── Escenario principal ────────────────────── */}
      <main className="main">
        <section className="hero">
          <div className="eyebrow">Nota en vivo</div>
          <div className={`note ${live ? 'live' : 'idle'} ${!inScale ? 'outside' : ''}`}>
            {note ? (
              <>
                <span className="note-name">{note.name}</span>
                <span className="note-oct">{note.octave}</span>
              </>
            ) : (
              <span className="note-wait">Canta…</span>
            )}
          </div>

          <div className={`tuner ${live ? '' : 'dim'} ${tuneClass}`}>
            <div className="tuner-scale">
              {[-50, -25, 0, 25, 50].map((t) => (
                <span key={t} style={{ left: `${50 + t}%` }} className={t === 0 ? 'zero' : ''} />
              ))}
              <div className="tuner-zone" />
              <div className="needle" style={{ left: `${50 + (live ? cents : 0)}%` }} />
            </div>
            <div className="tuner-read">
              <span>♭</span>
              <span className="cents">
                {live ? `${cents > 0 ? '+' : ''}${cents} cents` : '— cents'}
                {freq && live ? <em> · {freq.toFixed(1)} Hz</em> : null}
              </span>
              <span>♯</span>
            </div>
          </div>

          <LyricsStrip f={follower} sheetFor={sheetFor} t={sheetFor ? tp : undefined} />
        </section>

        <aside className="side">
          <div className={`card key-card ${keyLocked ? 'locked' : ''}`}>
            <div className="card-head">
              <span className="eyebrow">Tonalidad</span>
              <button
                className={`lock ${keyLocked ? 'on' : ''}`}
                onClick={() => setKeyLocked((v) => !v)}
                disabled={!key}
                title="Fijar tonalidad"
              >
                {keyLocked ? '🔒 Fija' : '🔓 Auto'}
              </button>
            </div>
            <div className="key-name">{key ? keyLabel(key, notation) : <span className="muted">Escuchando…</span>}</div>
            <div className="confidence">
              <div className="confidence-bar" style={{ width: `${Math.round((key?.confidence ?? 0) * 100)}%` }} />
            </div>
            <div className="scale-notes">
              {scalePcs.length
                ? scalePcs.map((p, i) => (
                    <span key={p} className={`sn ${p === notePc && live ? 'hit' : ''} ${i === 0 ? 'tonic' : ''}`}>
                      {pcName(p, notation, flats)}
                    </span>
                  ))
                : Array.from({ length: 7 }, (_, i) => <span key={i} className="sn ghost" />)}
            </div>
          </div>

          {sheetLines && origKey ? (
            <div className="card chord-card sheet">
              <span className="eyebrow">Acordes · transportados</span>
              <div className={`chord-big ${lineSheet?.chords.length ? 'on' : ''} ${(lineSheet?.chords.length ?? 0) > 2 ? 'many' : ''}`}>
                {lineSheet?.chords.length
                  ? lineSheet.chords.map((c, i) => (
                      <span key={i}>{chordToString(c.chord, shift, notation, tp.flats)}</span>
                    ))
                  : suggested
                    ? chordName(suggested, notation, flats)
                    : '—'}
              </div>
              <div className="transpose">
                <span className="tr-keys">
                  <span className="tr-orig">{keyName(origKey, notation)}</span>
                  <span className="tr-arrow">→</span>
                  <b>{keyName(targetKey, notation)}</b>
                </span>
                <span className="tr-shift">{key || manualShift !== null ? shiftLabel : 'esperando el tono…'}</span>
                <span className="tr-btns">
                  <button onClick={() => setManualShift((shift - 1 + 18) % 12 - 6)} title="Bajar un semitono">
                    −
                  </button>
                  <button
                    className={manualShift === null ? 'on' : ''}
                    onClick={() => setManualShift(null)}
                    title="Seguir el tono detectado"
                  >
                    auto
                  </button>
                  <button onClick={() => setManualShift((shift + 1 + 18) % 12 - 6)} title="Subir un semitono">
                    +
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <div className="card chord-card">
              <span className="eyebrow">Acorde sugerido</span>
              <div className={`chord-big ${suggested ? 'on' : ''}`}>
                {suggested ? chordName(suggested, notation, flats) : '—'}
              </div>
              <div className="chord-roman">{suggested ? suggested.roman : ' '}</div>
            </div>
          )}
        </aside>
      </main>

      {/* ── Campo armónico ─────────────────────────── */}
      <section className="field">
        <div className="field-head">
          <span className="eyebrow">Campo armónico</span>
          <div className="histo" title="Notas cantadas (memoria de tonalidad)">
            {histogram.map((v, i) => (
              <div key={i} className={`hb ${scalePcs.includes(i) ? 'in' : ''}`}>
                <div className="hb-fill" style={{ height: `${(v / histMax) * 100}%` }} />
                <span>{pcName(i, notation, flats).replace(/[#b]$/, (s) => (s === '#' ? '♯' : '♭'))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="chords">
          {chords.length
            ? chords.map((c) => (
                <div
                  key={c.degree}
                  className={`chord ${c.primary ? 'primary' : ''} ${suggested?.degree === c.degree ? 'active' : ''} ${
                    notePc !== null && live && c.tones.includes(notePc) ? 'fits' : ''
                  }`}
                >
                  <span className="roman">{c.roman}</span>
                  <span className="cname">{chordName(c, notation, flats)}</span>
                </div>
              ))
            : Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="chord ghost">
                  <span className="roman">·</span>
                  <span className="cname">&nbsp;</span>
                </div>
              ))}
        </div>
        <div className="trail">
          {trail.map((t) => (
            <span key={t.id} className={`tn ${scalePcs.length && !scalePcs.includes(t.pc) ? 'out' : ''}`}>
              {pcName(t.pc, notation, flats)}
            </span>
          ))}
        </div>
      </section>

      {/* ── Paneles (el audio sigue funcionando debajo) ── */}
      {view === 'library' ? <LibraryPanel notation={notation} onClose={() => setView('stage')} /> : null}
      {view === 'band' ? (
        <BandPanel
          notation={notation}
          loggedIn={!!user}
          onClose={() => setView('stage')}
          onLogin={() => setView('account')}
          onHostJam={(ev) => {
            setJamEvent(ev);
            setJamMode('host');
            setView('stage');
            if (ev?.items.length) {
              setSetIndex(0);
              // empezar con la primera canción del servicio (después la sigue la voz)
              pickSetlistSong(0, ev);
            }
          }}
          onJoinJam={() => {
            setJamMode('listen');
            setView('stage');
          }}
        />
      ) : null}
      {jamMode === 'listen' ? (
        <div className="jam-wrap">
          <JamView
            state={jam.state}
            cue={jam.cue}
            peers={jam.peers}
            connected={jam.connected}
            role={effectiveRole}
            setRole={(r) => {
              setJamRole(r);
              writePref('lsa.jamRole', r);
            }}
            onCue={jam.sendCue}
            canCue={roleById(effectiveRole).id === 'director'}
            onClose={() => setJamMode('off')}
          />
        </div>
      ) : null}
      {view === 'account' ? (
        <AccountPanel notation={notation} liveMidi={live ? midi : null} onClose={() => setView('stage')} />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.library ? (
            <button
              className="ctl small"
              onClick={() => {
                try {
                  localStorage.setItem('lsa.libtab', 'recordings');
                } catch {
                  /* noop */
                }
                setView('library');
                setToast(null);
              }}
            >
              Ver
            </button>
          ) : null}
          {toast.donate ? (
            <span className="toast-donate">
              ¿Te sirvió? La app es gratis;{' '}
              <a href={DONATE_URL} target="_blank" rel="noreferrer">
                apoya con un café ❤
              </a>
            </span>
          ) : null}
          <button className="toast-x" onClick={() => setToast(null)} aria-label="Cerrar">
            ✕
          </button>
        </div>
      ) : null}

      {/* ── Estados del micrófono ──────────────────── */}
      {micStatus !== 'active' && micStatus !== 'idle' ? (
        <div className="overlay">
          <div className="overlay-box">
            {micStatus === 'starting' ? (
              <>
                <div className="pulse" />
                <p>Conectando micrófono…</p>
              </>
            ) : micStatus === 'suspended' ? (
              <>
                <p>El navegador pausó el audio.</p>
                <button className="cta" onClick={resumeAudio}>
                  ▶ Activar audio
                </button>
              </>
            ) : (
              <>
                <p className="err-title">⚠ Sin micrófono</p>
                <p className="err-msg">{errorMessage}</p>
                <button className="cta" onClick={() => setRestart((r) => r + 1)}>
                  Reintentar
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
