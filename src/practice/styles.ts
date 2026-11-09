/**
 * Estilos de acompañamiento para el modo práctica.
 * Cada estilo define un compás: golpes de batería, "pam" de acordes y la
 * línea de bajo (qué grado del acorde y en qué tiempo). Los tiempos van en
 * pulsos (beats) desde el inicio del compás; `bars` permite patrones de 2
 * compases (p. ej. norteña: primera y quinta alternadas).
 */

export type Drum = 'kick' | 'snare' | 'hat' | 'guiro' | 'rim' | 'clap';
export type Degree = 'root' | 'fifth' | 'fifthLow' | 'octave' | 'third';

export interface StyleHit {
  beat: number;
  drum?: Drum;
  /** Acorde: «pam» corto (stab) o sostenido (pad). */
  chord?: 'stab' | 'pad';
  vel?: number;
}

export interface BassNote {
  /** Pulso dentro del patrón (puede pasar de beatsPerBar si bars = 2). */
  beat: number;
  degree: Degree;
  /** Duración en pulsos. */
  len: number;
}

export interface Style {
  id: string;
  name: string;
  emoji: string;
  beatsPerBar: number;
  defaultBpm: number;
  /** Sonido de los acordes. */
  timbre: 'acordeon' | 'guitarra' | 'piano' | 'organo';
  bars: 1 | 2;
  hits: StyleHit[]; // un compás (se repite)
  bass: BassNote[]; // patrón de `bars` compases
  tip: string;
}

const each = (beats: number[], h: Omit<StyleHit, 'beat'>): StyleHit[] => beats.map((beat) => ({ beat, ...h }));

export const STYLES: Style[] = [
  {
    id: 'nortena',
    name: 'Norteña (polka)',
    emoji: '🪗',
    beatsPerBar: 2,
    defaultBpm: 108,
    timbre: 'acordeon',
    bars: 2,
    hits: [...each([0, 1], { drum: 'kick', vel: 0.9 }), ...each([0.5, 1.5], { drum: 'snare', vel: 0.55 }), ...each([0.5, 1.5], { chord: 'stab' })],
    // primera y quinta (abajo), como el tololoche / bajo sexto
    bass: [
      { beat: 0, degree: 'root', len: 0.5 },
      { beat: 1, degree: 'fifthLow', len: 0.5 },
      { beat: 2, degree: 'root', len: 0.5 },
      { beat: 3, degree: 'fifthLow', len: 0.5 },
    ],
    tip: 'Primera en el 1 y quinta (abajo) en el 2; el acordeón marca el contratiempo.',
  },
  {
    id: 'vals',
    name: 'Vals norteño / ranchera',
    emoji: '🤠',
    beatsPerBar: 3,
    defaultBpm: 140,
    timbre: 'acordeon',
    bars: 2,
    hits: [{ beat: 0, drum: 'kick', vel: 0.9 }, ...each([1, 2], { drum: 'snare', vel: 0.45 }), ...each([1, 2], { chord: 'stab' })],
    bass: [
      { beat: 0, degree: 'root', len: 1 },
      { beat: 3, degree: 'fifthLow', len: 1 },
    ],
    tip: 'Bajo solo en el 1: primera un compás, quinta el siguiente. Los acordes en 2 y 3.',
  },
  {
    id: 'cumbia',
    name: 'Cumbia',
    emoji: '💃',
    beatsPerBar: 2,
    defaultBpm: 96,
    timbre: 'piano',
    bars: 1,
    hits: [
      ...each([0, 1], { drum: 'kick', vel: 0.8 }),
      ...each([0.5, 1.5], { drum: 'rim', vel: 0.5 }),
      ...each([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75], { drum: 'guiro', vel: 0.35 }),
      ...each([0.5, 1.5], { chord: 'stab' }),
    ],
    bass: [
      { beat: 0, degree: 'root', len: 0.75 },
      { beat: 0.75, degree: 'fifth', len: 0.25 },
      { beat: 1, degree: 'fifth', len: 1 },
    ],
    tip: 'Primera en el 1, quinta en el 2 (con anticipación). El güiro lleva el paso.',
  },
  {
    id: 'rock',
    name: 'Rock',
    emoji: '🤘',
    beatsPerBar: 4,
    defaultBpm: 116,
    timbre: 'guitarra',
    bars: 1,
    hits: [
      ...each([0, 2.5], { drum: 'kick', vel: 0.95 }),
      ...each([1, 3], { drum: 'snare', vel: 0.85 }),
      ...each([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], { drum: 'hat', vel: 0.35 }),
      ...each([0, 2], { chord: 'stab' }),
    ],
    bass: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat) => ({ beat, degree: 'root' as Degree, len: 0.5 })),
    tip: 'Corcheas en la primera del acorde, firmes y parejas con el bombo.',
  },
  {
    id: 'balada',
    name: 'Balada',
    emoji: '🕯',
    beatsPerBar: 4,
    defaultBpm: 72,
    timbre: 'piano',
    bars: 1,
    hits: [{ beat: 0, drum: 'kick', vel: 0.8 }, { beat: 2, drum: 'snare', vel: 0.6 }, ...each([0, 1, 2, 3], { drum: 'hat', vel: 0.25 }), { beat: 0, chord: 'pad' }],
    bass: [
      { beat: 0, degree: 'root', len: 2 },
      { beat: 2, degree: 'fifth', len: 2 },
    ],
    tip: 'Notas largas: primera en el 1 y quinta en el 3.',
  },
  {
    id: 'alabanza',
    name: 'Alabanza / pop',
    emoji: '🙌',
    beatsPerBar: 4,
    defaultBpm: 78,
    timbre: 'organo',
    bars: 1,
    hits: [
      ...each([0, 2], { drum: 'kick', vel: 0.85 }),
      ...each([1, 3], { drum: 'clap', vel: 0.6 }),
      ...each([0, 1, 2, 3], { drum: 'hat', vel: 0.3 }),
      { beat: 0, chord: 'pad' },
    ],
    bass: [
      { beat: 0, degree: 'root', len: 1.5 },
      { beat: 1.5, degree: 'root', len: 0.5 },
      { beat: 2, degree: 'root', len: 1 },
      { beat: 3, degree: 'fifth', len: 1 },
    ],
    tip: 'Primera con impulso y quinta al final del compás para llevar al siguiente acorde.',
  },
];

export const styleById = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];
