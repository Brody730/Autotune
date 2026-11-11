import { keyUsesFlats, MusicalKey, Notation, pcName } from '../audio/music';
import { LyricLine } from '../song/lyrics';
import { Analysis, ChordSeg, Note } from './api';
import { TrackEdit } from './db';

/**
 * Del análisis del motor al texto que lee un músico: acordes y notas por
 * compás, y un cifrado (acordes sobre la letra si hay letra sincronizada).
 * Los tiempos del análisis son los de la canción original; `edit` los ajusta
 * a la velocidad y el tono con que se está escuchando.
 */

export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function editedKey(an: Analysis, semitones: number): MusicalKey {
  return { root: (((an.key.root + semitones) % 12) + 12) % 12, scale: an.key.scale, confidence: 1 };
}

export function chordLabel(c: ChordSeg, semitones: number, notation: Notation, flats: boolean) {
  return pcName(c.root + semitones, notation, flats) + (c.minor ? 'm' : '');
}

/** Acorde que suena en el segundo `t` (tiempo original). */
export function chordIndexAt(chords: ChordSeg[], t: number): number {
  let lo = 0;
  let hi = chords.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 && t < chords[ans].end + 0.05 ? ans : -1;
}

export interface Bar {
  /** Inicio y fin en tiempo original. */
  a: number;
  b: number;
}

export function barsOf(an: Analysis): Bar[] {
  const beats = an.beats;
  if (beats.length < 4) return [];
  const start = ((an.phase % 4) + 4) % 4;
  const bars: Bar[] = [];
  if (start > 0) bars.push({ a: 0, b: beats[start] });
  for (let i = start; i < beats.length; i += 4) bars.push({ a: beats[i], b: i + 4 < beats.length ? beats[i + 4] : an.duration });
  return bars;
}

export function chordsInBar(an: Analysis, bar: Bar): ChordSeg[] {
  const out: ChordSeg[] = [];
  for (const c of an.chords) {
    if (c.t >= bar.b) break;
    if (Math.min(bar.b, c.end) - Math.max(bar.a, c.t) > 0.2 * (bar.b - bar.a)) {
      const last = out[out.length - 1];
      if (!last || last.root !== c.root || last.minor !== c.minor) out.push(c);
    }
  }
  return out;
}

export const notesInBar = (notes: Note[], bar: Bar) => notes.filter((n) => n.t >= bar.a && n.t < bar.b);

/** Texto completo: acordes, bajo y melodía por compás. */
export function notesText(
  track: { title: string; artist: string; url: string | null; analysis: Analysis },
  notation: Notation,
  edit: TrackEdit,
): string {
  const an = track.analysis;
  const key = editedKey(an, edit.semitones);
  const flats = keyUsesFlats(key);
  const name = (midi: number) => pcName(midi + edit.semitones, notation, flats);
  const scale = notation === 'latin' ? (key.scale === 'major' ? 'mayor' : 'menor') : key.scale;
  const out = [
    track.title + (track.artist ? ` — ${track.artist}` : ''),
    `Tono: ${pcName(key.root, notation, flats)} ${scale} · ${Math.round(an.bpm * edit.speed)} BPM · ${fmtTime(an.duration / edit.speed)}`,
  ];
  if (edit.semitones || edit.speed !== 1) out.push(`(Editada: ${edit.semitones > 0 ? '+' : ''}${edit.semitones} semitonos, velocidad ${Math.round(edit.speed * 100)}%)`);
  if (track.url) out.push(`Fuente: ${track.url}`);
  out.push('', 'Detección automática: úsala como guía y corrige de oído lo que haga falta.', '');

  const bars = barsOf(an);
  const section = (title: string, cell: (b: Bar) => string) => {
    out.push(title, '-'.repeat(title.length));
    for (let i = 0; i < bars.length; i += 4) {
      const row = bars.slice(i, i + 4).map((b) => cell(b) || '·');
      if (row.every((c) => c === '·')) continue;
      out.push(`${fmtTime(bars[i].a / edit.speed).padStart(5)} | ${row.join(' | ')} |`);
    }
    out.push('');
  };
  section('ACORDES (un compás por casilla)', (b) => chordsInBar(an, b).map((c) => chordLabel(c, edit.semitones, notation, flats)).join(' '));
  if (an.bass.length) section('BAJO (notas por compás)', (b) => notesInBar(an.bass, b).map((n) => name(n.midi)).join(' '));
  if (an.melody.length) section('MELODÍA DE LA VOZ (notas por compás)', (b) => notesInBar(an.melody, b).map((n) => name(n.midi)).join(' '));
  return out.join('\n');
}

/**
 * Cifrado en el tono ORIGINAL (la app lo transporta después). Con letra
 * sincronizada: cada acorde se coloca sobre la sílaba donde cae. Sin letra:
 * solo acordes, 4 compases por línea.
 */
export function buildSheet(an: Analysis, lines: LyricLine[] | null): string {
  const flats = keyUsesFlats(editedKey(an, 0));
  const label = (c: ChordSeg) => chordLabel(c, 0, 'english', flats);
  const timed = (lines ?? []).filter((l): l is LyricLine & { t: number } => l.t !== null);

  const chordRows = (from: number, to: number): string[] => {
    const rows: string[] = [];
    let row: string[] = [];
    for (const bar of barsOf(an)) {
      if (bar.a < from - 0.2 || bar.a >= to - 0.2) continue;
      const names = chordsInBar(an, bar).map(label);
      if (names.length) row.push(names.join(' '));
      if (row.length === 4) {
        rows.push(row.join('   '));
        row = [];
      }
    }
    if (row.length) rows.push(row.join('   '));
    return rows;
  };

  if (timed.length < 4) return chordRows(0, an.duration).join('\n');

  const out: string[] = [];
  const intro = chordRows(0, timed[0].t);
  if (intro.length) out.push('Intro', ...intro, '');
  timed.forEach((line, i) => {
    const start = line.t;
    const next = timed[i + 1]?.t ?? an.duration;
    // La línea se canta, como mucho, en ~8 s; el resto es un interludio
    const sungEnd = Math.min(next, start + Math.max(2.5, Math.min(8, line.text.length * 0.18)));
    let chordLine = '';
    const place = (pos: number, name: string) => {
      const at = Math.max(pos, chordLine.length ? chordLine.length + 1 : 0);
      chordLine = chordLine.padEnd(at) + name;
    };
    let prev: ChordSeg | null = null;
    for (const c of an.chords) {
      if (c.end <= start + 0.15 || c.t >= sungEnd) continue;
      if (prev && prev.root === c.root && prev.minor === c.minor) continue;
      prev = c;
      const frac = Math.max(0, (c.t - start) / (sungEnd - start));
      place(Math.round(frac * line.text.length), label(c));
    }
    if (chordLine) out.push(chordLine);
    out.push(line.text);
    if (next - sungEnd > 6) {
      const inter = chordRows(sungEnd, next);
      if (inter.length) out.push('', ...inter, '');
    }
  });
  return out.join('\n');
}
