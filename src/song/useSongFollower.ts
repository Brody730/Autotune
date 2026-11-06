import { useCallback, useEffect, useRef, useState } from 'react';
import { Candidate, fetchLyrics, findByLyrics, recognizeAudio } from './api';
import { lineAtTime, Song } from './lyrics';
import { alignLine, songScore } from './matcher';
import { addToLibrary, librarySongs } from './library';
import { SpeechListener, speechSupported } from './speech';
import { cleanTitle, normalize, tokens } from './text';

export type SpeechState = 'off' | 'on' | 'unsupported' | 'error';

export interface FollowerSettings {
  /** Escuchar la letra con reconocimiento de voz. */
  listen: boolean;
  lang: string;
  /** Token opcional de AudD (https://dashboard.audd.io). */
  token: string;
}

const SEARCH_MIN_WORDS = 5;
const SEARCH_INTERVAL_MS = 4000;
const SWITCH_INTERVAL_MS = 3000;
const ACCEPT_SCORE = 0.3;
const CLIP_SECONDS = 9;

/** Ventana de "lo cantado recientemente" para detectar cambios de canción. */
const WINDOW_MS = 9000;
const WINDOW_MIN_TOKENS = 6;
/** Por debajo de esto, lo que se canta ya no parece la canción actual. */
const LOW_FIT = 0.25;
/** Tras este tiempo sin coincidir y sin encontrar otra, se suelta la canción. */
const DROP_AFTER_MS = 25000;
/** La canción terminó si el reloj pasó la última línea por esto y nadie la canta. */
const END_GRACE_S = 20;

interface Heard {
  at: number;
  tokens: string[];
  raw: string[];
}

const songKey = (title: string) => normalize(cleanTitle(title) || title);

