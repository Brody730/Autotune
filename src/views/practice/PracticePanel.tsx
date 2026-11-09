import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { keyLabel, keyUsesFlats, MusicalKey, Notation, pcName } from '../../audio/music';
import { useBand } from '../../band/bandStore';
import { getRecordingBlob } from '../../lib/recordings';
import { useStore } from '../../lib/store';
import { defaultLatencyMs, PracticeSession, Results } from '../../practice/engine';
import { addPractice, bestScore, practiceHistory } from '../../practice/history';
import { STYLES, styleById } from '../../practice/styles';
import { buildTimeline, progressionOf } from '../../practice/timeline';
import { shiftedKey } from '../../song/chords';
import { Panel } from '../LibraryPanel';
import { sheetOrigKey } from '../band/SheetText';
import { Highway } from './Highway';

interface PracticeSong {
  key: string;
  title: string;
  artist: string;
  sheet: string;
  orig: { root: number; scale: 'major' | 'minor' } | null;
  bpm: number | null;
  from: 'banda' | 'mía';
}

function readNum(k: string, d: number) {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v !== 0 ? v : d;
  } catch {
    return d;
  }
}
function saveNum(k: string, v: number) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* noop */
  }
}

export function PracticePanel({
  notation,
  getStream,
  initialSongKey,
  onClose,
}: {
  notation: Notation;
  getStream(): MediaStream | null;
  initialSongKey?: string | null;
  onClose(): void;
}) {
  const vault = useBand((s) => s.songs);
  const mine = useStore((d) => d.songs);
  const songs = useMemo<PracticeSong[]>(() => {
    const out: PracticeSong[] = vault.map((v) => ({ key: v.song_key, title: v.title, artist: v.artist, sheet: v.sheet, orig: sheetOrigKey(v.sheet, v.orig_key), bpm: v.bpm, from: 'banda' }));
    for (const s of Object.values(mine)) {
      if (s.deleted || !s.sheet || out.some((o) => o.key === s.key)) continue;
      out.push({ key: s.key, title: s.title, artist: s.artist, sheet: s.sheet, orig: sheetOrigKey(s.sheet, s.origKey), bpm: null, from: 'mía' });
    }
    return out.filter((s) => progressionOf(s.sheet).length > 0).sort((a, b) => a.title.localeCompare(b.title));
  }, [vault, mine]);

  const [songKey, setSongKey] = useState<string>(() => initialSongKey ?? '');
  const song = songs.find((s) => s.key === songKey) ?? songs[0] ?? null;
  const [styleId, setStyleId] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('lsa.practice.style')) || 'nortena');
  const style = styleById(styleId);
  const [bpm, setBpm] = useState(() => song?.bpm ?? style.defaultBpm);
  const [shift, setShift] = useState(0);
  const [barsPerChord, setBarsPerChord] = useState(style.beatsPerBar <= 3 ? 2 : 1);
  const [guide, setGuide] = useState(true);
  const [record, setRecord] = useState(true);
  const [volume, setVolume] = useState(() => readNum('lsa.practice.volume', 0.8));
  const [latency, setLatency] = useState(defaultLatencyMs);
  const [maxChords, setMaxChords] = useState(0);

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const sessionRef = useRef<PracticeSession | null>(null);

  // Al cambiar de canción/estilo, BPM sugerido
  useEffect(() => {
    setBpm(song?.bpm ?? style.defaultBpm);
    setBarsPerChord(style.beatsPerBar <= 3 ? 2 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.key, styleId]);

  const flats = keyUsesFlats(song?.orig ? shiftedKey({ ...song.orig, confidence: 1 } as MusicalKey, shift) : null);
  const nameOf = useMemo(() => (m: number) => pcName(m, notation, flats), [notation, flats]);

  const start = async () => {
    setError(null);
    const stream = getStream();
    if (!stream) {
      setError('No hay micrófono/interfaz activo. Cierra este panel, elige tu interfaz en el selector 🎤 de arriba y permite el acceso.');
      return;
    }
    if (!song) return;
    const tl = buildTimeline({ sheet: song.sheet, style, bpm, shift, barsPerChord, notation, flats, maxChords });
    if (!tl.bass.length) {
      setError('Esta canción no tiene acordes reconocibles para practicar.');
      return;
    }
    const s = new PracticeSession(stream, tl, style, { guide, latencyMs: latency, volume, record, title: `${song.title} (${style.name})` });
    s.onChange = force;
    sessionRef.current = s;
    try {
      await s.start();
      // Solo en desarrollo: acceso para pruebas automáticas
      if (import.meta.env.DEV) (window as unknown as { __lsaPractice: PracticeSession }).__lsaPractice = s;
      setResults(null);
      setSession(s);
    } catch (e) {
      setError(`No se pudo iniciar el audio: ${(e as Error).message}`);
    }
  };

  const finish = async () => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    const r = await s.stop();
    setSession(null);
    setResults(r);
    if (song && r.perfect + r.good + r.miss > 0) {
      addPractice({
        id: `${Date.now()}`,
        songKey: song.key,
        title: song.title,
        style: style.id,
        bpm,
        shift,
        score: r.score,
        perfect: r.perfect,
        good: r.good,
        miss: r.miss,
        extras: r.extras.length,
        maxStreak: r.maxStreak,
        recordingId: r.recordingId,
        date: Date.now(),
      });
    }
  };

  // Fin automático al terminar la canción
  useEffect(() => {
    if (session && session.finished) void finish();
  });
  // Detener todo si se cierra el panel
  useEffect(() => () => void sessionRef.current?.stop(), []);

  const close = () => {
    void sessionRef.current?.stop();
    onClose();
  };

  return (
    <Panel title="🎮 Práctica" onClose={close}>
      {session ? (
        <Playing session={session} nameOf={nameOf} onStop={() => void finish()} guide={guide} setGuide={(v) => (setGuide(v), session.setGuide(v))} />
      ) : results ? (
        <ResultsView
          r={results}
          title={song?.title ?? ''}
          styleName={style.name}
          best={song ? bestScore(song.key, style.id) : null}
          latency={latency}
          onAdjustLatency={(ms) => {
            setLatency(ms);
            saveNum('lsa.practice.latency', ms);
          }}
          onAgain={() => void start()}
          onBack={() => setResults(null)}
        />
      ) : !songs.length ? (
        <div className="empty">
          <p>Para practicar necesitas una canción con acordes.</p>
          <p>Sube un cifrado a la bóveda de tu banda (👥 Banda → Bóveda) o a tu biblioteca personal.</p>
        </div>
      ) : (
        <div className="practice-setup">
          <p className="muted-text">
            Conecta tu bajo a la interfaz, elige la canción y el estilo, y toca sobre la pista. La app escucha cada nota y te da tu puntaje.
          </p>
          <label className="field">
            Canción
            <select value={song?.key ?? ''} onChange={(e) => setSongKey(e.target.value)}>
              {songs.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title} {s.from === 'banda' ? '· bóveda' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="style-grid">
            {STYLES.map((s) => (
              <button
                key={s.id}
                className={`style-card ${s.id === styleId ? 'on' : ''}`}
                onClick={() => {
                  setStyleId(s.id);
                  try {
                    localStorage.setItem('lsa.practice.style', s.id);
                  } catch {
                    /* noop */
                  }
                }}
              >
                <span className="sc-emoji">{s.emoji}</span>
                <b>{s.name}</b>
                <small>
                  {s.beatsPerBar}/4 · {s.defaultBpm} bpm
                </small>
              </button>
            ))}
          </div>
          <div className="suggest dim">💡 {style.tip}</div>

          <div className="form-grid">
            <label className="field">
              Velocidad: <b>{bpm} BPM</b>
              <input type="range" min={40} max={220} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            </label>
            <label className="field">
              Tono {song?.orig ? <b>{keyLabel(shiftedKey({ ...song.orig, confidence: 1 } as MusicalKey, shift), notation)}</b> : null}
              <span className="tr-btns">
                <button onClick={() => setShift(((shift + 17) % 12) - 6)}>−½</button>
                <button className={shift === 0 ? 'on' : ''} onClick={() => setShift(0)}>
                  original
                </button>
                <button onClick={() => setShift(((shift + 19) % 12) - 6)}>+½</button>
              </span>
            </label>
            <label className="field">
              Compases por acorde
              <select value={barsPerChord} onChange={(e) => setBarsPerChord(Number(e.target.value))}>
                <option value={0.5}>½ compás</option>
                <option value={1}>1 compás</option>
                <option value={2}>2 compases</option>
                <option value={4}>4 compases</option>
              </select>
            </label>
            <label className="field">
              Practicar
              <select value={maxChords} onChange={(e) => setMaxChords(Number(e.target.value))}>
                <option value={0}>Toda la canción ({song ? progressionOf(song.sheet).length : 0} acordes)</option>
                <option value={4}>Primeros 4 acordes</option>
                <option value={8}>Primeros 8 acordes</option>
                <option value={16}>Primeros 16 acordes</option>
              </select>
            </label>
          </div>

          <div className="form-grid">
            <label className="field row-check">
              <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /> Bajo guía (la app toca la línea contigo)
            </label>
            <label className="field row-check">
              <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> Grabar mi toma (con la pista)
            </label>
            <label className="field">
              Volumen de la pista
              <input
                type="range"
                min={0.1}
                max={1.5}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  saveNum('lsa.practice.volume', Number(e.target.value));
                }}
              />
            </label>
            <label className="field">
              Latencia: <b>{latency} ms</b>
              <input
                type="range"
                min={0}
                max={300}
                step={5}
                value={latency}
                onChange={(e) => {
                  setLatency(Number(e.target.value));
                  saveNum('lsa.practice.latency', Number(e.target.value));
                }}
              />
              <small>Si siempre sales «atrasado» aunque toques a tiempo, súbela (al terminar te la sugiero).</small>
            </label>
          </div>

          {error ? <p className="err-text">{error}</p> : null}
          <div className="row-btns">
            <button className="cta big" onClick={() => void start()} disabled={!song}>
              ▶ Tocar
            </button>
            {song ? <span className="muted-text">Tu mejor puntaje aquí: {bestScore(song.key, style.id) ?? '—'}{bestScore(song.key, style.id) !== null ? '%' : ''}</span> : null}
          </div>
          <RecentPractice />
        </div>
      )}
    </Panel>
  );
}

