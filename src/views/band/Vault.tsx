import { useMemo, useRef, useState } from 'react';
import { keyLabel, MusicalKey, Notation } from '../../audio/music';
import { BandSong, deleteBandSong, friendly, saveBandSong } from '../../band/api';
import { bandStore, myMember, useBand } from '../../band/bandStore';
import { parseSheet } from '../../song/chords';
import { sheetKeyFor } from '../../song/ChordSheet';
import { cleanPastedSheet, ImportedSheet, importFile, parseChordProFile, searchLinks } from '../../song/importSheet';
import { store, useStore, type KeyRef } from '../../lib/store';
import {
  downloadText,
  printText,
  renderSheetText,
  SheetText,
  sheetOrigKey,
  TransposeControls,
  useFontSize,
} from './SheetText';

const mk = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString();
}

/** Bóveda: cifrados compartidos por toda la banda, editables por todos. */
export function Vault({ notation }: { notation: Notation }) {
  const songs = useBand((s) => s.songs);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<BandSong | 'new' | null>(null);

  const list = useMemo(
    () => songs.filter((s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q.toLowerCase())),
    [songs, q],
  );
  const current = open ? songs.find((s) => s.id === open) : null;

  if (editing) {
    return <SongEditor song={editing === 'new' ? null : editing} notation={notation} onDone={(id) => (setEditing(null), id && setOpen(id))} />;
  }
  if (current) {
    return <SongViewer song={current} notation={notation} onBack={() => setOpen(null)} onEdit={() => setEditing(current)} />;
  }

  return (
    <>
      <div className="seg-row">
        <input className="filter" placeholder="Buscar en la bóveda…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="cta" onClick={() => setEditing('new')}>
          + Subir cifrado
        </button>
        <ImportFiles />
        <ImportFromLibrary />
      </div>
      {!songs.length ? (
        <div className="empty">
          <p>La bóveda está vacía.</p>
          <p>Sube los cifrados del repertorio (copiados de LaCuerda, Cifraclub o escritos por ustedes). Toda la banda los verá y podrá editarlos y transportarlos.</p>
        </div>
      ) : null}
      <div className="list">
        {list.map((s) => {
          const k = sheetOrigKey(s.sheet, s.orig_key);
          return (
            <button key={s.id} className="row-item" onClick={() => setOpen(s.id)}>
              <div className="ri-main">
                <b>{s.title}</b>
                <span>
                  {s.artist || '—'} · editado {ago(s.updated_at)}
                  {s.updated_by_name ? ` por ${s.updated_by_name}` : ''}
                </span>
              </div>
              <div className="ri-tags">
                {k ? <span className="tag amber">{keyLabel(mk(k), notation)}</span> : null}
                {s.bpm ? <span className="tag dim">{s.bpm} bpm</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Importa varios archivos a la vez: ChordPro (CCLI SongSelect, OnSong…) o .txt. */
function ImportFiles() {
  const bandId = useBand((s) => s.activeId);
  const userId = useBand((s) => s.userId);
  const vault = useBand((s) => s.songs);
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!bandId || !userId) return null;

  const run = async (files: FileList) => {
    const who = { id: userId, name: myMember()?.display_name ?? '' };
    let ok = 0;
    const skipped: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = importFile(f.name, await f.text());
        const songKey = sheetKeyFor(r.title);
        if (!r.sheet.trim()) {
          skipped.push(`${f.name} (vacío)`);
          continue;
        }
        if (vault.some((v) => v.song_key === songKey)) {
          skipped.push(`${r.title} (ya está)`);
          continue;
        }
        setMsg(`Importando ${f.name}…`);
        const saved = await saveBandSong(
          { band_id: bandId, song_key: songKey, title: r.title, artist: r.artist, sheet: r.sheet, orig_key: r.key, bpm: r.bpm },
          who,
        );
        bandStore.upsertSongLocal(saved);
        ok++;
      } catch (err) {
        skipped.push(`${f.name} (${friendly(err)})`);
      }
    }
    setMsg(`✓ ${ok} importada${ok === 1 ? '' : 's'}${skipped.length ? ` · omitidas: ${skipped.join(', ')}` : ''}`);
  };

  return (
    <>
      <button className="ctl" onClick={() => input.current?.click()} title="ChordPro (.cho, .chordpro, .pro) de SongSelect/OnSong, o .txt">
        📂 Importar archivos
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".txt,.cho,.chopro,.chordpro,.crd,.pro,text/plain"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void run(e.target.files);
          e.target.value = '';
        }}
      />
      {msg ? <span className="muted-text">{msg}</span> : null}
    </>
  );
}

/** Copia a la bóveda los cifrados de mi biblioteca personal. */
function ImportFromLibrary() {
  const mine = useStore((d) => d.songs);
  const vault = useBand((s) => s.songs);
  const bandId = useBand((s) => s.activeId);
  const userId = useBand((s) => s.userId);
  const [busy, setBusy] = useState(false);
  const candidates = Object.values(mine).filter((s) => !s.deleted && s.sheet && !vault.some((v) => v.song_key === s.key));
  if (!candidates.length || !bandId || !userId) return null;
  return (
    <button
      className="ctl"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`¿Subir a la bóveda tus ${candidates.length} cifrados personales?`)) return;
        setBusy(true);
        const who = { id: userId, name: myMember()?.display_name ?? '' };
        for (const s of candidates) {
          try {
            const saved = await saveBandSong(
              { band_id: bandId, song_key: s.key, title: s.title, artist: s.artist, sheet: s.sheet ?? '', orig_key: s.origKey },
              who,
            );
            bandStore.upsertSongLocal(saved);
          } catch (err) {
            alert(friendly(err));
            break;
          }
        }
        setBusy(false);
      }}
    >
      ⬆ Subir mis cifrados ({candidates.length})
    </button>
  );
}

