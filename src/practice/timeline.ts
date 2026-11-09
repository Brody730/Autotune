import { Notation, pcName } from '../audio/music';
import { Chord, chordToString, parseSheet } from '../song/chords';
import { Drum, Style } from './styles';

/**
 * Convierte un cifrado + un estilo en una línea de tiempo tocable:
 * acordes (en pulsos), notas de bajo esperadas (con cuerda y traste) y los
 * golpes del acompañamiento. Como el cifrado no dice cuánto dura cada
 * acorde, se usa «compases por acorde» (ajustable).
 */

export interface TLChord {
  startBeat: number;
  endBeat: number;
  chord: Chord;
  name: string;
  /** Notas del acorde ya transportadas (clases de altura 0-11). */
  tones: number[];
  /** Línea de la letra donde está este acorde y su posición dentro de ella. */
  lineIdx: number;
  posInLine: number;
}

/** Línea de letra con sus acordes (ya transportados), para mostrarla tipo karaoke. */
export interface TLLine {
  lyric: string;
  chords: { pos: number; name: string }[];
}

export interface TLBass {
  beat: number;
  len: number;
  midi: number;
  name: string;
  chordIdx: number;
  /** 0 = Mi (grave), 1 = La, 2 = Re, 3 = Sol */
  string: number;
  fret: number;
}

export interface TLHit {
  beat: number;
  drum?: Drum;
  chord?: 'stab' | 'pad';
  vel: number;
  chordIdx: number;
}

export interface Timeline {
  bpm: number;
  shift: number;
  beatSec: number;
  beatsPerBar: number;
  countInBeats: number;
  totalBeats: number;
  chords: TLChord[];
  lines: TLLine[];
  bass: TLBass[];
  hits: TLHit[];
}

export const BASS_STRINGS = [28, 33, 38, 43]; // E1 A1 D2 G2
export const STRING_NAMES = ['Mi', 'La', 'Re', 'Sol'];

function chordTones(c: Chord, shift: number): number[] {
  const r = (((c.root + shift) % 12) + 12) % 12;
  const t = [r, (r + (c.minor ? 3 : 4)) % 12, (r + (/dim|°|º|b5/.test(c.suffix) ? 6 : 7)) % 12];
  if (/maj7|M7/.test(c.suffix)) t.push((r + 11) % 12);
  else if (/7/.test(c.suffix)) t.push((r + 10) % 12);
  return t;
}

/** Lista de acordes en el orden del cifrado. */
export function progressionOf(sheet: string): Chord[] {
  return parseSheet(sheet).flatMap((l) => l.chords.map((c) => c.chord));
}

function bassMidi(c: Chord, degree: string, shift: number): number {
  const rootPc = (((c.bass ?? c.root) + shift) % 12 + 12) % 12;
  const root = 28 + ((rootPc - 4 + 12) % 12); // entre Mi1 y Re#2
  const chordRoot = 28 + ((((c.root + shift) % 12 + 12) % 12 - 4 + 12) % 12);
  switch (degree) {
    case 'fifth':
      return chordRoot + 7;
    case 'fifthLow':
      return chordRoot - 5 >= 28 ? chordRoot - 5 : chordRoot + 7;
    case 'octave':
      return root + 12;
    case 'third':
      return chordRoot + (c.minor ? 3 : 4);
    default:
      return root;
  }
}

/** Cuerda y traste más cómodos, cerca de la posición anterior. */
export function fretFor(midi: number, prevFret: number): { string: number; fret: number } {
  let best = { string: 0, fret: midi - 28 };
  let bestCost = Infinity;
  BASS_STRINGS.forEach((open, s) => {
    const fret = midi - open;
    if (fret < 0 || fret > 15) return;
    const cost = Math.abs(fret - prevFret) + (fret > 7 ? 2 : 0) + (fret === 0 ? -0.5 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = { string: s, fret };
    }
  });
  return best;
}

export function buildTimeline(opts: {
  sheet: string;
  style: Style;
  bpm: number;
  shift: number;
  barsPerChord: number;
  notation: Notation;
  flats: boolean;
  /** Limitar a los primeros N acordes (0 = todos). */
  maxChords?: number;
}): Timeline {
  const { style, bpm, shift, barsPerChord, notation, flats } = opts;
  // Cada acorde recuerda en qué línea de la letra (y en qué posición) está
  const sheetLines = parseSheet(opts.sheet).filter((l) => l.chords.length > 0);
  let prog = sheetLines.flatMap((l, lineIdx) => l.chords.map((c, posInLine) => ({ chord: c.chord, lineIdx, posInLine })));
  if (opts.maxChords) prog = prog.slice(0, opts.maxChords);
  const bpb = style.beatsPerBar;
  const chordBeats = Math.max(1, bpb * barsPerChord);

  const lines: TLLine[] = sheetLines.map((l) => ({
    lyric: l.lyric.replace(/\[[^\]]+\]/g, ''),
    chords: l.chords.map((c) => ({ pos: c.pos, name: chordToString(c.chord, shift, notation, flats) })),
  }));

  const chords: TLChord[] = prog.map(({ chord, lineIdx, posInLine }, i) => ({
    startBeat: i * chordBeats,
    endBeat: (i + 1) * chordBeats,
    chord,
    name: chordToString(chord, shift, notation, flats),
    tones: chordTones(chord, shift),
    lineIdx,
    posInLine,
  }));
  const totalBeats = chords.length * chordBeats;
  const chordAt = (beat: number) => Math.min(chords.length - 1, Math.floor(beat / chordBeats));

  // Batería y acordes: el compás se repite
  const hits: TLHit[] = [];
  for (let bar = 0; bar * bpb < totalBeats; bar++) {
    for (const h of style.hits) {
      const beat = bar * bpb + h.beat;
      if (beat >= totalBeats) continue;
      hits.push({ beat, drum: h.drum, chord: h.chord, vel: h.vel ?? 0.7, chordIdx: chordAt(beat) });
    }
  }
  // Pad sostenido: también al cambiar de acorde a mitad de compás
  if (style.hits.some((h) => h.chord === 'pad') && chordBeats < bpb) {
    chords.forEach((c, i) => {
      if (c.startBeat % bpb !== 0) hits.push({ beat: c.startBeat, chord: 'pad', vel: 0.7, chordIdx: i });
    });
  }

  // Bajo: patrón de 1 o 2 compases
  const bass: TLBass[] = [];
  const patternBeats = bpb * style.bars;
  let prevFret = 3;
  for (let start = 0; start < totalBeats; start += patternBeats) {
    for (const b of style.bass) {
      const beat = start + b.beat;
      if (beat >= totalBeats) continue;
      const idx = chordAt(beat);
      // Cuando el acorde acaba de cambiar, empezar por la primera (no por la quinta)
      const freshChord = beat === chords[idx].startBeat && idx > 0;
      const degree = freshChord && b.degree !== 'root' ? 'root' : b.degree;
      const midi = bassMidi(chords[idx].chord, degree, shift);
      const pos = fretFor(midi, prevFret);
      prevFret = pos.fret || prevFret;
      bass.push({ beat, len: b.len, midi, name: pcName(midi, notation, flats), chordIdx: idx, ...pos });
    }
  }
  bass.sort((a, b) => a.beat - b.beat);

  return {
    bpm,
    shift,
    beatSec: 60 / bpm,
    beatsPerBar: bpb,
    countInBeats: bpb === 2 ? 4 : bpb,
    totalBeats,
    chords,
    lines,
    bass,
    hits: hits.sort((a, b) => a.beat - b.beat),
  };
}