function Playing({
  session,
  nameOf,
  onStop,
  guide,
  setGuide,
}: {
  session: PracticeSession;
  nameOf(m: number): string;
  onStop(): void;
  guide: boolean;
  setGuide(v: boolean): void;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, []);
  const tl = session.tl;
  const now = session.beatNow();
  const ci = Math.max(0, Math.min(tl.chords.length - 1, tl.chords.findIndex((c) => now < c.endBeat)));
  const cur = tl.chords[ci];
  const next = tl.chords[ci + 1];
  const judged = session.judges.filter(Boolean);
  const hits = session.judges.filter((j) => j === 'perfect' || j === 'good').length;
  const lastJudge = [...session.judges].reverse().find((j) => j !== null);
  const pct = Math.max(0, Math.min(1, now / tl.totalBeats));

  return (
    <div className="practice-play">
      <div className="pp-hud">
        <div className="pp-chord">
          <small>Acorde</small>
          <b>{now < 0 ? tl.chords[0]?.name : cur?.name}</b>
          <span>sigue: {next?.name ?? 'fin'}</span>
        </div>
        <div className="pp-stats">
          <span className="ok">✓ {hits}</span>
          <span className="bad">✗ {judged.length - hits}</span>
          <span>🔥 {session.streak}</span>
          <span className="cyan">✦ {session.played.filter((p) => p.target === null).length} propias</span>
        </div>
        <div className={`pp-judge ${lastJudge ?? ''}`}>{lastJudge === 'perfect' ? '¡Perfecto!' : lastJudge === 'good' ? 'Bien' : lastJudge === 'miss' ? 'Fallo' : ''}</div>
      </div>
      <Karaoke session={session} now={now} ci={now < 0 ? 0 : ci} />
      <Highway session={session} flatsNames={nameOf} />
      <div className="pp-progress">
        <div style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="row-btns">
        <label className="row-check">
          <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /> Bajo guía
        </label>
        <span className="muted-text">
          {tl.bpm} BPM · {tl.chords.length} acordes · números = traste, carril = cuerda
        </span>
        <button className="ctl danger" onClick={onStop}>
          ■ Terminar
        </button>
      </div>
    </div>
  );
}

