import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keyLabel, keyUsesFlats, Notation, pcName } from '../../audio/music';
import { fmtSize } from '../../lib/recordings';
import { store } from '../../lib/store';
import { fetchLyrics } from '../../song/api';
import { sheetKeyFor } from '../../song/ChordSheet';
import { parseLrc } from '../../song/lyrics';
import { ChordSeg, deleteEngineTrack, downloadZip, EngineTrack, engineHealth, fetchStem, getJob, Health, Job, startFileJob, startJob } from '../../stems/api';
import { deleteTrack, getStems, getTrack, saveTrack, StoredTrack, updateTrack, useTracks } from '../../stems/db';
import { barsOf, buildSheet, chordIndexAt, chordLabel, chordsInBar, editedKey, fmtTime, notesText } from '../../stems/notes';
import { StemPlayer } from '../../stems/player';
import { Panel } from '../LibraryPanel';
import { NoteRoad } from './NoteRoad';

const STEM_INFO: Record<string, { label: string; emoji: string }> = {
  vocals: { label: 'Voz', emoji: '🎤' },
  drums: { label: 'Batería', emoji: '🥁' },
  bass: { label: 'Bajo', emoji: '🎸' },
  guitar: { label: 'Guitarra', emoji: '🎸' },
  piano: { label: 'Piano', emoji: '🎹' },
  other: { label: 'Otros', emoji: '🎶' },
};
const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

