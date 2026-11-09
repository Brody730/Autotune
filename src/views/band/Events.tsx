import { useMemo, useState } from 'react';
import { keyLabel, MusicalKey, Notation } from '../../audio/music';
import { BandEvent, BandSong, deleteBandEvent, EventItem, friendly, saveBandEvent } from '../../band/api';
import { bandStore, useBand } from '../../band/bandStore';
import type { KeyRef } from '../../lib/store';
import { downloadText, printText, renderSheetText, SheetText, sheetOrigKey, shiftTo, useFontSize } from './SheetText';

const mk = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });
const KIND_LABEL = { servicio: '⛪ Servicio', ensayo: '🎼 Ensayo', evento: '✨ Evento' } as const;
const today = () => new Date().toISOString().slice(0, 10);

function fmtDate(d: string) {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Texto de todo el repertorio del servicio, cada canción en su tono. */
export function setlistText(ev: BandEvent, songs: BandSong[], notation: Notation) {
  const head = `${ev.title} — ${fmtDate(ev.event_date)}\n${ev.items
    .map((it, i) => {
      const s = songs.find((x) => x.id === it.songId);
      return s ? `${i + 1}. ${s.title}${it.key ? ` (${keyLabel(mk(it.key), notation)})` : ''}` : null;
    })
    .filter(Boolean)
    .join('\n')}\n${ev.notes ? `\nNotas: ${ev.notes}\n` : ''}`;
  const body = ev.items
    .map((it, i) => {
      const s = songs.find((x) => x.id === it.songId);
      if (!s) return '';
      const orig = sheetOrigKey(s.sheet, s.orig_key);
      return `\n${'═'.repeat(40)}\n${i + 1}. ${renderSheetText({ title: s.title, artist: s.artist, sheet: s.sheet, orig, shift: shiftTo(orig, it.key), notation })}${it.notes ? `Nota: ${it.notes}\n` : ''}`;
    })
    .join('');
  return head + body;
}

export function Events({ notation, onUseInJam }: { notation: Notation; onUseInJam(ev: BandEvent): void }) {
  const events = useBand((s) => s.events);
  const [open, setOpen] = useState<string | null>(null);
  const t = today();
  const upcoming = events.filter((e) => e.event_date >= t).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const past = events.filter((e) => e.event_date < t);
  const current = open ? events.find((e) => e.id === open) : null;

  if (current) return <EventDetail ev={current} notation={notation} onBack={() => setOpen(null)} onUseInJam={onUseInJam} />;

  return (
    <>
      <div className="seg-row">
        <NewEvent onCreated={setOpen} />
        <span className="muted-text">Prepara la lista de cada servicio o ensayo; toda la banda la ve con los tonos acordados.</span>
      </div>
      {!events.length ? <div className="empty">Aún no hay servicios ni ensayos programados.</div> : null}
      {upcoming.length ? <h3 className="list-h">Próximos</h3> : null}
      <div className="list">
        {upcoming.map((e) => (
          <EventRow key={e.id} e={e} onOpen={() => setOpen(e.id)} />
        ))}
      </div>
      {past.length ? <h3 className="list-h">Anteriores</h3> : null}
      <div className="list">
        {past.map((e) => (
          <EventRow key={e.id} e={e} onOpen={() => setOpen(e.id)} />
        ))}
      </div>
    </>
  );
}

function EventRow({ e, onOpen }: { e: BandEvent; onOpen(): void }) {
  return (
    <button className="row-item" onClick={onOpen}>
      <div className="ri-main">
        <b>{e.title}</b>
        <span>
          {KIND_LABEL[e.kind] ?? e.kind} · {fmtDate(e.event_date)}
        </span>
      </div>
      <div className="ri-tags">
        <span className="tag">{e.items.length} canciones</span>
      </div>
    </button>
  );
}

function NewEvent({ onCreated }: { onCreated(id: string): void }) {
  const bandId = useBand((s) => s.activeId);
  const userId = useBand((s) => s.userId);
  const [busy, setBusy] = useState(false);
  const create = async (kind: BandEvent['kind']) => {
    if (!bandId || !userId) return;
    setBusy(true);
    try {
      const d = new Date();
      // Por defecto: el próximo domingo para servicios
      if (kind === 'servicio') d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      const ev = await saveBandEvent(
        {
          band_id: bandId,
          title: kind === 'servicio' ? 'Servicio dominical' : kind === 'ensayo' ? 'Ensayo' : 'Evento especial',
          kind,
          event_date: d.toISOString().slice(0, 10),
          items: [],
        },
        userId,
      );
      bandStore.upsertEventLocal(ev);
      onCreated(ev.id);
    } catch (err) {
      alert(friendly(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row-btns">
      <button className="cta" disabled={busy} onClick={() => void create('servicio')}>
        + Servicio
      </button>
      <button className="ctl" disabled={busy} onClick={() => void create('ensayo')}>
        + Ensayo
      </button>
      <button className="ctl" disabled={busy} onClick={() => void create('evento')}>
        + Evento
      </button>
    </span>
  );
}

function EventDetail({
  ev,
  notation,
  onBack,
  onUseInJam,
}: {
  ev: BandEvent;
  notation: Notation;
  onBack(): void;
  onUseInJam(ev: BandEvent): void;
}) {
  const songs = useBand((s) => s.songs);
  const userId = useBand((s) => s.userId)!;
  const [mode, setMode] = useState<'list' | 'rehearse'>('list');
  const [adding, setAdding] = useState('');
  const { size, change } = useFontSize();

  const save = async (patch: Partial<BandEvent>) => {
    const next = { ...ev, ...patch };
    bandStore.upsertEventLocal(next);
    try {
      bandStore.upsertEventLocal(await saveBandEvent(next, userId));
    } catch (err) {
      alert(friendly(err));
    }
  };
  const setItems = (items: EventItem[]) => void save({ items });
  const available = useMemo(() => songs.filter((s) => !ev.items.some((it) => it.songId === s.id)), [songs, ev.items]);

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="ctl" onClick={onBack}>
          ← Servicios
        </button>
        <div className="detail-title">
          <input className="title-input" defaultValue={ev.title} onBlur={(e) => e.target.value.trim() !== ev.title && void save({ title: e.target.value.trim() || ev.title })} />
          <span className="row-btns">
            <select value={ev.kind} onChange={(e) => void save({ kind: e.target.value as BandEvent['kind'] })}>
              <option value="servicio">⛪ Servicio</option>
              <option value="ensayo">🎼 Ensayo</option>
              <option value="evento">✨ Evento</option>
            </select>
            <input type="date" value={ev.event_date} onChange={(e) => e.target.value && void save({ event_date: e.target.value })} />
          </span>
        </div>
        <button className="cta" onClick={() => onUseInJam(ev)} disabled={!ev.items.length} title="Dirigir la JAM con esta lista">
          ▶ Usar en la JAM
        </button>
      </div>

      <div className="seg-row">
        <div className="seg">
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
            Lista
          </button>
          <button className={mode === 'rehearse' ? 'on' : ''} onClick={() => setMode('rehearse')}>
            🎼 Modo ensayo
          </button>
        </div>
        <button className="ctl" onClick={() => downloadText(`${ev.title} ${ev.event_date}`, setlistText(ev, songs, notation))} disabled={!ev.items.length}>
          ⬇ Descargar todo (.txt)
        </button>
        <button className="ctl" onClick={() => printText(ev.title, setlistText(ev, songs, notation))} disabled={!ev.items.length}>
          🖨 Imprimir / PDF
        </button>
      </div>

      {mode === 'list' ? (
        <>
          <ol className="setlist-edit">
            {ev.items.map((it, i) => {
              const s = songs.find((x) => x.id === it.songId);
              const orig = s ? sheetOrigKey(s.sheet, s.orig_key) : null;
              const move = (d: number) => {
                const items = [...ev.items];
                const [x] = items.splice(i, 1);
                items.splice(i + d, 0, x);
                setItems(items);
              };
              return (
                <li key={it.songId + i} className="se-row">
                  <div className="ri-main">
                    <b>{s?.title ?? '(canción borrada)'}</b>
                    <span>{s?.artist}</span>
                  </div>
                  <label className="se-key">
                    Tono
                    <select
                      value={it.key ? `${it.key.root}:${it.key.scale}` : ''}
                      onChange={(e) => {
                        const [r, sc] = e.target.value.split(':');
                        const items = [...ev.items];
                        items[i] = { ...it, key: e.target.value ? { root: Number(r), scale: sc as 'major' | 'minor' } : null };
                        setItems(items);
                      }}
                    >
                      <option value="">{orig ? `Original (${keyLabel(mk(orig), notation)})` : 'Original'}</option>
                      {Array.from({ length: 12 }, (_, r) => {
                        const scale = orig?.scale ?? 'major';
                        return (
                          <option key={r} value={`${r}:${scale}`}>
                            {keyLabel({ root: r, scale, confidence: 1 }, notation)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <input
                    className="se-note"
                    placeholder="Nota (ej. coro x2)"
                    defaultValue={it.notes ?? ''}
                    onBlur={(e) => {
                      if ((it.notes ?? '') === e.target.value) return;
                      const items = [...ev.items];
                      items[i] = { ...it, notes: e.target.value };
                      setItems(items);
                    }}
                  />
                  <span className="tr-btns">
                    <button disabled={i === 0} onClick={() => move(-1)}>
                      ↑
                    </button>
                    <button disabled={i === ev.items.length - 1} onClick={() => move(1)}>
                      ↓
                    </button>
                    <button onClick={() => setItems(ev.items.filter((_, j) => j !== i))}>✕</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="row-btns">
            <select value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">{available.length ? 'Agregar canción de la bóveda…' : 'No hay más canciones en la bóveda'}</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              className="ctl"
              disabled={!adding}
              onClick={() => {
                setItems([...ev.items, { songId: adding, key: null }]);
                setAdding('');
              }}
            >
              + Agregar
            </button>
          </div>
          <label className="field">
            Notas del servicio
            <input defaultValue={ev.notes} placeholder="Ej. Llegar 8:30 · prueba de sonido 9:00" onBlur={(e) => e.target.value !== ev.notes && void save({ notes: e.target.value })} />
          </label>
          <div className="detail-foot">
            <span />
            <button
              className="ctl danger"
              onClick={async () => {
                if (!confirm(`¿Borrar «${ev.title}»?`)) return;
                try {
                  await deleteBandEvent(ev.id);
                  bandStore.upsertEventLocal({ ...ev, deleted: true });
                  onBack();
                } catch (err) {
                  alert(friendly(err));
                }
              }}
            >
              Borrar
            </button>
          </div>
        </>
      ) : (
        <div className="rehearse">
          <span className="tr-btns">
            <button onClick={() => change(-1)}>A−</button>
            <button onClick={() => change(1)}>A+</button>
          </span>
          {ev.items.map((it, i) => {
            const s = songs.find((x) => x.id === it.songId);
            if (!s) return null;
            const orig = sheetOrigKey(s.sheet, s.orig_key);
            const shift = shiftTo(orig, it.key);
            const target = it.key ?? orig;
            return (
              <section key={i}>
                <h3>
                  {i + 1}. {s.title} {target ? <span className="tag amber">{keyLabel(mk(target), notation)}</span> : null}
                  {s.bpm ? <span className="tag dim">{s.bpm} bpm</span> : null}
                </h3>
                {it.notes ? <div className="suggest dim">📝 {it.notes}</div> : null}
                <SheetText sheet={s.sheet} orig={orig} shift={shift} notation={notation} size={size} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
