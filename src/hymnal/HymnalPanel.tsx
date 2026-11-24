import { useEffect, useMemo, useRef, useState } from 'react';
import { keyLabel } from '../audio/music';
import { inferSheetKey, parseSheet } from '../song/chords';
import { cleanPastedSheet } from '../song/importSheet';
import { normalize } from '../song/text';
import { exportJson, hymnStore, importFiles, useHymns } from './hymnStore';
import { HymnViewer } from './HymnViewer';
import { Hymn, HYMN_COUNT, normalizeHymnText, searchText, simplify, splitSections } from './model';

type Tab = 'all' | 'ready' | 'favs' | 'set';

const ALL = Array.from({ length: HYMN_COUNT }, (_, i) => i + 1);

export function HymnalPanel({ onClose, onStage }: { onClose(): void; onStage?(h: Hymn): void }) {
  const hymns = useHymns((d) => d.hymns);
  const favs = useHymns((d) => d.favorites);
  const setlist = useHymns((d) => d.setlist);
  const notation = useHymns((d) => d.settings.notation);
  const [tab, setTab] = useState<Tab>(() => (readTab() as Tab) || 'all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('lsa.himnario.tab', tab);
    } catch {
      /* noop */
    }
  }, [tab]);

  const index = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of Object.values(hymns)) m.set(h.num, searchText(h));
    return m;
  }, [hymns]);

  const filled = Object.keys(hymns).length;
  const base = tab === 'favs' ? favs : tab === 'set' ? setlist : tab === 'ready' ? ALL.filter((n) => hymns[n]) : ALL;
  const nq = normalize(q);
  const list = !nq
    ? base
    : /^\d+$/.test(nq)
      ? base.filter((n) => String(n).startsWith(nq))
      : base.filter((n) => nq.split(' ').every((w) => index.get(n)?.includes(w)));

  // Secuencia para ← → dentro del visor: la pestaña actual, solo himnos cargados
  const sequence = base.filter((n) => hymns[n]);

  const openNum = (n: number) => (hymns[n] ? setOpen(n) : setEditing(n));
  const onEnter = () => {
    const n = Number(nq);
    if (/^\d+$/.test(nq) && n >= 1 && n <= HYMN_COUNT) openNum(n);
    else if (list[0]) openNum(list[0]);
  };

  const doImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const r = await importFiles(files);
    setMsg(`Importados ${r.added.length} himnos${r.skipped.length ? ` · omitidos: ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}` : ''}`);
  };

  const doExport = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(exportJson());
    a.download = `himnario-gloria-y-triunfo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const openHymn = open !== null ? hymns[open] : null;

  return (
    <div className="panel-wrap" role="dialog" aria-label="Himnario">
      <div className="panel hymnal">
        <div className="panel-head">
          <h1>Himnos de Gloria y Triunfo</h1>
          <button className="ctl" onClick={onClose}>
            ✕ Volver al escenario
          </button>
        </div>
        <div className="panel-body">
          <div className="hy-search">
            <input
              autoFocus
              inputMode="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onEnter()}
              placeholder="Número o palabras de la letra…"
              aria-label="Buscar himno por número, título o letra"
            />
            <span className="hy-count">
              {filled}/{HYMN_COUNT} cargados
            </span>
          </div>

          <div className="tabs">
            {(
              [
                ['all', 'Todos'],
                ['ready', 'Con letra'],
                ['favs', `★ Favoritos (${favs.length})`],
                ['set', `Lista del culto (${setlist.length})`],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          <div className="hy-actions">
            <button className="ctl small" onClick={() => fileRef.current?.click()}>
              ⤓ Importar
            </button>
            <button className="ctl small" disabled={!filled} onClick={doExport}>
              ⤒ Respaldo .json
            </button>
            {tab === 'set' && setlist.length ? (
              <button className="ctl small danger" onClick={() => hymnStore.setSetlist([])}>
                Vaciar lista
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept=".json,.txt,.cho,.chopro,.chordpro,.crd,.pro"
              onChange={(e) => {
                void doImport(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {msg ? <div className="hy-msg">{msg}</div> : null}
          {!filled ? (
            <div className="empty">
              El himnario está vacío. Toca un número para pegar su letra y acordes, o importa un respaldo
              (.json) o archivos .txt / ChordPro. Todo se guarda en este dispositivo y funciona sin internet.
            </div>
          ) : null}

          <ul className="hy-list">
            {list.map((n) => {
              const h = hymns[n];
              const inSet = setlist.includes(n);
              return (
                <li key={n} className={h ? '' : 'empty-row'}>
                  <button className="hy-row" onClick={() => openNum(n)}>
                    <span className="hy-n">{n}</span>
                    <span className="hy-t">{h ? h.title : 'Sin cargar · tocar para agregar'}</span>
                    {h?.key ? <span className="hy-k">{keyLabel({ ...h.key, confidence: 1 }, notation)}</span> : null}
                    {favs.includes(n) ? <span className="hy-fav">★</span> : null}
                  </button>
                  {h ? (
                    <button
                      className={`ctl icon small ${inSet ? 'active' : ''}`}
                      aria-pressed={inSet}
                      title={inSet ? 'Quitar de la lista del culto' : 'Agregar a la lista del culto'}
                      onClick={() => hymnStore.setSetlist(inSet ? setlist.filter((x) => x !== n) : [...setlist, n])}
                    >
                      {inSet ? '✓' : '+'}
                    </button>
                  ) : null}
                  {tab === 'set' ? (
                    <span className="hy-move">
                      <button className="ctl icon small" aria-label="Subir" onClick={() => move(setlist, n, -1)}>
                        ↑
                      </button>
                      <button className="ctl icon small" aria-label="Bajar" onClick={() => move(setlist, n, 1)}>
                        ↓
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {openHymn ? (
        <HymnViewer
          hymn={openHymn}
          sequence={sequence.length ? sequence : [openHymn.num]}
          onNavigate={setOpen}
          onClose={() => setOpen(null)}
          onEdit={() => {
            setEditing(openHymn.num);
            setOpen(null);
          }}
          onStage={onStage}
        />
      ) : null}
      {editing !== null ? (
        <HymnEditor
          num={editing}
          onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            setOpen(n);
          }}
        />
      ) : null}
    </div>
  );
}

function readTab() {
  try {
    return localStorage.getItem('lsa.himnario.tab');
  } catch {
    return null;
  }
}

function move(list: number[], n: number, d: number) {
  const i = list.indexOf(n);
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  hymnStore.setSetlist(next);
}

// ── Editor de un himno ──────────────────────────────────────────────────────

const PLACEHOLDER = `[Estrofa 1]
Sol            Do        Sol
Primera línea de la estrofa
           Re          Sol