/**
 * Letra tipo karaoke: la línea actual con sus acordes encima; lo ya tocado
 * se apaga, el tramo del acorde que suena se ilumina (y se va llenando) y
 * abajo aparece la línea que sigue.
 */
function Karaoke({ session, now, ci }: { session: PracticeSession; now: number; ci: number }) {
  const tl = session.tl;
  const c = tl.chords[ci];
  if (!c) return null;
  const line = tl.lines[c.lineIdx];
  const lastLine = tl.chords[tl.chords.length - 1]?.lineIdx ?? 0;
  const next = c.lineIdx < lastLine ? tl.lines[c.lineIdx + 1] : null;
  const progress = now < 0 ? 0 : Math.max(0, Math.min(1, (now - c.startBeat) / (c.endBeat - c.startBeat)));

  const segments = (l: typeof line, active: number | null) => {
    if (!l.lyric.trim()) {
      return l.chords.map((ch, i) => (
        <span key={i} className={`kc-seg instr ${active === null ? '' : i < active ? 'done' : i === active ? 'on' : ''}`}>
          <span className="kc-chord">{ch.name}</span>
        </span>
      ));
    }
    const out: { chord: string | null; text: string; i: number }[] = [];
    l.chords.forEach((ch, i) => {
      // El texto antes del primer acorde se canta junto con él: va en su mismo tramo
      const start = i === 0 ? 0 : ch.pos;
      const end = l.chords[i + 1]?.pos ?? Math.max(l.lyric.length, ch.pos);
      const text = l.lyric.slice(start, end);
      out.push({ chord: ch.name, text: (i === 0 ? text.trimStart() : text) || ' ', i });
    });
    return out.map((s, k) => {
      // El texto antes del primer acorde se canta junto con él
      const idx = s.i < 0 ? 0 : s.i;
      const state = active === null ? '' : idx < active ? 'done' : idx === active ? 'on' : '';
      return (
        <span key={k} className={`kc-seg ${state}`} style={state === 'on' ? ({ '--p': `${progress * 100}%` } as React.CSSProperties) : undefined}>
          <span className="kc-chord">{s.chord ?? ' '}</span>
          <span className="kc-text">{s.text}</span>
        </span>
      );
    });
  };

  return (
    <div className="karaoke">
      <div className="kc-line">{segments(line, now < 0 ? null : c.posInLine)}</div>
      {next ? <div className="kc-line next">{segments(next, null)}</div> : null}
    </div>
  );
}

