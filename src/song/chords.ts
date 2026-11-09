import { inferKey, keyUsesFlats, MusicalKey, Notation, pcName } from '../audio/music';
import { tokens } from './text';

/**
 * Cifrados: parseo de "acordes encima de la letra" (LaCuerda, Cifraclub,
 * Ultimate Guitar) y ChordPro "[G]letra", en notación americana o latina.
 * Transposición al tono que se está cantando.
 */

const ROOTS: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
  do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11,
};

// raíz + alteración + sufijo + bajo opcional
const CHORD_RE =
  /^(do|re|mi|fa|sol|la|si|[a-g])([#b♯♭]?)((?:maj|min|m|M|dim|aug|sus|add|º|°|ø|\+|-|\d|\(|\)|#|b)*)(?:\/(do|re|mi|fa|sol|la|si|[a-g])([#b♯♭]?))?$/i;

export interface Chord {
  root: number;
  suffix: string;
  bass: number | null;
  minor: boolean;
}

export function parseChord(raw: string): Chord | null {
  const m = CHORD_RE.exec(raw.trim());
  if (!m) return null;
  const rootName = m[1].toLowerCase();
  // La raíz empieza en mayúscula ("a", "mi", "si" sueltas son palabras, no acordes)
  if (m[1][0] !== m[1][0].toUpperCase()) return null;
  const acc = (s: string) => (s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0);
  const root = (ROOTS[rootName] + acc(m[2]) + 12) % 12;
  let suffix = m[3] ?? '';
  suffix = suffix.replace(/^min/, 'm').replace(/^-(?=\d|$)/, 'm');
  const minor = /^m(?!aj)/.test(suffix);
  const bass = m[4] ? (ROOTS[m[4].toLowerCase()] + acc(m[5]) + 12) % 12 : null;
  return { root, suffix, bass, minor };
}

export function chordToString(c: Chord, shift: number, notation: Notation, flats: boolean): string {
  const r = pcName(c.root + shift, notation, flats);
  const b = c.bass !== null ? '/' + pcName(c.bass + shift, notation, flats) : '';
  return r + c.suffix + b;
}

export interface SheetChord {
  /** Posición (carácter) dentro de la línea de letra. */
  pos: number;
  chord: Chord;
}

export interface SheetLine {
  lyric: string;
  tokens: string[];
  chords: SheetChord[];
}

export interface Sheet {
  lines: SheetLine[];
  /** Tono original estimado (o indicado por el usuario). */
  key: MusicalKey | null;
}

const SECTION_RE = /^\s*[[(]?\s*(intro|coro|estrofa|verso|puente|pre-?coro|final|outro|interludio|chorus|verse|bridge|tag|instrumental|solo)\b.*$/i;

function chordTokens(line: string): { pos: number; text: string }[] {
  const out: { pos: number; text: string }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ pos: m.index, text: m[0] });
  return out;
}

function isChordLine(line: string): boolean {
  const toks = chordTokens(line).filter((t) => !/^[|/\-x()\d.:]+$/i.test(t.text));
  if (!toks.length) return false;
  const ok = toks.filter((t) => parseChord(t.text.replace(/[()]/g, ''))).length;
  return ok / toks.length >= 0.7;
}

function parseChordPro(line: string): SheetLine | null {
  if (!/\[[^\]]+\]/.test(line)) return null;
  const chords: SheetChord[] = [];
  let lyric = '';
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(line))) {
    lyric += line.slice(last, m.index);
    const c = parseChord(m[1]);
    if (c) {
      chords.push({ pos: lyric.length, chord: c });
      any = true;
    }
    last = m.index + m[0].length;
  }
  lyric += line.slice(last);
  if (!any) return null;
  return { lyric: lyric.trimEnd(), tokens: tokens(lyric), chords };
}

/** Convierte un cifrado pegado en líneas {letra, acordes con posición}. */
export function parseSheet(text: string): SheetLine[] {
  const raw = text.replace(/\t/g, '    ').split(/\r?\n/);
  const out: SheetLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (!line.trim() || SECTION_RE.test(line) && !isChordLine(line)) continue;
    const cp = parseChordPro(line);
    if (cp) {
      out.push(cp);
      continue;
    }
    if (isChordLine(line)) {
      const chords = chordTokens(line)
        .map((t) => ({ pos: t.pos, chord: parseChord(t.text.replace(/[()]/g, '')) }))
        .filter((c): c is SheetChord => c.chord !== null);
      const next = raw[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next)) {
        out.push({ lyric: next.trimEnd(), tokens: tokens(next), chords });
        i++;
      } else {
        out.push({ lyric: '', tokens: [], chords }); // línea instrumental
      }
      continue;
    }
    out.push({ lyric: line.trimEnd(), tokens: tokens(line), chords: [] });
  }
  return out;
}

/**
 * Tono original: perfil de Krumhansl sobre las notas de los acordes,
 * con peso extra al primer y último acorde (suelen ser la tónica).
 */
