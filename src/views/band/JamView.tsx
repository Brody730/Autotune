import { useEffect, useState } from 'react';
import { JamCue, JamLine, JamPeer, JamState } from '../../band/jam';
import { ROLES, roleById, RoleView } from '../../band/roles';

/** Letra con los acordes (ya transportados por quien dirige) encima. */
export function JamChordLine({ line, className }: { line: JamLine; className?: string }) {
  if (!line.lyric.trim()) {
    return (
      <div className={`cl instrumental ${className ?? ''}`}>
        {line.chords.map((c, i) => (
          <span key={i} className="cl-chord solo">
            {c.name}
          </span>
        ))}
      </div>
    );
  }
  const segs: { chord: string | null; text: string }[] = [];
  const first = line.chords[0]?.pos ?? line.lyric.length;
  if (first > 0) segs.push({ chord: null, text: line.lyric.slice(0, first) });
  line.chords.forEach((c, i) => {
    const end = line.chords[i + 1]?.pos ?? Math.max(line.lyric.length, c.pos);
    segs.push({ chord: c.name, text: line.lyric.slice(c.pos, end) || ' ' });
  });
  return (
    <div className={`cl ${className ?? ''}`}>
      {segs.map((s, i) => (
        <span key={i} className="cl-seg">
          <span className="cl-chord">{s.chord ?? ' '}</span>
          <span className="cl-text">{s.text}</span>
        </span>
      ))}
    </div>
  );
}

export function CueBanner({ cue }: { cue: JamCue | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!cue) return;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 4500);
    return () => window.clearTimeout(id);
  }, [cue?.ts]);
  if (!cue || !show) return null;
  return (
    <div className="cue-banner" key={cue.ts}>
      <b>{cue.text}</b>
      <small>{cue.from}</small>
    </div>
  );
}

export function PeerChips({ peers }: { peers: JamPeer[] }) {
  return (
    <div className="peers">
      {peers.map((p) => {
        const r = roleById(p.role);
        return (
          <span key={p.userId} className={`peer ${p.host ? 'host' : ''}`} title={r.label}>
            {r.icon} {p.name || 'Sin nombre'}
            {p.host ? ' · dirige' : ''}
          </span>
        );
      })}
    </div>
  );
}

/** Pantalla de cada integrante durante la JAM. */
export function JamView({
  state,
  cue,
  peers,
  connected,
  role,
  setRole,
  onCue,
  canCue,
  onClose,
}: {
  state: JamState | null;
  cue: JamCue | null;
  peers: JamPeer[];
  connected: boolean;
  role: string;
  setRole(r: string): void;
  onCue(text: string): void;
  canCue: boolean;
  onClose(): void;
}) {
  const view: RoleView = roleById(role).view;
  const host = peers.find((p) => p.host);
  const stale = state && Date.now() - state.ts > 15000;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // pantalla siempre encendida
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinel> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      void lock?.release();
    };
  }, [onClose]);

  if (view === 'projection') {
    return (
      <div className="jam projection" onDoubleClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
        <div className="proj-tools">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.icon} {r.label}
              </option>
            ))}
          </select>
          <button className="ctl small" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
            ⛶
          </button>
          <button className="ctl small" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="proj-lines">
          <div className="proj-cur">{state?.lines.cur ?? ''}</div>
          <div className="proj-next">{state?.lines.next ?? ''}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="jam">
      <header className="jam-top">
        <span className={`onair ${connected && state && !stale ? 'on' : ''}`}>JAM</span>
        <div className="jam-song">
          <b>{state?.song?.title ?? (host ? 'Esperando canción…' : 'Esperando a quien dirige…')}</b>
          <span>
            {state?.song?.artist ?? ''}
            {state?.targetLabel ? ` · Tono ${state.targetLabel}` : state?.keyLabel ? ` · Tono ${state.keyLabel}` : ''}
            {state?.bpm ? ` · ${state.bpm} bpm` : ''}
          </span>
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} title="Vista según tu rol">
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.icon} {r.label}
            </option>
          ))}
        </select>
        <button className="ctl" onClick={onClose}>
          ✕ Salir
        </button>
      </header>

      {!connected ? <div className="notice-box">Conectando con la banda…</div> : null}
      {connected && !host ? <div className="notice-box">Nadie está dirigiendo todavía. Quien canta debe pulsar «Dirigir JAM aquí».</div> : null}
      {stale && host ? <div className="notice-box">Sin señal de quien dirige desde hace un momento…</div> : null}

      <CueBanner cue={cue} />

      <main className={`jam-main v-${view}`}>
        {view === 'chords' ? (
          <>
            {state?.chordLines.cur ? <JamChordLine line={state.chordLines.cur} className="jam-cur" /> : <div className="jam-cur">{state?.lines.cur ?? '—'}</div>}
            {state?.chordLines.next ? (
              <JamChordLine line={state.chordLines.next} className="jam-next" />
            ) : (
              <div className="jam-next">{state?.lines.next ?? ''}</div>
            )}
          </>
        ) : view === 'bass' ? (
          <>
            <div className="bass-notes">
              {state?.chordLines.cur?.chords.length
                ? state.chordLines.cur.chords.map((c, i) => <span key={i}>{c.bass}</span>)
                : <span className="dim">—</span>}
            </div>
            <div className="bass-next">
              <small>Sigue</small>
              {state?.chordLines.next?.chords.map((c, i) => <span key={i}>{c.bass}</span>)}
            </div>
            <div className="jam-lyric-small">{state?.lines.cur ?? ''}</div>
          </>
        ) : view === 'drums' ? (
          <>
            <div className="jam-cur">{state?.lines.cur ?? '—'}</div>
            <div className="jam-next">{state?.lines.next ?? ''}</div>
            {state?.bpm ? <div className="bpm-big">{state.bpm} BPM</div> : null}
          </>
        ) : (
          <>
            <div className="jam-cur lyric">{state?.lines.cur ?? '—'}</div>
            <div className="jam-next">{state?.lines.next ?? ''}</div>
            <div className="jam-next2">{state?.lines.next2 ?? ''}</div>
          </>
        )}
      </main>

      {state?.setlist ? (
        <div className="jam-setlist">
          {state.setlist.songs.map((t, i) => (
            <span key={i} className={i === state.setlist!.index ? 'cur' : i < state.setlist!.index ? 'done' : ''}>
              {i + 1}. {t}
            </span>
          ))}
        </div>
      ) : null}

      <footer className="jam-foot">
        <PeerChips peers={peers} />
        {canCue ? (
          <div className="cues">
            {['Coro', 'Repetir', 'Puente', 'Final', 'Subir 🔥', 'Bajar 🙏'].map((c) => (
              <button key={c} className="ctl small" onClick={() => onCue(c)}>
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </footer>
    </div>
  );
}
