import { useMemo, useState } from 'react';
import { keyLabel, keyUsesFlats, midiToNoteName, MusicalKey, Notation } from '../audio/music';
import { inferSheetKey, parseSheet } from '../song/chords';
import { ChordLyric, SheetEditor } from '../song/ChordSheet';
import { librarySongs } from '../song/library';
import { sheetKeyFor } from '../song/ChordSheet';
import { KeyRef, SongRecord, store, useStore } from '../lib/store';
import { keyShiftBetween, shiftKeyRef, suggestShift } from '../lib/voice';

const mk = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });

export function noteLabel(midi: number | null, notation: Notation) {
  if (midi === null) return '—';
  const n = midiToNoteName(midi, notation);
  return `${n.name}${n.octave}`;
}

/** Tono base de la canción (original del cifrado, o en el que se cantó). */
export function baseKeyOf(song: SongRecord): KeyRef | null {
  if (song.origKey) return song.origKey;
  if (song.sheet) {
    const k = inferSheetKey(parseSheet(song.sheet));
    if (k) return { root: k.root, scale: k.scale };
  }
  return song.sungKey;
}

/** Cifrado completo transportado (o letra, si no hay cifrado). */
export function SheetView({ song, target, notation }: { song: SongRecord; target: KeyRef | null; notation: Notation }) {
  const base = baseKeyOf(song);
  const lines = useMemo(() => (song.sheet ? parseSheet(song.sheet) : null), [song.sheet]);
  const lyrics = useMemo(
    () => (lines ? null : librarySongs().find((s) => sheetKeyFor(s.title) === song.key)?.lines ?? null),
    [lines, song.key],
  );
  const shift = base && target ? keyShiftBetween(base, target) : 0;
  const flats = keyUsesFlats(target ? mk(target) : base ? mk(base) : null);
  if (lines) {
    return (
      <div className="sheet-view">
        {lines.map((l, i) => (
          <ChordLyric key={i} line={l} t={{ shift, notation, flats }} className="sv-line" />
        ))}
      </div>
    );
  }
  if (lyrics) {
    return (
      <div className="sheet-view plain">
        {lyrics.map((l, i) => (
          <div key={i} className="sv-line">
            {l.text}
          </div>
        ))}
      </div>
    );
  }
  return <div className="empty">Sin letra guardada.</div>;
}

export function SongDetail({ songKey, notation, onBack }: { songKey: string; notation: Notation; onBack(): void }) {
  const song = useStore((d) => d.songs[songKey]);
  const profile = useStore((d) => d.profile);
  const [editing, setEditing] = useState(false);
  if (!song || song.deleted) return <div className="empty">Canción no encontrada.</div>;

  const base = baseKeyOf(song);
  const target = song.myKey ?? base;
  const suggestion =
    base &&
    suggestShift({
      base,
      sungKey: song.sungKey,
      low: song.sungLow,
      high: song.sungHigh,
      vocalLow: profile.vocalLow,
      vocalHigh: profile.vocalHigh,
    });
  const shift = base && target ? keyShiftBetween(base, target) : 0;
  const setShift = (s: number) => {
    if (!base) return;
    const wrapped = ((s + 6 + 120) % 12) - 6 || 0;
    store.upsertSong(song.key, song.title, song.artist, { myKey: shiftKeyRef(base, wrapped === -6 ? 6 : wrapped) });
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="ctl" onClick={onBack}>
          ← Volver
        </button>
        <div className="detail-title">
          <h2>{song.title}</h2>
          <span>{song.artist}</span>
        </div>
        <button className="ctl" onClick={() => setEditing(true)}>
          🎸 {song.sheet ? 'Editar cifrado' : 'Añadir cifrado'}
        </button>
      </div>

      <div className="key-grid">
        <div className="kg">
          <span className="eyebrow">{song.origKey || song.sheet ? 'Tono original' : 'Tono base'}</span>
          <b>{base ? keyLabel(mk(base), notation) : '—'}</b>
        </div>
        <div className="kg">
          <span className="eyebrow">Se cantó en</span>
          <b>{song.sungKey ? keyLabel(mk(song.sungKey), notation) : '—'}</b>
          <small>
            {song.sungLow !== null ? `${noteLabel(song.sungLow, notation)} – ${noteLabel(song.sungHigh, notation)}` : 'rango sin medir'}
          </small>
        </div>
        <div className="kg mine">
          <span className="eyebrow">Mi tono</span>
          <b>{target ? keyLabel(mk(target), notation) : '—'}</b>
          <div className="tr-btns">
            <button onClick={() => setShift(shift - 1)} disabled={!base}>
              −
            </button>
            <button onClick={() => setShift(0)} disabled={!base} className={shift === 0 ? 'on' : ''}>
              original
            </button>
            <button onClick={() => setShift(shift + 1)} disabled={!base}>
              +
            </button>
          </div>
          <small>{shift === 0 ? 'sin transportar' : `${shift > 0 ? '+' : '−'}${Math.abs(shift)} semitonos`}</small>
        </div>
      </div>

      {base ? (
        suggestion !== null && suggestion !== undefined ? (
          <div className="suggest">
            🎯 Para tu voz ({noteLabel(profile.vocalLow, notation)} – {noteLabel(profile.vocalHigh, notation)}) te queda mejor en{' '}
            <b>{keyLabel(mk(shiftKeyRef(base, suggestion)), notation)}</b>
            {suggestion !== shift ? (
              <button className="ctl small" onClick={() => setShift(suggestion)}>
                Usar este tono
              </button>
            ) : (
              <span className="ok"> ✓ ya está</span>
            )}
          </div>
        ) : (
          <div className="suggest dim">
            {profile.vocalLow === null
              ? '🎯 Mide tu rango vocal en «Cuenta» y te sugeriré el mejor tono para tu voz.'
              : '🎯 Para sugerirte un tono necesito haber escuchado esta canción cantada al menos una vez.'}
          </div>
        )
      ) : null}

      <SheetView song={song} target={target} notation={notation} />

      <div className="detail-foot">
        <span className="muted-text">
          Tocada {song.plays} {song.plays === 1 ? 'vez' : 'veces'}
          {song.lastPlayed ? ` · última: ${new Date(song.lastPlayed).toLocaleDateString()}` : ''}
        </span>
        <button
          className="ctl danger"
          onClick={() => {
            if (confirm(`¿Borrar «${song.title}» de tu biblioteca?`)) {
              store.deleteSong(song.key);
              onBack();
            }
          }}
        >
          Borrar
        </button>
      </div>

      {editing ? (
        <SheetEditor
          title={song.title}
          artist={song.artist}
          notation={notation}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