function SongViewer({ song, notation, onBack, onEdit }: { song: BandSong; notation: Notation; onBack(): void; onEdit(): void }) {
  const orig = sheetOrigKey(song.sheet, song.orig_key);
  const [shift, setShift] = useState(0);
  const { size, change } = useFontSize();
  const text = () => renderSheetText({ title: song.title, artist: song.artist, sheet: song.sheet, orig, shift, notation });
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="ctl" onClick={onBack}>
          ← Bóveda
        </button>
        <div className="detail-title">
          <h2>{song.title}</h2>
          <span>
            {song.artist}
            {song.bpm ? ` · ${song.bpm} bpm` : ''} · editado {ago(song.updated_at)}
            {song.updated_by_name ? ` por ${song.updated_by_name}` : ''}
          </span>
        </div>
        <button
          className="ctl amber"
          onClick={() => window.dispatchEvent(new CustomEvent('lsa:practice', { detail: song.song_key }))}
          title="Tocar esta canción con pista y puntaje"
        >
          🎮 Practicar
        </button>
        <button className="ctl" onClick={onEdit}>
          ✏ Editar
        </button>
      </div>
      <div className="viewer-bar">
        <TransposeControls orig={orig} shift={shift} setShift={setShift} notation={notation} />
        <span className="tr-btns">
          <button onClick={() => change(-1)}>A−</button>
          <button onClick={() => change(1)}>A+</button>
        </span>
        <button className="ctl" onClick={() => downloadText(song.title, text())}>
          ⬇ .txt
        </button>
        <button className="ctl" onClick={() => printText(song.title, text())}>
          🖨 Imprimir / PDF
        </button>
      </div>
      {song.notes ? <div className="suggest dim">📝 {song.notes}</div> : null}
      <SheetText sheet={song.sheet} orig={orig} shift={shift} notation={notation} size={size} />
      <div className="detail-foot">
        <span />
        <button
          className="ctl danger"
          onClick={async () => {
            if (!confirm(`¿Quitar «${song.title}» de la bóveda de la banda?`)) return;
            try {
              await deleteBandSong(song.id);
              bandStore.upsertSongLocal({ ...song, deleted: true });
              onBack();
            } catch (err) {
              alert(friendly(err));
            }
          }}
        >
          Quitar de la bóveda
        </button>
      </div>
    </div>
  );
}

const KEYS: string[] = [];
for (const sc of ['major', 'minor']) for (let r = 0; r < 12; r++) KEYS.push(`${r}:${sc}`);

