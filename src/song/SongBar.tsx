import { FormEvent, useRef, useState } from 'react';
import { searchSongs } from './api';
import { Song } from './lyrics';
import type { useSongFollower } from './useSongFollower';
import { SheetLine } from './chords';
import { ChordLyric, Transpose } from './ChordSheet';

type Follower = ReturnType<typeof useSongFollower>;

export interface SongSettingsProps {
  listen: boolean;
  lang: string;
  token: string;
  onChange(p: Partial<{ listen: boolean; lang: string; token: string }>): void;
}

function fmt(sec: number | null) {
  if (sec === null || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SongBar({
  f,
  settings,
  hasSheet,
  onEditSheet,
}: {
  f: Follower;
  settings: SongSettingsProps;
  hasSheet: boolean;
  onEditSheet(): void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setSearching(true);
    try {
      setResults(await searchSongs(query.trim(), ac.signal));
    } catch {
      if (!ac.signal.aborted) setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const status = (() => {
    if (f.busy) return { cls: 'busy', text: f.busy };
    if (f.speech === 'on') return { cls: 'listening', text: 'Escuchando la letra para reconocer la canción…' };
    if (f.speech === 'unsupported')
      return { cls: 'warn', text: f.speechError ?? 'Reconocimiento de voz no disponible aquí (usa Chrome o Edge).' };
    if (f.speech === 'error') return { cls: 'warn', text: f.speechError ?? 'Error de voz' };
    return { cls: '', text: 'Reconocimiento de letra apagado' };
  })();

  return (
    <section className="songbar">
      <div className="song-now">
        {f.song ? (
          <>
            <span className="song-icon">♪</span>
            <div className="song-meta">
              <div className="song-title">{f.song.title}</div>
              <div className="song-artist">
                {f.song.artist}
                <span className="badge">{f.song.source === 'huella' ? 'huella' : f.song.source === 'voz' ? 'por letra' : 'manual'}</span>
                {f.song.synced ? (
                  <button
                    className={`badge toggle ${f.autoTime ? 'on' : ''}`}
                    onClick={() => f.setAutoTime(!f.autoTime)}
                    title="Avanzar la letra con el tiempo de la grabación"
                  >
                    ⏱ {f.autoTime ? 'auto' : 'manual'} {fmt(f.pos)}
                  </button>
                ) : (
                  <span className="badge dim">sin tiempos</span>
                )}
              </div>
            </div>
            {f.fit !== null && f.fit < 0.25 ? (
              <span className="badge warn" title="Lo que se canta ya no coincide: buscando la siguiente canción">
                ¿cambió?
              </span>
            ) : null}
            <button className={`ctl chords-btn ${hasSheet ? 'has' : ''}`} onClick={onEditSheet} title="Acordes de la canción original">
              🎸 <span className="lbl">{hasSheet ? 'Acordes' : 'Añadir acordes'}</span>
            </button>
            <button className="ctl icon" onClick={f.clearSong} title="No es esta canción / buscar otra">
              ✕
            </button>
          </>
        ) : (
          <div className={`song-status ${status.cls}`}>
            <span className="dot" />
            <span>{status.text}</span>
          </div>
        )}
      </div>

      <div className="song-actions">
        <form className="search" onSubmit={submit}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar canción o artista…"
            aria-label="Buscar canción"
          />
          {results !== null || searching ? (
            <div className="results">
              {searching ? <div className="r-empty">Buscando…</div> : null}
              {!searching && results?.length === 0 ? <div className="r-empty">Sin resultados con letra</div> : null}
              {results?.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="r-item"
                  onClick={() => {
                    f.chooseSong(s);
                    setResults(null);
                    setQuery('');
                  }}
                >
                  <b>{s.title}</b>
                  <span>
                    {s.artist} {s.synced ? '· ⏱' : ''}
                  </span>
                </button>
              ))}
              <button type="button" className="r-close" onClick={() => setResults(null)}>
                Cerrar
              </button>
            </div>
          ) : null}
        </form>
        <button className="ctl shazam" onClick={() => void f.identifyAudio()} disabled={!!f.busy} title="Reconocer una grabación que está sonando">
          ◉ Identificar audio
        </button>
        <button className={`ctl icon ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings((v) => !v)} title="Ajustes de reconocimiento">
          ⚙
        </button>
        {showSettings ? (
          <div className="settings">
            <label className="row">
              <input type="checkbox" checked={settings.listen} onChange={(e) => settings.onChange({ listen: e.target.checked })} />
              Escuchar la letra (reconocimiento de voz)
            </label>
            <label>
              Idioma de la voz
              <select value={settings.lang} onChange={(e) => settings.onChange({ lang: e.target.value })}>
                <option value="es-MX">Español (Latinoamérica)</option>
                <option value="es-ES">Español (España)</option>
                <option value="en-US">English (US)</option>
                <option value="pt-BR">Português (Brasil)</option>
              </select>
            </label>
            <label>
              Token de AudD (opcional)
              <input
                type="password"
                value={settings.token}
                onChange={(e) => settings.onChange({ token: e.target.value.trim() })}
                placeholder="Sin token: pocas identificaciones al día"
              />
              <small>
                Consíguelo en{' '}
                <a href="https://dashboard.audd.io" target="_blank" rel="noreferrer">
                  dashboard.audd.io
                </a>
                . Se guarda solo en este navegador.
              </small>
            </label>
          </div>
        ) : null}
      </div>

      {f.candidates.length ? (
        <div className="candidates">
          <span>{f.song ? '¿Cambiaron a alguna de estas?' : '¿Es alguna de estas?'}</span>
          {f.candidates.map((c) => (
            <button key={c.title + c.artist} onClick={() => void f.chooseCandidate(c)}>
              {c.title} <em>· {c.artist}</em>
            </button>
          ))}
        </div>
      ) : null}
      {f.history.length > 1 ? (
        <div className="setlist">
          <span>Medley:</span>
          {f.history.map((h, i) => (
            <span key={i} className={i === f.history.length - 1 && f.song ? 'cur' : ''}>
              {h.title}
            </span>
          ))}
        </div>
      ) : null}
      {f.notice ? (
        <div className="notice" onClick={f.dismissNotice}>
          {f.notice} <span>✕</span>
        </div>
      ) : null}
    </section>
  );
}

/** Teleprompter compacto: línea anterior, actual (destacada) y siguiente. */
export function LyricsStrip({
  f,
  sheetFor,
  t,
}: {
  f: Follower;
  sheetFor?: (lyricIndex: number) => SheetLine | null;
  t?: Transpose;
}) {
  const s = f.song;
  if (!s) {
    const text = f.interim || f.heardText;
    return (
      <div className="lyrics idle">
        {text ? <div className="heard">“{text}”</div> : <div className="heard dim">La letra aparecerá aquí cuando se reconozca la canción</div>}
      </div>
    );
  }
  const i = f.line;
  const prev = i > 0 ? s.lines[i - 1] : null;
  const cur = i >= 0 ? s.lines[i] : null;
  const next = s.lines[i + 1] ?? null;
  const next2 = s.lines[i + 2] ?? null;

  // Con cifrado: la línea actual y la siguiente llevan los acordes transportados encima
  const curSheet = sheetFor && t && i >= 0 ? sheetFor(i) : null;
  const nextSheet = sheetFor && t ? sheetFor(i + 1) : null;
  if (sheetFor && t) {
    return (
      <div className="lyrics with-chords">
        <button className="l-prev" onClick={() => f.jumpTo(i - 1)} disabled={!prev}>
          {prev?.text ?? ' '}
        </button>
        <div className="l-cur">
          {curSheet ? <ChordLyric line={curSheet} t={t} /> : cur ? cur.text : <span className="dim">Esperando el primer verso…</span>}
        </div>
        <button className="l-next" onClick={() => f.jumpTo(i + 1)} disabled={!next}>
          {nextSheet ? (
            <ChordLyric line={nextSheet} t={t} className="small" />
          ) : next ? (
            <>
              <span className="l-tag">Sigue</span> {next.text}
            </>
          ) : (
            ' '
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="lyrics">
      <button className="l-prev" onClick={() => f.jumpTo(i - 1)} disabled={!prev}>
        {prev?.text ?? ' '}
      </button>
      <div className="l-cur">{cur ? cur.text : <span className="dim">Esperando el primer verso…</span>}</div>
      <button className="l-next" onClick={() => f.jumpTo(i + 1)} disabled={!next}>
        {next ? (
          <>
            <span className="l-tag">Sigue</span> {next.text}
          </>
        ) : (
          ' '
        )}
      </button>
      {next2 ? <div className="l-next2">{next2.text}</div> : null}
    </div>
  );
}
