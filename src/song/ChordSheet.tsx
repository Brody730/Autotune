import { useEffect, useMemo, useState } from 'react';
import { MusicalKey, Notation, keyLabel } from '../audio/music';
import { chordToString, inferSheetKey, parseSheet, SheetLine } from './chords';
import { cleanTitle, normalize } from './text';
import { store } from '../lib/store';

// ── Almacenamiento local de cifrados (repertorio) ─────────────────────────

export interface StoredSheet {
  text: string;
  /** Tono original indicado a mano (si no, se estima de los acordes). */
  key: { root: number; scale: 'major' | 'minor' } | null;
  title: string;
  artist: string;
  updated: number;
}

export const sheetKeyFor = (title: string) => normalize(cleanTitle(title) || title);

/** El cifrado vive en el registro de la canción (store), que se sincroniza con la cuenta. */
export function loadSheet(title: string): StoredSheet | null {
  const s = store.song(sheetKeyFor(title));
  if (!s?.sheet) return null;
  return { text: s.sheet, key: s.origKey, title: s.title, artist: s.artist, updated: s.updated };
}

export function saveSheet(s: StoredSheet | null, title: string, artist = '') {
  store.upsertSong(sheetKeyFor(title), title, s?.artist ?? artist, { sheet: s?.text ?? null, origKey: s?.key ?? null });
}

// ── Editor ────────────────────────────────────────────────────────────────

const KEY_OPTIONS: { v: string; label: string }[] = [];
for (const scale of ['major', 'minor'] as const) {
  for (let r = 0; r < 12; r++) KEY_OPTIONS.push({ v: `${r}:${scale}`, label: '' });
}

export function SheetEditor({
  title,
  artist,
  notation,
  onClose,
  onSaved,
}: {
  title: string;
  artist: string;
  notation: Notation;
  onClose(): void;
  onSaved(s: StoredSheet | null): void;
}) {
  const existing = useMemo(() => loadSheet(title), [title]);
  const [text, setText] = useState(existing?.text ?? '');
  const [manualKey, setManualKey] = useState(existing?.key ? `${existing.key.root}:${existing.key.scale}` : '');

  const parsed = useMemo(() => parseSheet(text), [text]);
  const chordCount = parsed.reduce((n, l) => n + l.chords.length, 0);
  const guessed = useMemo(() => inferSheetKey(parsed), [parsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!text.trim()) {
      saveSheet(null, title);
      onSaved(null);
      return;
    }
    const [r, sc] = manualKey.split(':');
    const s: StoredSheet = {
      text,
      key: manualKey ? { root: Number(r), scale: sc as 'major' | 'minor' } : null,
      title,
      artist,
      updated: Date.now(),
    };
    saveSheet(s, title);
    onSaved(s);
  };

  const q = encodeURIComponent(`acordes ${cleanTitle(title)} ${artist}`);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet-editor" onClick={(e) => e.stopPropagation()}>
        <div className="se-head">
          <div>
            <div className="eyebrow">Cifrado original</div>
            <div className="se-title">{title}</div>
          </div>
          <button className="ctl icon" onClick={onClose} title="Cerrar">
            ✕
          </button>
        </div>
        <p className="se-help">
          Pega los acordes de la canción <b>en su tono original</b> (acordes encima de la letra, o formato
          <code>[Sol]letra</code>). La app los transporta al tono en que se está cantando. Se guarda en este
          navegador para la próxima vez.{' '}
          <a href={`https://www.google.com/search?q=${q}`} target="_blank" rel="noreferrer">
            Buscar cifrado ↗
          </a>
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={'La                 Mi\nTu voz me llama a las aguas\n        Fa#m          Re\nDonde mis pies pueden fallar'}
        />
        <div className="se-foot">
          <span className="muted-text">
            {chordCount ? `${chordCount} acordes · ${parsed.length} líneas` : 'Sin acordes detectados'}
          </span>
          <label>
            Tono original
            <select value={manualKey} onChange={(e) => setManualKey(e.target.value)}>
              <option value="">{guessed ? `Auto: ${keyLabel(guessed, notation)}` : 'Auto'}</option>
              {KEY_OPTIONS.map((o) => {
                const [r, sc] = o.v.split(':');
                return (
                  <option key={o.v} value={o.v}>
                    {keyLabel({ root: Number(r), scale: sc as 'major' | 'minor', confidence: 1 }, notation)}
                  </option>
                );
              })}
            </select>
          </label>
          {existing ? (
            <button
              className="ctl"
              onClick={() => {
                saveSheet(null, title);
                onSaved(null);
              }}
            >
              Borrar
            </button>
          ) : null}
          <button className="cta" onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Línea con acordes encima ──────────────────────────────────────────────

export interface Transpose {
  shift: number;
  notation: Notation;
  flats: boolean;
}

export function ChordLyric({ line, t, className }: { line: SheetLine; t: Transpose; className?: string }) {
  const name = (i: number) => chordToString(line.chords[i].chord, t.shift, t.notation, t.flats);
  if (!line.lyric.trim()) {
    return (
      <div className={`cl instrumental ${className ?? ''}`}>
        {line.chords.map((_, i) => (
          <span key={i} className="cl-chord solo">
            {name(i)}
          </span>
        ))}
      </div>
    );
  }
  // Partir la letra en segmentos que empiezan en cada acorde
  const segs: { chord: string | null; text: string }[] = [];
  const first = line.chords[0]?.pos ?? line.lyric.length;
  if (first > 0) segs.push({ chord: null, text: line.lyric.slice(0, first) });
  line.chords.forEach((c, i) => {
    const end = line.chords[i + 1]?.pos ?? Math.max(line.lyric.length, c.pos);
    const text = line.lyric.slice(c.pos, end);
    segs.push({ chord: name(i), text: text || ' ' });
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

export function keyName(k: MusicalKey | null, notation: Notation) {
  return k ? keyLabel(k, notation) : '—';
}
