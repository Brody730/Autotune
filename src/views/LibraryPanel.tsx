import { useEffect, useMemo, useRef, useState } from 'react';
import { keyLabel, MusicalKey, Notation } from '../audio/music';
import {
  deleteRecording,
  fmtDuration,
  fmtSize,
  getRecordingBlob,
  RecordingMeta,
  storageEstimate,
  updateRecording,
  useRecordings,
} from '../lib/recordings';
import { KeyRef, SessionRecord, store, useStore } from '../lib/store';
import { baseKeyOf, SheetView, SongDetail } from './SongDetail';

type Tab = 'songs' | 'medleys' | 'recordings';
const mk = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });

export function LibraryPanel({ notation, onClose }: { notation: Notation; onClose(): void }) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('lsa.libtab') as Tab) || 'songs';
    } catch {
      return 'songs';
    }
  });
  const [openSong, setOpenSong] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  const go = (t: Tab) => {
    setTab(t);
    setOpenSong(null);
    setOpenSession(null);
    try {
      localStorage.setItem('lsa.libtab', t);
    } catch {
      /* noop */
    }
  };

  return (
    <Panel title="Biblioteca" onClose={onClose}>
      <div className="tabs">
        {(
          [
            ['songs', '🎵 Canciones'],
            ['medleys', '🔗 Medleys y sesiones'],
            ['recordings', '⏺ Grabaciones'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>
            {l}
          </button>
        ))}
      </div>
      {openSong ? (
        <SongDetail songKey={openSong} notation={notation} onBack={() => setOpenSong(null)} />
      ) : openSession ? (
        <SessionDetail id={openSession} notation={notation} onBack={() => setOpenSession(null)} onSong={setOpenSong} />
      ) : tab === 'songs' ? (
        <SongList notation={notation} onOpen={setOpenSong} />
      ) : tab === 'medleys' ? (
        <SessionList notation={notation} onOpen={setOpenSession} onSong={setOpenSong} />
      ) : (
        <RecordingList />
      )}
    </Panel>
  );
}