export function useSongFollower(getStream: () => MediaStream | null, settings: FollowerSettings) {
  const [song, setSongState] = useState<Song | null>(null);
  const [line, setLineState] = useState(-1);
  const [pos, setPos] = useState<number | null>(null);
  const [speech, setSpeech] = useState<SpeechState>('off');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const [heardText, setHeardText] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<string | null>(null);
  const [autoTime, setAutoTime] = useState(true);
  /** 0..1: cuánto coincide lo cantado recientemente con la canción actual. */
  const [fit, setFit] = useState<number | null>(null);
  /** Historial de canciones de la sesión (para el medley). */
  const [history, setHistory] = useState<{ title: string; artist: string }[]>([]);

  const songRef = useRef<Song | null>(null);
  const lineRef = useRef(-1);
  const anchor = useRef<{ pos: number; at: number } | null>(null);
  const heard = useRef<string[]>([]); // tokens desde la última canción
  const heardRaw = useRef<string[]>([]);
  const recent = useRef<Heard[]>([]); // ventana deslizante
  const lowFitSince = useRef<number | null>(null);
  const lastAlignedAt = useRef(0);
  const lastQueryAt = useRef(0);
  const lastQuery = useRef('');
  const searching = useRef(false);
  const lyricsCache = useRef(new Map<string, Song | null>());
  const noticeTimer = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const autoTimeRef = useRef(autoTime);
  autoTimeRef.current = autoTime;

  const setNotice = useCallback((msg: string | null, autoHideMs = 0) => {
    window.clearTimeout(noticeTimer.current);
    setNoticeState(msg);
    if (msg && autoHideMs) noticeTimer.current = window.setTimeout(() => setNoticeState(null), autoHideMs);
  }, []);

  const setLine = useCallback((i: number) => {
    lineRef.current = i;
    setLineState(i);
  }, []);

  const clockPos = () => (anchor.current ? anchor.current.pos + (performance.now() - anchor.current.at) / 1000 : null);

  const windowTokens = () => recent.current.flatMap((h) => h.tokens);
  const windowRaw = () => recent.current.flatMap((h) => h.raw);

  const setSong = useCallback(
    (s: Song | null, startPos: number | null = null) => {
      songRef.current = s;
      setSongState(s);
      setCandidates([]);
      lowFitSince.current = null;
      setFit(null);
      anchor.current = s && s.synced && startPos !== null ? { pos: startPos, at: performance.now() } : null;
      if (s && s.synced && startPos !== null) setLine(lineAtTime(s, startPos));
      else setLine(-1);
      setPos(startPos);
      if (s) {
        addToLibrary(s);
        lastAlignedAt.current = performance.now();
        setHistory((h) => (h[h.length - 1]?.title === s.title ? h : [...h, { title: s.title, artist: s.artist }].slice(-12)));
      }
    },
    [setLine],
  );

  /** Re-sincroniza el reloj de la canción con la línea i. */
  const anchorTo = useCallback((i: number, force = false) => {
    const s = songRef.current;
    const t = s?.lines[i]?.t;
    if (!s || t === null || t === undefined) return;
    const now = clockPos();
    const clockLine = now !== null ? lineAtTime(s, now) : -1;
    if (force || now === null || clockLine !== i) {
      anchor.current = { pos: t + 0.4, at: performance.now() };
    }
  }, []);

  const jumpTo = useCallback(
    (i: number) => {
      const s = songRef.current;
      if (!s) return;
      const idx = Math.max(0, Math.min(s.lines.length - 1, i));
      setLine(idx);
      anchorTo(idx, true);
      lastAlignedAt.current = performance.now();
    },
    [anchorTo, setLine],
  );

  /** Empieza una canción nueva a partir de lo que se acaba de escuchar. */
  const adopt = useCallback(
    (s: Song, basis: string[]) => {
      setSong(s);
      const a = alignLine(basis, s.lines, -1);
      if (a) {
        setLine(a.index);
        anchorTo(a.index, true);
      }
      // Lo escuchado de la canción anterior ya no cuenta
      heard.current = basis.slice(-40);
      heardRaw.current = windowRaw().slice(-40);
    },
    [anchorTo, setLine, setSong],
  );

  const lyricsFor = useCallback(async (c: Candidate): Promise<Song | null> => {
    const k = songKey(c.title) + '|' + normalize(c.artist);
    if (lyricsCache.current.has(k)) return lyricsCache.current.get(k) ?? null;
    const s = await fetchLyrics(c, 'voz').catch(() => null);
    lyricsCache.current.set(k, s);
    return s;
  }, []);

  /**
   * Busca la canción que se está cantando.
   * mode 'new': no hay canción. mode 'switch': hay una pero ya no coincide (medley).
   */
  const trySearch = useCallback(
    async (mode: 'new' | 'switch') => {
      if (searching.current) return;
      // En medley se buscan solo las 2 últimas frases: la canción nueva
      const lastPhrases = recent.current.slice(-2);
      const basis = mode === 'new' ? heard.current : lastPhrases.flatMap((h) => h.tokens);
      const raw = mode === 'new' ? heardRaw.current : lastPhrases.flatMap((h) => h.raw);
      if (basis.length < SEARCH_MIN_WORDS) return;

      // 1) Repertorio local: instantáneo, sin red ni límite de consultas
      {
        const current = songRef.current;
        const curFit = current ? songScore(basis, current) : 0;
        const minScore = mode === 'new' ? ACCEPT_SCORE : ACCEPT_SCORE + 0.05;
        let best: Song | null = null;
        let bestScore = 0;
        for (const s of librarySongs()) {
          if (current && songKey(s.title) === songKey(current.title)) continue;
          const sc = songScore(basis, s);
          if (sc > bestScore) {
            bestScore = sc;
            best = s;
          }
        }
        if (best && bestScore >= minScore && bestScore > curFit + 0.15) {
          if (current) setNotice(`Medley: de «${current.title}» a «${best.title}»`, 5000);
          else setNotice(null);
          adopt(best, basis);
          return;
        }
      }

      // 2) Búsqueda en línea (AudD), con freno para no agotar el límite
      const now = Date.now();
      if (now - lastQueryAt.current < (mode === 'new' ? SEARCH_INTERVAL_MS : SWITCH_INTERVAL_MS)) return;
      const query = raw.slice(-10).join(' ');
      if (query === lastQuery.current) return;
      lastQuery.current = query;
      lastQueryAt.current = now;
      searching.current = true;
      if (mode === 'new') setBusy('Buscando la canción por la letra…');
      try {
        const current = songRef.current;
        const found = (await findByLyrics(query, settingsRef.current.token))
          .filter((c) => !current || songKey(c.title) !== songKey(current.title))
          .slice(0, 4);
        if (!found.length) return;
        const songs = await Promise.all(found.map(lyricsFor));
        let best: Song | null = null;
        let bestScore = 0;
        for (const s of songs) {
          if (!s) continue;
          const sc = songScore(basis, s);
          if (sc > bestScore) {
            bestScore = sc;
            best = s;
          }
        }
        if (mode === 'new') {
          if (songRef.current) return; // el usuario eligió una mientras tanto
          if (best && bestScore >= ACCEPT_SCORE) {
            adopt(best, basis);
            setNotice(null);
          } else {
            setCandidates(found);
          }
        } else {
          const cur = songRef.current;
          if (!cur || songKey(cur.title) !== songKey(current?.title ?? '')) return;
          const curFit = songScore(basis, cur);
          if (best && bestScore >= ACCEPT_SCORE + 0.05 && bestScore > curFit + 0.15) {
            setNotice(`Medley: de «${cur.title}» a «${best.title}»`, 5000);
            adopt(best, basis);
          } else {
            setCandidates(found);
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (/limit was reached|api_token/i.test(msg)) {
          setNotice('Se acabaron las búsquedas gratis de AudD por hoy. Pon tu token en ⚙ (las canciones ya reconocidas siguen funcionando desde tu repertorio).');
        } else {
          setNotice(`Búsqueda por letra falló: ${msg}`, 6000);
        }
      } finally {
        searching.current = false;
        setBusy(null);
      }
    },
    [adopt, lyricsFor, setNotice],
  );

  const dropSong = useCallback(
    (reason: string) => {
      setSong(null);
      heard.current = windowTokens();
      heardRaw.current = windowRaw();
      lastQuery.current = '';
      setNotice(reason, 6000);
    },
    [setNotice, setSong],
  );

  // ── Texto reconocido ───────────────────────────────────────────────────
  const onText = useCallback(
    (text: string, final: boolean) => {
      const t = tokens(text);
      if (!t.length) return;
      const now = performance.now();
      const combined = heard.current.concat(t);
      if (final) {
        const raw = text.trim().split(/\s+/);
        heard.current = combined.slice(-40);
        heardRaw.current = heardRaw.current.concat(raw).slice(-40);
        recent.current = recent.current.filter((h) => now - h.at < WINDOW_MS).concat({ at: now, tokens: t, raw });
        setHeardText(heardRaw.current.slice(-14).join(' '));
      }

      const s = songRef.current;
      if (!s) {
        if (final || t.length >= 7) void trySearch('new');
        return;
      }

      const a = alignLine(combined, s.lines, lineRef.current);
      if (a) {
        if (a.index !== lineRef.current) setLine(a.index);
        anchorTo(a.index);
        lastAlignedAt.current = now;
      }

      if (!final) return;
      // ¿Lo que se canta ahora sigue siendo esta canción? (medley)
      // Se mira lo último (2 frases): si no coincide, se busca ya la siguiente.
      const last = recent.current.slice(-2).flatMap((h) => h.tokens);
      if (last.length >= WINDOW_MIN_TOKENS) {
        const f = songScore(last, s);
        setFit(f);
        if (f >= LOW_FIT) {
          lowFitSince.current = null;
        } else {
          lowFitSince.current ??= now;
          if (now - lowFitSince.current >= DROP_AFTER_MS) {
            dropSong(`Ya no se canta «${s.title}». Escuchando la siguiente…`);
          } else {
            void trySearch('switch');
          }
        }
      }
    },
    [anchorTo, dropSong, setLine, trySearch],
  );

  // ── Ciclo de vida del reconocimiento de voz ─────────────────────────────
  useEffect(() => {
    if (!settings.listen) {
      setSpeech('off');
      return;
    }
    if (!speechSupported()) {
      setSpeech('unsupported');
      return;
    }
    setSpeechError(null);
    const l = new SpeechListener(settings.lang, {
      onFinal: (txt) => {
        setInterim('');
        onText(txt, true);
      },
      onInterim: (txt) => {
        setInterim(txt);
        if (txt) onText(txt, false);
      },
      onError: (code) => {
        if (code === 'network') {
          setSpeech('unsupported');
          setSpeechError('Este navegador no tiene servicio de voz (Brave lo bloquea). Usa Chrome o Edge, o «Identificar audio».');
        } else if (code === 'not-allowed' || code === 'service-not-allowed') {
          setSpeech('error');
          setSpeechError('Permiso de reconocimiento de voz denegado.');
        } else if (code === 'unsupported') {
          setSpeech('unsupported');
        } else {
          setSpeechError(`Voz: ${code}`);
        }
      },
    });
    l.start();
    setSpeech('on');
    return () => l.stop();
  }, [settings.listen, settings.lang, onText]);

  // ── Reloj de la canción (letra sincronizada) ────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = songRef.current;
      const p = clockPos();
      setPos(p);
      if (!s || !s.synced || p === null) return;
      // ¿Terminó la canción? (y nadie la está cantando)
      const lastT = s.lines[s.lines.length - 1]?.t ?? 0;
      const end = Math.max(lastT + 8, s.duration ?? 0);
      if (p > end + END_GRACE_S - 8 && performance.now() - lastAlignedAt.current > END_GRACE_S * 1000) {
        dropSong(`Terminó «${s.title}». Escuchando la siguiente…`);
        return;
      }
      // Si lo cantado ya no coincide (posible cambio de canción), no avanzar sola
      if (!autoTimeRef.current || lowFitSince.current !== null) return;
      const idx = lineAtTime(s, p);
      if (idx !== lineRef.current && idx >= lineRef.current) setLine(idx);
    }, 200);
    return () => window.clearInterval(id);
  }, [dropSong, setLine]);

  // ── Huella de audio (tipo Shazam) ──────────────────────────────────────
  const identifyAudio = useCallback(async () => {
    const stream = getStream();
    if (!stream || busy) return;
    if (typeof MediaRecorder === 'undefined') {
      setNotice('Este navegador no puede grabar audio.');
      return;
    }
    setNotice(null);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const clipStart = performance.now();
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    for (let s = CLIP_SECONDS; s > 0; s--) {
      setBusy(`Escuchando… ${s}s`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await done;
    setBusy('Identificando…');
    try {
      const r = await recognizeAudio(new Blob(chunks, { type: rec.mimeType }), settingsRef.current.token);
      if (!r) {
        setNotice('No se reconoció como una grabación conocida. Si es en vivo, deja que la app escuche la letra.');
        return;
      }
      setBusy('Buscando letra…');
      const s = await fetchLyrics(r, 'huella');
      if (!s) {
        setNotice(`Es «${r.title}» de ${r.artist}, pero no encontré la letra.`);
        return;
      }
      const startPos = r.timecode !== null ? r.timecode + (performance.now() - clipStart) / 1000 : null;
      setSong(s, startPos);
      heard.current = [];
      heardRaw.current = [];
      setAutoTime(true);
    } catch (err) {
      setNotice(`Identificación falló: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [busy, getStream, setNotice, setSong]);

  const chooseCandidate = useCallback(
    async (c: Candidate) => {
      setBusy('Cargando letra…');
      try {
        const s = await lyricsFor(c);
        if (!s) {
          setNotice(`No encontré la letra de «${c.title}».`, 6000);
          return;
        }
        adopt(s, windowTokens().length ? windowTokens() : heard.current);
        setNotice(null);
      } finally {
        setBusy(null);
      }
    },
    [adopt, lyricsFor, setNotice],
  );

  const chooseSong = useCallback(
    (s: Song) => {
      setSong(s);
      heard.current = [];
      heardRaw.current = [];
      setNotice(null);
    },
    [setNotice, setSong],
  );

  const clearSong = useCallback(() => {
    setSong(null);
    heard.current = [];
    heardRaw.current = [];
    recent.current = [];
    lastQuery.current = '';
    setHeardText('');
    setNotice(null);
  }, [setNotice, setSong]);

  return {
    song,
    line,
    pos,
    fit,
    history,
    speech,
    speechError,
    interim,
    heardText,
    candidates,
    busy,
    notice,
    autoTime,
    setAutoTime,
    identifyAudio,
    chooseCandidate,
    chooseSong,
    clearSong,
    jumpTo,
    dismissNotice: () => setNotice(null),
  };
}