function ResultsView({
  r,
  title,
  styleName,
  best,
  latency,
  onAdjustLatency,
  onAgain,
  onBack,
}: {
  r: Results;
  title: string;
  styleName: string;
  best: number | null;
  latency: number;
  onAdjustLatency(ms: number): void;
  onAgain(): void;
  onBack(): void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!r.recordingId) return;
    let u: string | null = null;
    void getRecordingBlob(r.recordingId).then((b) => {
      if (b) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => void (u && URL.revokeObjectURL(u));
  }, [r.recordingId]);

  const stars = r.score >= 90 ? 3 : r.score >= 70 ? 2 : r.score >= 40 ? 1 : 0;
  const msg = r.score >= 90 ? '¡Listo para el servicio! 🙌' : r.score >= 70 ? '¡Muy bien! Un par de pasadas más.' : r.score >= 40 ? 'Vas bien. Prueba más lento.' : 'Baja el BPM y activa el bajo guía.';
  const timing =
    r.avgOffsetMs === null ? null : Math.abs(r.avgOffsetMs) < 25 ? 'Vas a tiempo 👌' : r.avgOffsetMs < 0 ? `Te adelantas ~${-r.avgOffsetMs} ms` : `Te atrasas ~${r.avgOffsetMs} ms`;
  const chordTones = r.extras.filter((e) => e.kind === 'acorde').length;

  return (
    <div className="practice-results">
      <div className="pr-score">
        <div className="pr-stars">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>
        <b>{r.score}%</b>
        <span>
          {title} · {styleName}
        </span>
        <p>{msg}</p>
        {best !== null && r.score >= best ? <span className="tag amber">🏆 Tu mejor puntaje</span> : null}
      </div>
      <div className="pr-grid">
        <div>
          <b className="ok">{r.perfect}</b>
          <small>Perfectas</small>
        </div>
        <div>
          <b>{r.good}</b>
          <small>Bien</small>
        </div>
        <div>
          <b className="bad">{r.miss}</b>
          <small>Falladas</small>
        </div>
        <div>
          <b>{r.maxStreak}</b>
          <small>Mejor racha</small>
        </div>
      </div>
      {timing ? (
        <div className="suggest">
          ⏱ {timing}
          {r.avgOffsetMs !== null && Math.abs(r.avgOffsetMs) >= 35 ? (
            <button className="ctl small" onClick={() => onAdjustLatency(Math.max(0, Math.min(300, latency + r.avgOffsetMs!)))}>
              Si tocaste a tiempo, ajustar latencia a {Math.max(0, Math.min(300, latency + r.avgOffsetMs))} ms
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="acard">
        <h3>✦ Tus arreglos</h3>
        {r.extras.length ? (
          <p className="muted-text">
            Tocaste <b>{r.extras.length}</b> notas propias (no cuentan como error): <b>{chordTones}</b> del acorde (arpegios, octavas) y <b>{r.extras.length - chordTones}</b> de paso o adornos. ¡Así se le pone sabor!
          </p>
        ) : (
          <p className="muted-text">Tocaste solo la línea base. Cuando te sientas seguro, prueba meter pasos entre acordes.</p>
        )}
      </div>
      <div className="acard">
        <h3>Por acorde</h3>
        <div className="chord-acc">
          {r.perChord.map((c, i) => (
            <span key={i} className={c.total && c.hit / c.total >= 0.8 ? 'good' : c.hit === 0 ? 'bad' : ''} title={`${c.hit}/${c.total}`}>
              {c.name}
              <small>
                {c.hit}/{c.total}
              </small>
            </span>
          ))}
        </div>
      </div>
      {url ? (
        <div className="acard">
          <h3>🎧 Tu toma (con la pista)</h3>
          <audio src={url} controls />
          <small className="muted-text">También queda guardada en Biblioteca → Grabaciones.</small>
        </div>
      ) : null}
      <div className="row-btns">
        <button className="cta big" onClick={onAgain}>
          ↻ Otra vez
        </button>
        <button className="ctl" onClick={onBack}>
          Cambiar canción / estilo
        </button>
      </div>
    </div>
  );
}

function RecentPractice() {
  const list = practiceHistory().slice(0, 6);
  if (!list.length) return null;
  return (
    <div className="acard">
      <h3>Prácticas recientes</h3>
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="row-item static">
            <div className="ri-main">
              <b>{p.title}</b>
              <span>
                {styleById(p.style).name} · {p.bpm} BPM · {new Date(p.date).toLocaleDateString()}
              </span>
            </div>
            <span className={`tag ${p.score >= 70 ? 'amber' : ''}`}>{p.score}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