/** Teléfono o tableta: ahí no puede correr el motor de pistas. */
const IS_PHONE = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** «Artista - Canción (Video Oficial)» → título y artista limpios. */
function splitTitle(t: EngineTrack): { title: string; artist: string } {
  const strip = (s: string) =>
    s
      .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
      .replace(/[\p{Extended_Pictographic}️]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const artist = t.artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t.title);
  if (m) return { artist: strip(m[1]) || artist, title: strip(m[2]) || t.title };
  return { title: strip(t.title) || t.title, artist };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function findLyrics(title: string, artist: string): Promise<string | null> {
  try {
    const song = await fetchLyrics({ title, artist }, 'manual');
    return song?.raw.synced ?? null;
  } catch {
    return null;
  }
}

export function StemsPanel({ notation, liveMidi, onClose }: { notation: Notation; liveMidi: number | null; onClose(): void }) {
  const tracks = useTracks();
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => void engineHealth().then((h) => alive && setHealth(h));
    check();
    const id = window.setInterval(check, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel title="🎚 Pistas" onClose={onClose}>
      {openId ? (
        <TrackView key={openId} id={openId} notation={notation} liveMidi={liveMidi} engine={!!health} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <EngineStatus health={health} />
          {IS_PHONE && !health ? null : <NewTrack engine={!!health} onReady={setOpenId} />}
          <div className="acard">
            <h3>Mis pistas</h3>
            {tracks === null ? (
              <p className="muted-text">Cargando…</p>
            ) : !tracks.length && IS_PHONE && !health ? (
              <p className="muted-text">No hay pistas en este dispositivo.</p>
            ) : !tracks.length ? (
              <p className="muted-text">Aún no hay pistas. Pega un enlace de YouTube arriba: la canción queda guardada aquí para practicarla cuando quieras, incluso sin el motor.</p>
            ) : (
              <div className="list">
                {tracks.map((t) => (
                  <div key={t.id} className="row-item" onClick={() => setOpenId(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(t.id)}>
                    <div className="ri-main">
                      <b>{t.title}</b>
                      <span>
                        {t.artist ? `${t.artist} · ` : ''}
                        {fmtTime(t.analysis.duration / t.edit.speed)} · {t.stems.length} pistas · {fmtSize(t.size)}
                      </span>
                    </div>
                    <div className="ri-tags">
                      <span className="tag amber">{keyLabel(editedKey(t.analysis, t.edit.semitones), notation)}</span>
                      <span className="tag dim">{Math.round(t.analysis.bpm * t.edit.speed)} BPM</span>
                      <button
                        className="ctl small danger"
                        title="Borrar de este dispositivo"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`¿Borrar «${t.title}» y sus pistas? No se puede deshacer.`)) return;
                          void deleteTrack(t.id);
                          void deleteEngineTrack(t.id);
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function EngineStatus({ health }: { health: Health | null | undefined }) {
  if (health === undefined) return null;
  if (!health && IS_PHONE) {
    return (
      <div className="acard engine-off">
        <h3>📵 En el celular todavía no está disponible</h3>
        <p className="muted-text">
          Separar canciones de YouTube solo funciona en la <b>computadora</b> donde está instalado el motor de pistas. Las pistas que separes ahí se guardan en esa computadora y, por ahora, <b>no se
          pasan al celular</b>.
        </p>
        <p className="muted-text">El resto de la app (tono, acordes, letra, banda, biblioteca y práctica con puntaje) sí funciona aquí.</p>
      </div>
    );
  }
  if (health) {
    return (
      <div className="suggest">
        <span className="ok">● Motor de pistas conectado</span> · {health.device === 'cuda' ? `GPU ${health.gpu ?? ''}` : 'procesador (sin GPU: más lento)'}
      </div>
    );
  }
  return (
    <div className="acard engine-off">
      <h3>⚠ El motor de pistas no está abierto</h3>
      <p className="muted-text">
        Separar instrumentos necesita un programa que corre en tu PC (no cabe en la página). En la carpeta del proyecto abre <b>stem-server</b> y haz doble clic en{' '}
        <b>iniciar.bat</b> (la primera vez, antes, <b>instalar.bat</b>). Déjalo abierto y esta pantalla se conecta sola.
      </p>
      <p className="muted-text">Las pistas que ya guardaste se pueden practicar sin el motor.</p>
    </div>
  );
}

function NewTrack({ engine, onReady }: { engine: boolean; onReady(id: string): void }) {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState<'4' | '6'>('4');
  const [job, setJob] = useState<Job | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  /** Baja los MP3 del motor y guarda la canción en la biblioteca de este dispositivo. */
  const importTrack = async (t: EngineTrack) => {
    const prev = await getTrack(t.id);
    const audio: Record<string, Blob> = {};
    for (const [i, stem] of t.stems.entries()) {
      setSaving(`Guardando en tu biblioteca… (${i + 1}/${t.stems.length})`);
      audio[stem] = await fetchStem(t.id, stem);
    }
    setSaving('Buscando la letra…');
    const names = prev ? { title: prev.title, artist: prev.artist } : splitTitle(t);
    const lrc = prev?.lrc ?? (await findLyrics(names.title, names.artist));
    const sheet = prev?.sheet || buildSheet(t.analysis, lrc ? parseLrc(lrc) : null);
    await saveTrack({ ...t, ...names, edit: { semitones: 0, speed: 1 }, volumes: prev?.volumes ?? {}, sheet, lrc, size: 0 }, audio);
    // También a «Canciones», para verla en el escenario y en la práctica con puntaje
    const key = sheetKeyFor(names.title);
    if (!store.song(key)?.sheet) store.upsertSong(key, names.title, names.artist, { sheet, origKey: t.analysis.key });
    if (alive.current) onReady(t.id);
  };

  const run = async (start: () => Promise<Job>) => {
    setError(null);
    try {
      let j = await start();
      setJob(j);
      while (j.status !== 'done' && j.status !== 'error') {
        await new Promise((r) => window.setTimeout(r, 1000));
        if (!alive.current) return;
        j = await getJob(j.id!);
        setJob(j);
      }
      if (j.status === 'error' || !j.track) throw new Error(j.message || 'No se pudo procesar la canción.');
      await importTrack(j.track);
      setUrl('');
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) {
        setJob(null);
        setSaving(null);
      }
    }
  };

  const busy = !!job || !!saving;
  const pct = saving ? 100 : Math.round((job?.progress ?? 0) * 100);

  return (
    <div className="acard">
      <h3>Nueva canción desde YouTube</h3>
      <div className="stems-new">
        <input
          className="filter"
          placeholder="Pega aquí el enlace de YouTube…"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && engine && url.trim() && !busy && void run(() => startJob(url.trim(), model))}
        />
        <select className="ctl" value={model} disabled={busy} onChange={(e) => setModel(e.target.value as '4' | '6')} title="Cuántas pistas separar">
          <option value="4">4 pistas: voz, batería, bajo, otros</option>
          <option value="6">6 pistas: + guitarra y piano</option>
        </select>
        <button className="cta" disabled={!engine || busy || !url.trim()} onClick={() => void run(() => startJob(url.trim(), model))}>
          ✂ Separar
        </button>
        <button className="ctl" disabled={!engine || busy} onClick={() => fileRef.current?.click()} title="Usar un archivo de audio de tu PC">
          📁 Archivo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(() => startFileJob(f, model));
          }}
        />
      </div>
      {busy ? (
        <div className="stems-progress">
          <div className="pp-progress">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="muted-text">
            {saving ?? job?.message ?? 'Empezando…'} {saving ? '' : `${pct}%`}
          </span>
        </div>
      ) : null}
      {error ? <p className="err-text">{error}</p> : null}
      <p className="muted-text">Para uso personal: usa canciones que tengas derecho a descargar. La separación tarda 1–3 minutos según la canción.</p>
    </div>
  );
}

// ── Una canción: mezclador, notas y descarga ────────────────────────────────

type Tab = 'chords' | 'bass' | 'melody' | 'sheet' | 'text';

function TrackView({ id, notation, liveMidi, engine, onBack }: { id: string; notation: Notation; liveMidi: number | null; engine: boolean; onBack(): void }) {
  const [track, setTrack] = useState<StoredTrack | null>(null);
  const [player, setPlayer] = useState<StemPlayer | null>(null);
  const [loading, setLoading] = useState('Cargando pistas…');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [, setTick] = useState(0);
  const [mute, setMute] = useState<Record<string, boolean>>({});
  const [solo, setSolo] = useState<Record<string, boolean>>({});
  const [vols, setVols] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>('chords');
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ semitones: number; speed: number } | null>(null);
  const [loopA, setLoopA] = useState<number | null>(null);

  // Cargar la canción y decodificar sus pistas
  useEffect(() => {
    let p: StemPlayer | null = null;
    let cancelled = false;
    setPlayer(null);
    setLoading('Cargando pistas…');
    void (async () => {
      try {
        const t = await getTrack(id);
        if (!t) throw new Error('La pista ya no está en este dispositivo.');
        const blobs = await getStems(t);
        if (cancelled) return;
        setTrack(t);
        setVols(t.volumes ?? {});
        p = new StemPlayer();
        p.onChange = () => setTick((n) => n + 1);
        await p.load(blobs, (d, n) => setLoading(`Preparando pistas… (${d}/${n})`));
        if (cancelled) return void p.close();
        setPlayer(p);
        setLoading('');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      void p?.close();
    };
  }, [id, version]);

  // Reloj de pantalla
  useEffect(() => {
    if (!player?.playing) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 80);
    return () => window.clearInterval(t);
  }, [player, player?.playing]);

  // Volúmenes efectivos (silencio / solo)
  const stems = useMemo(() => (track ? STEM_ORDER.filter((s) => track.stems.includes(s)) : []), [track]);
  const anySolo = stems.some((s) => solo[s]);
  useEffect(() => {
    if (!player) return;
    for (const s of stems) player.setGain(s, (anySolo ? solo[s] : !mute[s]) ? (vols[s] ?? 1) : 0);
  }, [player, stems, mute, solo, vols, anySolo]);

  // Espacio = reproducir / pausar
  useEffect(() => {
    if (!player) return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [player]);

  const speed = track?.edit.speed ?? 1;
  const semitones = track?.edit.semitones ?? 0;
  const getTime = useCallback(() => (player ? player.time() * speed : 0), [player, speed]);
  const key = track ? editedKey(track.analysis, semitones) : null;
  const flats = keyUsesFlats(key);
  const nameOf = useCallback((m: number) => pcName(m, notation, flats), [notation, flats]);
  const chordName = useCallback((c: ChordSeg) => chordLabel(c, semitones, notation, flats), [semitones, notation, flats]);

  if (error) {
    return (
      <div className="empty">
        <p className="err-text">{error}</p>
        <button className="ctl" onClick={onBack}>
          ← Mis pistas
        </button>
      </div>
    );
  }
  if (!track) return <p className="muted-text">{loading}</p>;

  const an = track.analysis;
  const playT = player?.time() ?? 0;
  const srcT = playT * speed;
  const duration = player?.duration || an.duration / speed;
  const ci = chordIndexAt(an.chords, srcT);
  const cur = ci >= 0 ? an.chords[ci] : null;
  const next = an.chords.find((c) => c.t > srcT && (!cur || c.root !== cur.root || c.minor !== cur.minor));
  const effVol = (s: string) => ((anySolo ? solo[s] : !mute[s]) ? (vols[s] ?? 1) : 0);

  const setVol = (s: string, v: number) => {
    const nv = { ...vols, [s]: v };
    setVols(nv);
    void updateTrack(track.id, { volumes: nv });
  };
  const preset = (on: (s: string) => boolean) => {
    setSolo({});
    setMute(Object.fromEntries(stems.map((s) => [s, !on(s)])));
  };

  const applyEdit = async () => {
    if (!pending) return;
    setBusy('Aplicando tono y velocidad…');
    try {
      const audio: Record<string, Blob> = {};
      for (const [i, s] of track.stems.entries()) {
        setBusy(`Aplicando tono y velocidad… (${i + 1}/${track.stems.length})`);
        audio[s] = await fetchStem(track.id, s, pending.semitones, pending.speed);
      }
      await saveTrack({ ...track, edit: pending, volumes: vols }, audio);
      setPending(null);
      setLoopA(null);
      setVersion((v) => v + 1);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const zip = async () => {
    setBusy('Preparando el ZIP…');
    try {
      const volumes = Object.fromEntries(stems.map((s) => [s, effVol(s)]));
      const l = player?.loop;
      const blob = await downloadZip(track.id, {
        volumes,
        semitones,
        speed,
        notation: notation === 'latin' ? 'latin' : 'american',
        sheet: track.sheet,
        title: track.title,
        artist: track.artist,
        ...(l ? { start: l.a, end: l.b } : {}),
      });
      saveBlob(blob, `${track.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'pista'}.zip`);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const edit = pending ?? track.edit;
  const dirty = !!pending && (pending.semitones !== track.edit.semitones || pending.speed !== track.edit.speed);

  return (
    <div className="stems-track">
      <div className="st-head">
        <button className="ctl" onClick={onBack}>
          ← Mis pistas
        </button>
        <div className="ri-main">
          <b>{track.title}</b>
          <span>{track.artist}</span>
        </div>
        <div className="ri-tags">
          {key ? <span className="tag amber">{keyLabel(key, notation)}</span> : null}
          <span className="tag dim">{Math.round(an.bpm * speed)} BPM</span>
        </div>
      </div>

      {/* Acorde actual + transporte */}
      <div className="st-now">
        <div className="pp-chord">
          <small>Acorde</small>
          <b>{cur ? chordName(cur) : '—'}</b>
          <span>sigue: {next ? chordName(next) : 'fin'}</span>
        </div>
        <div className="st-transport">
          <div className="row-btns">
            <button className="cta big" disabled={!player} onClick={() => player?.toggle()}>
              {player?.playing ? '❚❚ Pausa' : '▶ Tocar'}
            </button>
            <button className="ctl" disabled={!player} onClick={() => player?.seek(player.loop?.a ?? 0)} title="Volver al inicio (o al inicio del tramo)">
              ⏮
            </button>
            <button className="ctl" disabled={!player} onClick={() => player?.seek(playT - 5)}>
              −5 s
            </button>
            <button className="ctl" disabled={!player} onClick={() => player?.seek(playT + 5)}>
              +5 s
            </button>
            <span className="st-time">
              {fmtTime(playT)} / {fmtTime(duration)}
            </span>
          </div>
          <div className="row-btns">
            <span className="muted-text">Repetir tramo:</span>
            <button className={`ctl small ${loopA !== null && !player?.loop ? 'amber' : ''}`} disabled={!player} onClick={() => (setLoopA(playT), player?.setLoop(null))}>
              A {loopA !== null ? fmtTime(loopA) : ''}
            </button>
            <button className={`ctl small ${player?.loop ? 'amber' : ''}`} disabled={!player || loopA === null || playT <= loopA + 0.3} onClick={() => loopA !== null && player?.setLoop({ a: loopA, b: playT })}>
              B {player?.loop ? fmtTime(player.loop.b) : ''}
            </button>
            {loopA !== null ? (
              <button className="ctl small" onClick={() => (setLoopA(null), player?.setLoop(null))}>
                ✕ quitar
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {loading ? <p className="muted-text">{loading}</p> : null}

      {/* Mezclador */}
      <div className="acard">
        <div className="st-presets">
          <h3>Mezcla</h3>
          <button className="ctl small" onClick={() => preset(() => true)}>
            Todo
          </button>
          <button className="ctl small" onClick={() => preset((s) => s !== 'bass')}>
            Sin bajo
          </button>
          <button className="ctl small" onClick={() => preset((s) => s !== 'vocals')}>
            Karaoke (sin voz)
          </button>
          <button className="ctl small" onClick={() => preset((s) => s !== 'guitar' && s !== 'other')}>
            Sin guitarra
          </button>
          <button className="ctl small" onClick={() => preset((s) => s === 'bass' || s === 'drums')}>
            Bajo + batería
          </button>
        </div>
        <div className="mixer">
          {stems.map((s) => (
            <div key={s} className={`mx-row ${effVol(s) === 0 ? 'off' : ''}`}>
              <span className="mx-name">
                {STEM_INFO[s].emoji} {STEM_INFO[s].label}
              </span>
              <button className={`mx-btn ${mute[s] ? 'on red' : ''}`} onClick={() => setMute({ ...mute, [s]: !mute[s] })} title="Silenciar">
                M
              </button>
              <button className={`mx-btn ${solo[s] ? 'on amber' : ''}`} onClick={() => setSolo({ ...solo, [s]: !solo[s] })} title="Solo esta pista">
                S
              </button>
              <input type="range" min={0} max={1.5} step={0.01} value={vols[s] ?? 1} onChange={(e) => setVol(s, Number(e.target.value))} title="Volumen" />
              <Wave player={player} stem={s} progress={duration ? playT / duration : 0} loop={player?.loop ?? null} onSeek={(f) => player?.seek(f * duration)} />
            </div>
          ))}
        </div>
      </div>

      {/* Edición: tono y velocidad */}
      <div className="acard">
        <h3>Editar pista</h3>
        <div className="form-grid">
          <label className="field">
            <span>
              Tono: <b>{keyLabel(editedKey(an, edit.semitones), notation)}</b> ({edit.semitones > 0 ? '+' : ''}
              {edit.semitones} semitonos)
            </span>
            <span className="tr-btns">
              <button onClick={() => setPending({ ...edit, semitones: Math.max(-6, edit.semitones - 1) })}>−½</button>
              <button className={edit.semitones === 0 ? 'on' : ''} onClick={() => setPending({ ...edit, semitones: 0 })}>
                original
              </button>
              <button onClick={() => setPending({ ...edit, semitones: Math.min(6, edit.semitones + 1) })}>+½</button>
            </span>
          </label>
          <label className="field">
            <span>
              Velocidad: <b>{Math.round(edit.speed * 100)}%</b> ({Math.round(an.bpm * edit.speed)} BPM)
            </span>
            <input type="range" min={0.5} max={1.25} step={0.05} value={edit.speed} onChange={(e) => setPending({ ...edit, speed: Number(e.target.value) })} />
          </label>
        </div>
        <div className="row-btns">
          <button className="cta" disabled={!dirty || !engine || !!busy} onClick={() => void applyEdit()}>
            Aplicar cambios
          </button>
          {dirty && !engine ? <span className="err-text">Abre el motor de pistas para aplicar cambios de tono o velocidad.</span> : null}
          <span className="muted-text">Cambia el tono sin cambiar la velocidad (y al revés). Las notas y acordes se transportan solos.</span>
        </div>
      </div>

      {/* Notas */}
      <div className="tabs">
        {(
          [
            ['chords', '🎼 Acordes'],
            ['bass', '🎸 Bajo'],
            ['melody', '🎤 Melodía'],
            ['sheet', '📄 Cifrado'],
            ['text', '📝 Notas en texto'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'chords' ? (
        <ChordGrid track={track} srcT={srcT} chordName={chordName} onSeek={(t) => player?.seek(t / speed)} />
      ) : tab === 'bass' || tab === 'melody' ? (
        (tab === 'bass' ? an.bass : an.melody).length ? (
          <>
            <NoteRoad mode={tab} notes={tab === 'bass' ? an.bass : an.melody} chords={an.chords} semitones={semitones} getTime={getTime} nameOf={nameOf} chordName={chordName} liveMidi={liveMidi} />
            <p className="muted-text">
              {tab === 'bass' ? 'Carril = cuerda, número = traste. ' : ''}
              Con el micrófono o la interfaz encendidos en el escenario, aquí ves tu nota en vivo y si coincide. Silencia {tab === 'bass' ? 'el bajo' : 'la voz'} en la mezcla para tocar tú encima.
            </p>
          </>
        ) : (
          <p className="muted-text">No se detectó {tab === 'bass' ? 'bajo' : 'voz'} en esta canción.</p>
        )
      ) : tab === 'sheet' ? (
        <SheetTab track={track} onSaved={(sheet) => setTrack({ ...track, sheet })} />
      ) : (
        <TextTab text={notesText(track, notation, track.edit)} title={track.title} />
      )}

      <div className="acard">
        <h3>⬇ Descargar</h3>
        <div className="row-btns">
          <button className="cta" disabled={!engine || !!busy} onClick={() => void zip()}>
            Descargar ZIP: mezcla + pistas + notas
          </button>
          <span className="muted-text">
            {busy ??
              (engine
                ? `Incluye la mezcla con los volúmenes de arriba${player?.loop ? ' (solo el tramo A–B)' : ''}, un MP3 por instrumento, las notas en texto, el cifrado y un MIDI.`
                : 'Abre el motor de pistas para generar el ZIP. Las notas en texto se pueden bajar sin él (pestaña «Notas en texto»).')}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Forma de onda de una pista; clic para saltar. */
function Wave({ player, stem, progress, loop, onSeek }: { player: StemPlayer | null; stem: string; progress: number; loop: { a: number; b: number } | null; onSeek(frac: number): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !player) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const n = Math.max(1, Math.floor(W / 2));
    const peaks = player.peaks(stem, n);
    g.fillStyle = 'rgba(247,243,234,0.55)';
    for (let i = 0; i < n; i++) {
      const h = Math.max(1, Math.min(1, peaks[i] * 1.4) * (H - 2));
      g.fillRect(i * 2, (H - h) / 2, 1.4, h);
    }
  }, [player, stem]);
  const dur = player?.duration || 1;
  return (
    <div
      className="mx-wave"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - r.left) / r.width);
      }}
    >
      <canvas ref={ref} />
      {loop ? <span className="mx-loop" style={{ left: `${(loop.a / dur) * 100}%`, width: `${((loop.b - loop.a) / dur) * 100}%` }} /> : null}
      <span className="mx-head" style={{ left: `${Math.min(1, progress) * 100}%` }} />
    </div>
  );
}

/** Acordes por compás; el compás que suena se ilumina. Clic para saltar. */
function ChordGrid({ track, srcT, chordName, onSeek }: { track: StoredTrack; srcT: number; chordName(c: ChordSeg): string; onSeek(t: number): void }) {
  const an = track.analysis;
  const bars = useMemo(() => barsOf(an).map((b) => ({ ...b, chords: chordsInBar(an, b) })), [an]);
  const active = bars.findIndex((b) => srcT >= b.a && srcT < b.b);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  if (!bars.length) return <p className="muted-text">No se pudieron detectar los compases de esta canción.</p>;
  return (
    <div className="chord-grid" ref={ref}>
      {bars.map((b, i) => (
        <button key={i} className={`cg-bar ${i === active ? 'on' : ''} ${b.chords.length ? '' : 'rest'}`} onClick={() => onSeek(b.a)}>
          {i % 4 === 0 ? <small>{fmtTime(b.a / track.edit.speed)}</small> : null}
          <b>{b.chords.map(chordName).join(' ') || '·'}</b>
        </button>
      ))}
    </div>
  );
}

function SheetTab({ track, onSaved }: { track: StoredTrack; onSaved(sheet: string): void }) {
  const [text, setText] = useState(track.sheet);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (sheet: string, extra: Partial<StoredTrack> = {}) => {
    await updateTrack(track.id, { sheet, title, artist, ...extra });
    store.upsertSong(sheetKeyFor(title), title, artist, { sheet, origKey: track.analysis.key });
    track.title = title;
    track.artist = artist;
    onSaved(sheet);
  };
  return (
    <div className="sheet-tab">
      <div className="form-grid">
        <label className="field">
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Artista
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
      </div>
      <textarea className="sheet-text" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} rows={16} />
      <div className="row-btns">
        <button
          className="cta"
          onClick={() =>
            void save(text).then(() => {
              setMsg('Guardado. También está en Biblioteca → Canciones y en 🎮 Práctica.');
            })
          }
        >
          Guardar cifrado
        </button>
        <button
          className="ctl"
          onClick={() => {
            setMsg('Buscando la letra…');
            void findLyrics(title, artist).then((lrc) => {
              const sheet = buildSheet(track.analysis, lrc ? parseLrc(lrc) : null);
              setText(sheet);
              void save(sheet, { lrc });
              setMsg(lrc ? 'Cifrado regenerado con la letra sincronizada.' : 'No encontré letra sincronizada con ese título y artista: quedó solo con acordes.');
            });
          }}
        >
          ↻ Regenerar (buscar letra con este título)
        </button>
        {msg ? <span className="muted-text">{msg}</span> : null}
      </div>
      <p className="muted-text">Cifrado en el tono original, detectado automáticamente: corrígelo aquí lo que haga falta. Al guardarlo queda en tu biblioteca de canciones.</p>
    </div>
  );
}

function TextTab({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sheet-tab">
      <div className="row-btns">
        <button
          className="ctl"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? '✓ Copiado' : '📋 Copiar'}
        </button>
        <button className="ctl" onClick={() => saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'notas'} - notas.txt`)}>
          ⬇ Descargar .txt
        </button>
      </div>
      <pre className="notes-text">{text}</pre>
    </div>
  );
}