export function inferSheetKey(lines: SheetLine[]): MusicalKey | null {
  const all = lines.flatMap((l) => l.chords.map((c) => c.chord));
  if (!all.length) return null;
  const h = new Array(12).fill(0);
  for (const c of all) {
    h[c.root] += 1;
    h[(c.root + (c.minor ? 3 : 4)) % 12] += 0.6;
    h[(c.root + 7) % 12] += 0.6;
  }
  const first = all[0];
  const last = all[all.length - 1];
  h[first.root] += 2;
  h[last.root] += 1.5;
  const k = inferKey(h);
  if (!k) return { root: first.root, scale: first.minor ? 'minor' : 'major', confidence: 0.3 };
  // Si el primer acorde es el relativo de lo inferido, preferir el primer acorde
  const rel = k.scale === 'major' ? (k.root + 9) % 12 : (k.root + 3) % 12;
  if (first.root === rel && first.minor === (k.scale === 'major')) {
    return { root: first.root, scale: first.minor ? 'minor' : 'major', confidence: k.confidence };
  }
  return k;
}

/** Semitonos para pasar del tono original al que se está cantando (-5..+6). */
export function transposeShift(original: MusicalKey, sung: MusicalKey): number {
  // Comparar en el mismo modo: el relativo menor/mayor no es otro tono
  let sungRoot = sung.root;
  if (original.scale !== sung.scale) sungRoot = sung.scale === 'minor' ? (sung.root + 3) % 12 : (sung.root + 9) % 12;
  let d = (sungRoot - original.root + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

export function shiftedKey(k: MusicalKey, shift: number): MusicalKey {
  return { ...k, root: (k.root + shift + 12) % 12 };
}

export function flatsFor(k: MusicalKey | null): boolean {
  return keyUsesFlats(k);
}

/**
 * Empareja cada línea de la letra (LRCLIB) con la línea del cifrado que
 * más se le parece, avanzando en orden (monótono) para respetar la forma.
 */
export function mapLyricsToSheet(lyricTokens: string[][], sheet: SheetLine[]): number[] {
  const map: number[] = [];
  let lastIdx = -1;
  const sim = (a: string[], b: string[]) => {
    if (!a.length || !b.length) return 0;
    const sb = new Set(b);
    const hit = a.filter((w) => sb.has(w)).length;
    return hit / Math.max(a.length, b.length);
  };
  for (const lt of lyricTokens) {
    let best = -1;
    let bestScore = 0.34;
    // buscar adelante; si no, desde el principio (coros repetidos)
    const ranges: [number, number][] = [
      [Math.max(0, lastIdx), sheet.length],
      [0, Math.max(0, lastIdx)],
    ];
    for (const [from, to] of ranges) {
      for (let j = from; j < to; j++) {
        const s = sim(lt, sheet[j].tokens) - (j < lastIdx ? 0.05 : 0);
        if (s > bestScore) {
          bestScore = s;
          best = j;
        }
      }
      if (best >= 0) break;
    }
    map.push(best);
    if (best >= 0) lastIdx = best;
  }
  return map;
}

// ── Transportar un cifrado completo en texto (estilo LaCuerda / Cifraclub) ──

export type SheetRow =
  | { kind: 'chords'; text: string }
  | { kind: 'lyric'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'blank'; text: '' };

/** Cambia cada acorde de una línea de acordes manteniendo las columnas. */
function transposeChordLine(line: string, shift: number, notation: Notation, flats: boolean): string {
  let out = '';
  let cursor = 0;
  for (const t of chordTokens(line)) {
    const bare = t.text.replace(/[()]/g, '');
    const c = parseChord(bare);
    const replaced = c ? t.text.replace(bare, chordToString(c, shift, notation, flats)) : t.text;
    // respetar la columna original; si el acorde nuevo es más largo, empujar con un espacio mínimo
    const target = Math.max(t.pos, out.length + (out.length ? 1 : 0));
    out += ' '.repeat(Math.max(0, target - out.length)) + replaced;
    cursor = t.pos + t.text.length;
  }
  void cursor;
  return out;
}

/**
 * Devuelve el cifrado transportado como filas tipadas (para pintarlo y para
 * descargarlo como texto). Soporta "acordes encima de la letra" y ChordPro.
 */
export function transposeSheetRows(text: string, shift: number, notation: Notation, flats: boolean): SheetRow[] {
  return text
    .replace(/\t/g, '    ')
    .split(/\r?\n/)
    .map((line): SheetRow => {
      if (!line.trim()) return { kind: 'blank', text: '' };
      if (isChordLine(line)) return { kind: 'chords', text: transposeChordLine(line, shift, notation, flats) };
      if (/\[[^\]]+\]/.test(line) && parseChordPro(line)) {
        return {
          kind: 'lyric',
          text: line.replace(/\[([^\]]+)\]/g, (m, inner: string) => {
            const c = parseChord(inner);
            return c ? `[${chordToString(c, shift, notation, flats)}]` : m;
          }),
        };
      }
      if (SECTION_RE.test(line)) return { kind: 'section', text: line.trim() };
      return { kind: 'lyric', text: line };
    });
}

export function transposeSheetText(text: string, shift: number, notation: Notation, flats: boolean): string {
  return transposeSheetRows(text, shift, notation, flats)
    .map((r) => r.text)
    .join('\n');
}

/** Solo la letra (para reconocer la canción por voz aunque no esté en internet). */
export function sheetLyrics(text: string): string {
  return parseSheet(text)
    .map((l) => (l.chords.length && l.lyric ? l.lyric.replace(/\[[^\]]+\]/g, '') : l.lyric))
    .filter((l) => l.trim())
    .join('\n');
}

/** Nota del bajo de un acorde ya transportado (la de después de «/» o la raíz). */
export function bassOf(c: Chord, shift: number, notation: Notation, flats: boolean): string {
  return pcName((c.bass ?? c.root) + shift, notation, flats);
}