export function SongEditor({ song, notation, onDone }: { song: BandSong | null; notation: Notation; onDone(id?: string): void }) {
  const bandId = useBand((s) => s.activeId)!;
  const userId = useBand((s) => s.userId)!;
  const [title, setTitle] = useState(song?.title ?? '');
  const [artist, setArtist] = useState(song?.artist ?? '');
  const [sheet, setSheet] = useState(song?.sheet ?? '');
  const [bpm, setBpm] = useState(song?.bpm ? String(song.bpm) : '');
  const [notes, setNotes] = useState(song?.notes ?? '');
  const [key, setKey] = useState(song?.orig_key ? `${song.orig_key.root}:${song.orig_key.scale}` : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cleaned, setCleaned] = useState<string | null>(null);
  const guessed = sheetOrigKey(sheet, null);

  /** Aplica lo detectado al importar/pegar sin pisar lo que el usuario ya escribió. */
  const applyImport = (r: ImportedSheet, keepSheetIfEmpty: boolean) => {
    if (r.sheet || !keepSheetIfEmpty) setSheet(r.sheet);
    const found: string[] = [];
    if (r.title && !title.trim()) {
      setTitle(r.title);
      found.push('título');
    }
    if (r.artist && !artist.trim()) {
      setArtist(r.artist);
      found.push('autor');
    }
    if (r.key && !key) {
      setKey(`${r.key.root}:${r.key.scale}`);
      found.push(`tono ${keyLabel(mk(r.key), notation)}`);
    }
    if (r.bpm && !bpm) {
      setBpm(String(r.bpm));
      found.push(`${r.bpm} bpm`);
    }
    setCleaned(`Formato limpio${found.length ? ' · detecté ' + found.join(', ') : ''}. Revísalo antes de guardar.`);
  };
  const chordCount = parseSheet(sheet).reduce((n, l) => n + l.chords.length, 0);

  const save = async () => {
    if (!title.trim()) return setErr('Ponle título a la canción.');
    setBusy(true);
    setErr(null);
    try {
      const [r, sc] = key.split(':');
      const saved = await saveBandSong(
        {
          ...(song ? { id: song.id } : {}),
          band_id: bandId,
          song_key: sheetKeyFor(title.trim()),
          title: title.trim(),
          artist: artist.trim(),
          sheet,
          orig_key: key ? { root: Number(r), scale: sc as 'major' | 'minor' } : null,
          bpm: bpm ? Math.max(30, Math.min(260, Number(bpm))) : null,
          notes: notes.trim(),
        },
        { id: userId, name: myMember()?.display_name ?? '' },
      );
      bandStore.upsertSongLocal(saved);
      // También queda en mi biblioteca personal para «mi tono»
      store.upsertSong(saved.song_key, saved.title, saved.artist, { sheet: saved.sheet, origKey: saved.orig_key });
      onDone(saved.id);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="ctl" onClick={() => onDone(song?.id)}>
          ← Cancelar
        </button>
        <div className="detail-title">
          <h2>{song ? 'Editar cifrado' : 'Subir cifrado'}</h2>
          <span>Toda la banda verá los cambios al instante.</span>
        </div>
        <button className="cta" onClick={() => void save()} disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {err ? <p className="err-text">{err}</p> : null}
      <div className="import-help">
        <div>
          <b>¿La canción ya está en internet?</b>
          <span>Búscala, copia la cifra completa y pégala abajo: la app limpia el formato y detecta el tono.</span>
        </div>
        <div className="row-btns">
          {searchLinks(`${title} ${artist}`.trim() || 'alabanza').map((l) => (
            <a key={l.label} className="ctl small link-btn" href={l.url} target="_blank" rel="noreferrer">
              🔎 {l.label}
            </a>
          ))}
          <button className="ctl small" type="button" onClick={() => applyImport(cleanPastedSheet(sheet), true)} disabled={!sheet.trim()}>
            🧹 Limpiar formato
          </button>
        </div>
      </div>
      {cleaned ? <div className="ok-text small-note">✓ {cleaned}</div> : null}
      <div className="form-grid">
        <label className="field">
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Cuán grande es Él" />
        </label>
        <label className="field">
          Autor / versión
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Ej. Himno · Marcos Witt" />
        </label>
        <label className="field">
          Tono original
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{guessed ? `Auto: ${keyLabel(mk(guessed), notation)}` : 'Auto'}</option>
            {KEYS.map((v) => {
              const [r, sc] = v.split(':');
              return (
                <option key={v} value={v}>
                  {keyLabel({ root: Number(r), scale: sc as 'major' | 'minor', confidence: 1 }, notation)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          BPM (opcional)
          <input inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/\D/g, ''))} placeholder="72" />
        </label>
      </div>
      <label className="field">
        Cifrado (acordes encima de la letra, o formato [Sol]letra) · {chordCount} acordes detectados
        <textarea
          className="cifra-input"
          value={sheet}
          onChange={(e) => setSheet(e.target.value)}
          onPaste={(e) => {
            // Pegado inteligente: si el campo está vacío, limpiar lo que viene de LaCuerda / Cifra Club
            if (sheet.trim()) return;
            const text = e.clipboardData.getData('text/plain');
            if (!text) return;
            e.preventDefault();
            applyImport(/^\s*\{\s*(title|t)\s*:/im.test(text) ? parseChordProFile(text) : cleanPastedSheet(text), false);
          }}
          spellCheck={false}
          placeholder={'[Intro] G  D  Em  C\n\nG                D/F#\nCuán grande es Él\n    Em            C\nque mi alma canta…'}
        />
      </label>
      <label className="field">
        Notas para la banda (opcional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Entra solo piano · coro x2 al final" />
      </label>
    </div>
  );
}