segunda línea de la estrofa

[Coro]
Do          Sol
Línea del coro…

[Estrofa 2]
(solo la letra: toma los acordes de la estrofa 1)`;

function HymnEditor({ num, onClose, onSaved }: { num: number; onClose(): void; onSaved(n: number): void }) {
  const existing = hymnStore.hymn(num);
  const notation = hymnStore.get().settings.notation;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [text, setText] = useState(existing?.text ?? '');
  const [key, setKey] = useState(existing?.key ? `${existing.key.root}:${existing.key.scale}` : '');
  const [bpm, setBpm] = useState(existing?.bpm ? String(existing.bpm) : '');
  const [cleanMsg, setCleanMsg] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections = useMemo(() => splitSections(text), [text]);
  const report = useMemo(() => simplify(sections, { collapseChorus: true, shareVerseChords: true }), [sections]);
  const guessed = useMemo(() => inferSheetKey(parseSheet(text)), [text]);
  const chordCount = sections.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.chords.length, 0), 0);

  /** Limpia lo pegado de LaCuerda / Cifra Club / AcordesWeb (publicidad, «Tono:», tablaturas…). */
  const cleanUp = () => {
    const c = cleanPastedSheet(text);
    const next = normalizeHymnText(c.sheet)
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      // una línea en blanco antes de cada sección para que se lea mejor
      .replace(/\n*(\[[^\]]+\])\n/g, '\n\n$1\n')
      .trim();
    setCleanMsg(next === text.trim() ? 'Ya estaba en el formato correcto.' : `Listo: ${splitSections(next).map((s) => s.label).join(' · ')}`);
    setText(next);
    if (!title && c.title) setTitle(c.title);
    if (!key && c.key) setKey(`${c.key.root}:${c.key.scale}`);
    if (!bpm && c.bpm) setBpm(String(c.bpm));
  };

  const save = () => {
    if (!text.trim()) return;
    const [r, sc] = key.split(':');
    hymnStore.save({
      num,
      title: title.trim() || `Himno ${num}`,
      key: key ? { root: Number(r), scale: sc as 'major' | 'minor' } : null,
      bpm: Number(bpm) || null,
      scroll: existing?.scroll ?? null,
      text: text.replace(/\s+$/gm, ''),
      updated: Date.now(),
    });
    onSaved(num);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet-editor hy-editor" onClick={(e) => e.stopPropagation()}>
        <div className="se-head">
          <div>
            <div className="eyebrow">Himno {num}</div>
            <input className="hy-title-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del himno" aria-label="Título" />
          </div>
          <button className="ctl icon" onClick={onClose} title="Cerrar">
            ✕
          </button>
        </div>
        <p className="se-help">
          Pega la letra con acordes (acordes encima de la letra o <code>[Sol]letra</code>). Marca las partes con{' '}
          <code>[Estrofa 1]</code>, <code>[Coro]</code> o numera las estrofas <code>1.</code> <code>2.</code> como en el
          himnario. Basta escribir el coro <b>una vez</b> y poner acordes solo en la primera estrofa: la app los repite.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={PLACEHOLDER} />
        {cleanMsg ? <div className="hy-msg">{cleanMsg}</div> : null}
        <div className="hy-report">
          {sections.length ? `${sections.map((s) => s.label).join(' · ')} — ${chordCount} acordes` : 'Sin contenido'}
          {report.notes.length ? <div>✓ {report.notes.join(' · ')}</div> : null}
        </div>
        <div className="se-foot">
          <button className="ctl small" onClick={cleanUp} disabled={!text.trim()} title="Quitar publicidad, tablaturas y datos del sitio web">
            🧹 Limpiar pegado
          </button>
          <label>
            Tono
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">{guessed ? `Auto: ${keyLabel(guessed, notation)}` : 'Auto'}</option>
              {(['major', 'minor'] as const).flatMap((scale) =>
                Array.from({ length: 12 }, (_, r) => (
                  <option key={`${r}:${scale}`} value={`${r}:${scale}`}>
                    {keyLabel({ root: r, scale, confidence: 1 }, notation)}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            BPM
            <input className="hy-bpm" inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/\D/g, ''))} />
          </label>
          {existing ? (
            <button
              className="ctl small danger"
              onClick={() => {
                if (confirm(`¿Borrar el himno ${num} de este dispositivo?`)) {
                  hymnStore.remove(num);
                  onClose();
                }
              }}
            >
              Borrar
            </button>
          ) : null}
          <button className="cta" onClick={save} disabled={!text.trim()}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