export function Panel({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="panel-wrap" role="dialog" aria-label={title}>
      <div className="panel">
        <div className="panel-head">
          <h1>{title}</h1>
          <button className="ctl" onClick={onClose}>
            ✕ Volver al escenario
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

// ── Canciones ───────────────────────────────────────────────────────────────

function SongList({ notation, onOpen }: { notation: Notation; onOpen(k: string): void }) {
  const songsMap = useStore((d) => d.songs);
  const [q, setQ] = useState('');
  const songs = useMemo(
    () =>
      Object.values(songsMap)
        .filter((s) => !s.deleted)
        .filter((s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (b.lastPlayed ?? b.updated) - (a.lastPlayed ?? a.updated)),
    [songsMap, q],
  );
  if (!Object.keys(songsMap).length) {
    return (
      <div className="empty">
        <p>Aún no hay canciones.</p>
        <p>Cada canción que la app reconozca en el escenario se guarda aquí automáticamente, con el tono en que se cantó.</p>
      </div>
    );
  }
  return (
    <>
      <input className="filter" placeholder="Filtrar canciones…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {songs.map((s) => {
          const base = baseKeyOf(s);
          return (
            <button key={s.key} className="row-item" onClick={() => onOpen(s.key)}>
              <div className="ri-main">
                <b>{s.title}</b>
                <span>{s.artist}</span>
              </div>
              <div className="ri-tags">
                {s.sheet ? <span className="tag amber">cifrado</span> : null}
                {s.myKey ? <span className="tag">mi tono: {keyLabel(mk(s.myKey), notation)}</span> : base ? <span className="tag dim">{keyLabel(mk(base), notation)}</span> : null}
                <span className="tag dim">×{s.plays}</span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Medleys y sesiones ──────────────────────────────────────────────────────

function SessionList({ notation, onOpen, onSong }: { notation: Notation; onOpen(id: string): void; onSong(k: string): void }) {
  const map = useStore((d) => d.sessions);
  const [filter, setFilter] = useState<'saved' | 'all'>('all');
  const sessions = useMemo(
    () =>
      Object.values(map)
        .filter((s) => !s.deleted && s.items.length > 0)
        .filter((s) => filter === 'all' || s.saved)
        .sort((a, b) => b.startedAt - a.startedAt),
    [map, filter],
  );
  return (
    <>
      <div className="seg-row">
        <div className="seg">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            Historial
          </button>
          <button className={filter === 'saved' ? 'on' : ''} onClick={() => setFilter('saved')}>
            ★ Guardados
          </button>
        </div>
        <span className="muted-text">Las sesiones se registran solas mientras tocas. Guarda con ★ las que quieras repetir.</span>
      </div>
      {!sessions.length ? <div className="empty">{filter === 'saved' ? 'Aún no guardaste ningún medley.' : 'Aún no hay sesiones.'}</div> : null}
      <div className="list">
        {sessions.map((s) => (
          <div key={s.id} className="session-card">
            <div className="sc-head">
              <button className={`star ${s.saved ? 'on' : ''}`} onClick={() => store.upsertSession({ ...s, saved: !s.saved })} title="Guardar como medley">
                {s.saved ? '★' : '☆'}
              </button>
              <button className="sc-title" onClick={() => onOpen(s.id)}>
                <b>{s.name}</b>
                <span>
                  {new Date(s.startedAt).toLocaleDateString()} · {s.items.length} {s.items.length === 1 ? 'canción' : 'canciones'}
                  {s.recordingId ? ' · ⏺ grabada' : ''}
                </span>
              </button>
            </div>
            <div className="chips">
              {s.items.map((it, i) => (
                <button key={i} className="chip" onClick={() => onSong(it.songKey)}>
                  {it.title}
                  {it.sungKey ? <em> · {keyLabel(mk(it.sungKey), notation)}</em> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SessionDetail({
  id,
  notation,
  onBack,
  onSong,
}: {
  id: string;
  notation: Notation;
  onBack(): void;
  onSong(k: string): void;
}) {
  const s = useStore((d) => d.sessions[id]) as SessionRecord | undefined;
  const songs = useStore((d) => d.songs);
  const [rehearse, setRehearse] = useState(false);
  if (!s) return <div className="empty">No encontrada.</div>;
  const rename = (name: string) => store.upsertSession({ ...s, name });
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="ctl" onClick={onBack}>
          ← Volver
        </button>
        <div className="detail-title">
          <input className="title-input" defaultValue={s.name} onBlur={(e) => e.target.value.trim() && rename(e.target.value.trim())} />
          <span>
            {new Date(s.startedAt).toLocaleString()} · {fmtDuration((s.endedAt - s.startedAt) / 1000)}
          </span>
        </div>
        <button className={`ctl ${s.saved ? 'amber' : ''}`} onClick={() => store.upsertSession({ ...s, saved: !s.saved })}>
          {s.saved ? '★ Guardado' : '☆ Guardar medley'}
        </button>
      </div>

      <div className="seg-row">
        <div className="seg">
          <button className={!rehearse ? 'on' : ''} onClick={() => setRehearse(false)}>
            Lista
          </button>
          <button className={rehearse ? 'on' : ''} onClick={() => setRehearse(true)}>
            🎤 Ensayar en mi tono
          </button>
        </div>
      </div>

      {!rehearse ? (
        <ol className="setlist-detail">
          {s.items.map((it, i) => {
            const rec = songs[it.songKey];
            return (
              <li key={i}>
                <button className="row-item" onClick={() => onSong(it.songKey)}>
                  <div className="ri-main">
                    <b>{it.title}</b>
                    <span>
                      {it.artist} · {fmtDuration((it.endedAt - it.startedAt) / 1000)}
                    </span>
                  </div>
                  <div className="ri-tags">
                    {it.sungKey ? <span className="tag">cantada en {keyLabel(mk(it.sungKey), notation)}</span> : null}
                    {rec?.myKey ? <span className="tag amber">mi tono: {keyLabel(mk(rec.myKey), notation)}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="rehearse">
          {s.items.map((it, i) => {
            const rec = songs[it.songKey];
            if (!rec || rec.deleted) return null;
            const target = rec.myKey ?? baseKeyOf(rec);
            return (
              <section key={i}>
                <h3>
                  {i + 1}. {rec.title}{' '}
                  <span className="tag amber">{target ? keyLabel(mk(target), notation) : '—'}</span>
                  <button className="ctl small" onClick={() => onSong(rec.key)}>
                    cambiar tono
                  </button>
                </h3>
                <SheetView song={rec} target={target} notation={notation} />
              </section>
            );
          })}
        </div>
      )}

      <div className="detail-foot">
        <span />
        <button
          className="ctl danger"
          onClick={() => {
            if (confirm('¿Borrar esta sesión? (las canciones se quedan en tu biblioteca)')) {
              store.deleteSession(s.id);
              onBack();
            }
          }}
        >
          Borrar sesión
        </button>
      </div>
    </div>
  );
}

// ── Grabaciones ─────────────────────────────────────────────────────────────

function RecordingList() {
  const list = useRecordings();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, [list]);
  if (!list.length) {
    return (
      <div className="empty">
        <p>No hay grabaciones.</p>
        <p>Pulsa <b>● REC</b> en el escenario para grabar el servicio en vivo. Cada canción reconocida queda marcada en la grabación.</p>
      </div>
    );
  }
  return (
    <>
      {usage ? (
        <div className="muted-text storage">
          Espacio usado en este dispositivo: {fmtSize(usage.used)} de {fmtSize(usage.quota)}. Las grabaciones se guardan solo aquí: descárgalas para conservarlas.
        </div>
      ) : null}
      <div className="list">
        {list.map((r) => (
          <RecordingItem key={r.id} r={r} />
        ))}
      </div>
    </>
  );
}

function RecordingItem({ r }: { r: RecordingMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const load = async () => {
    if (url) return url;
    const blob = await getRecordingBlob(r.id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return u;
  };
  const ext = r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'webm';
  const download = async () => {
    const u = await load();
    if (!u) return;
    const a = document.createElement('a');
    a.href = u;
    a.download = `${r.name.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`;
    a.click();
  };
  const seek = async (t: number) => {
    await load();
    requestAnimationFrame(() => {
      if (audio.current) {
        audio.current.currentTime = t;
        void audio.current.play();
      }
    });
  };

  return (
    <div className="rec-card">
      <div className="rc-head">
        <input
          className="title-input"
          defaultValue={r.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && void updateRecording(r.id, { name: e.target.value.trim() })}
        />
        <span className="muted-text">
          {new Date(r.startedAt).toLocaleString()} · {fmtDuration(r.duration)} · {fmtSize(r.size)}
          {!r.finished ? ' · ⚠ interrumpida' : ''}
        </span>
      </div>
      {url ? (
        <audio
          ref={audio}
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => {
            // Los webm de MediaRecorder no traen duración: forzar a calcularla para poder adelantar
            const a = e.currentTarget;
            if (a.duration === Infinity) {
              const fix = () => {
                a.removeEventListener('timeupdate', fix);
                a.currentTime = 0;
              };
              a.addEventListener('timeupdate', fix);
              a.currentTime = 1e9;
            }
          }}
        />
      ) : (
        <button className="ctl" onClick={() => void load()}>
          ▶ Escuchar
        </button>
      )}
      {r.markers.length ? (
        <div className="chips">
          {r.markers.map((m, i) => (
            <button key={i} className="chip" onClick={() => void seek(m.t)}>
              <em>{fmtDuration(m.t)}</em> {m.title}
            </button>
          ))}
        </div>
      ) : null}
      <div className="rc-actions">
        <button className="ctl" onClick={() => void download()}>
          ⬇ Descargar
        </button>
        <button
          className="ctl danger"
          onClick={() => confirm(`¿Borrar la grabación «${r.name}»? No se puede deshacer.`) && void deleteRecording(r.id)}
        >
          Borrar
        </button>
      </div>
    </div>
  );
}
