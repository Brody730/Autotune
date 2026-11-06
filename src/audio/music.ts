export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SOLFEGE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const SOLFEGE_NAMES_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];

export type Notation = 'latin' | 'english';
export type ScaleType = 'major' | 'minor';

export interface MusicalKey {
  root: number;
  scale: ScaleType;
  /** 0..1 — correlación del perfil ganador (confianza). */
  confidence: number;
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Tonalidades que se escriben con bemoles. */
const FLAT_MAJOR_ROOTS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb
const FLAT_MINOR_ROOTS = new Set([2, 7, 0, 5, 10, 3]); // Dm Gm Cm Fm Bbm Ebm

export function pc(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function pcName(pitchClass: number, notation: Notation, preferFlats = false): string {
  const table =
    notation === 'latin'
      ? preferFlats ? SOLFEGE_NAMES_FLAT : SOLFEGE_NAMES
      : preferFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  return table[((pitchClass % 12) + 12) % 12];
}

export function keyUsesFlats(key: MusicalKey | null): boolean {
  if (!key) return false;
  return key.scale === 'major' ? FLAT_MAJOR_ROOTS.has(key.root) : FLAT_MINOR_ROOTS.has(key.root);
}

export function midiToNoteName(midi: number, notation: Notation = 'english', preferFlats = false) {
  const rounded = Math.round(midi);
  return { name: pcName(rounded, notation, preferFlats), octave: Math.floor(rounded / 12) - 1 };
}

/** Desviación en cents respecto a la nota temperada más cercana (-50..50). */
export function centsOff(midi: number): number {
  return Math.round((midi - Math.round(midi)) * 100);
}

export function keyLabel(key: MusicalKey, notation: Notation): string {
  const name = pcName(key.root, notation, keyUsesFlats(key));
  if (notation === 'latin') return `${name} ${key.scale === 'major' ? 'Mayor' : 'menor'}`;
  return `${name}${key.scale === 'major' ? '' : 'm'}`;
}

// ── Inferencia de tonalidad: Krumhansl-Schmuckler ──────────────────────────

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Infiere la tonalidad a partir de un histograma de clases de altura
 * (12 valores, ponderados por duración). Devuelve null si hay muy poca info.
 */
export function inferKey(histogram: number[]): MusicalKey | null {
  const total = histogram.reduce((s, v) => s + v, 0);
  const distinct = histogram.filter((v) => v > total * 0.03).length;
  if (total <= 0 || distinct < 3) return null;

  let best: MusicalKey | null = null;
  let bestR = -Infinity;
  for (let root = 0; root < 12; root++) {
    const rotated = histogram.map((_, i) => histogram[(i + root) % 12]);
    const rMaj = pearson(rotated, KK_MAJOR);
    const rMin = pearson(rotated, KK_MINOR);
    if (rMaj > bestR) {
      bestR = rMaj;
      best = { root, scale: 'major', confidence: 0 };
    }
    if (rMin > bestR) {
      bestR = rMin;
      best = { root, scale: 'minor', confidence: 0 };
    }
  }
  if (!best) return null;
  best.confidence = Math.max(0, Math.min(1, bestR));
  return best;
}

// ── Campo armónico ─────────────────────────────────────────────────────────

export type ChordQuality = 'maj' | 'min' | 'dim';

export interface DiatonicChord {
  degree: number; // 0..6
  roman: string;
  root: number; // pitch class
  quality: ChordQuality;
  tones: number[];
  /** Acordes principales para acompañar (I, IV, V, vi en mayor). */
  primary: boolean;
}

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function diatonicChords(key: MusicalKey): DiatonicChord[] {
  const scale = key.scale === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const primaryDegrees = key.scale === 'major' ? [0, 3, 4, 5] : [0, 2, 3, 4, 5, 6];
  return scale.map((_, degree) => {
    const root = (key.root + scale[degree]) % 12;
    const third = (key.root + scale[(degree + 2) % 7]) % 12;
    const fifth = (key.root + scale[(degree + 4) % 7]) % 12;
    let quality: ChordQuality;
    // En menor usamos V mayor (menor armónica), lo habitual en acompañamiento.
    if (key.scale === 'minor' && degree === 4) {
      const majorThird = (root + 4) % 12;
      return {
        degree,
        roman: 'V',
        root,
        quality: 'maj' as ChordQuality,
        tones: [root, majorThird, fifth],
        primary: true,
      };
    }
    const thirdInt = (third - root + 12) % 12;
    const fifthInt = (fifth - root + 12) % 12;
    if (thirdInt === 4) quality = 'maj';
    else if (fifthInt === 6) quality = 'dim';
    else quality = 'min';
    let roman = ROMANS[degree];
    if (quality !== 'maj') roman = roman.toLowerCase();
    if (quality === 'dim') roman += '°';
    return { degree, roman, root, quality, tones: [root, third, fifth], primary: primaryDegrees.includes(degree) };
  });
}

export function chordName(chord: DiatonicChord, notation: Notation, preferFlats: boolean): string {
  const base = pcName(chord.root, notation, preferFlats);
  return base + (chord.quality === 'min' ? 'm' : chord.quality === 'dim' ? '°' : '');
}

/**
 * Elige el acorde más probable para armonizar la nota cantada:
 * prioriza acordes principales y que la nota sea fundamental > quinta > tercera.
 */
export function suggestChord(chords: DiatonicChord[], notePc: number): DiatonicChord | null {
  let best: DiatonicChord | null = null;
  let bestScore = -Infinity;
  for (const c of chords) {
    const idx = c.tones.indexOf(notePc);
    if (idx < 0) continue;
    let score = [3, 1.5, 2][idx]; // fundamental, tercera, quinta
    if (c.primary) score += 2;
    if (c.degree === 0) score += 1;
    if (c.quality === 'dim') score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
