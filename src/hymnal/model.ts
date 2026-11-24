import { Notation } from '../audio/music';
import { chordToString, normalizeSheetText, parseSheet, SheetChord, SheetLine } from '../song/chords';
import { normalize } from '../song/text';
import type { KeyRef } from '../lib/store';

/**
 * Himnario: modelo de un himno y "simplificación" para músicos.
 *
 * El texto de cada himno es un cifrado normal (acordes encima de la letra o
 * ChordPro [Sol]) dividido en secciones con encabezados «[Estrofa 1]»,
 * «[Coro]», o estrofas numeradas «1. …» como en el himnario impreso.
 */

export const HYMN_COUNT = 329;

export interface Hymn {
  num: number;
  title: string;
  /** Tono original (si no, se estima de los acordes). */
  key: KeyRef | null;
  bpm: number | null;
  /** Velocidad de desplazamiento guardada para este himno (px/s). */
  scroll: number | null;
  text: string;
  updated: number;
}

export type SectionKind = 'verse' | 'chorus' | 'other';

export interface Section {
  label: string;
  kind: SectionKind;
  lines: SheetLine[];
}

/** Lo que se pinta: una sección completa o una referencia «↻ Coro ×2». */
export type Block =
  | {
      type: 'section';
      section: Section;
      /** Esta estrofa usa los mismos acordes que otra (se omiten en modo simple). */
      sameChordsAs: string | null;
      /** Acordes heredados (proyectados desde la estrofa base) cuando la estrofa no trae los suyos. */
      inherited: boolean;
    }
  | { type: 'repeat'; label: string; times: number };

// ── Secciones ───────────────────────────────────────────────────────────────

const HEADER_RE =
  /^\s*[[(]?\s*((?:estrofa|verso|coro|estribillo|pre-?coro|puente|final|intro|interludio|instrumental|chorus|verse|bridge)(?:\s*\d+)?)\s*[\])]?\s*:?\s*$/i;
const BRACKET_RE = /^\s*\[([^\]]+)\]\s*:?\s*$/;
/** «Tono: Sol», «BPM: 90», «Capo 2»… no son parte de la letra. */
const META_RE = /^\s*(tono|tom|tonalidad|key|bpm|tempo|capo(traste)?|cejilla|comp[aá]s)\b\s*[:=]?\s*\S*\s*$/i;
const NUMBERED_RE = /^\s*(\d{1,2})[.)]\s+(.*)$/;

function kindOf(label: string): SectionKind {
  const l = normalize(label);
  if (/^(coro|estribillo|chorus)/.test(l)) return 'chorus';
  if (/^(estrofa|verso|verse)/.test(l)) return 'verse';
  return 'other';
}

function prettyLabel(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Divide el texto en secciones con etiqueta. */
export function splitSections(text: string): Section[] {
  const raw = normalizeSheetText(text).split('\n');
  const blocks: { label: string | null; lines: string[] }[] = [];
  let cur: { label: string | null; lines: string[] } | null = null;
  const open = (label: string | null) => {
    cur = { label, lines: [] };
    blocks.push(cur);
  };

  for (const line of raw) {
    if (META_RE.test(line)) continue;
    const h = HEADER_RE.exec(line);
    const b = !h ? BRACKET_RE.exec(line) : null;
    if (h || (b && !parseSheet(`[${b[1]}]x`).some((l) => l.chords.length))) {
      open(prettyLabel((h ? h[1] : b![1]).trim()));
      continue;
    }
    const n = NUMBERED_RE.exec(line);
    if (n) {
      open(`Estrofa ${Number(n[1])}`);
      // conservar las columnas para que la línea de acordes de arriba siga alineada
      cur!.lines.push(' '.repeat(line.length - n[2].length) + n[2]);
      continue;
    }
    if (!line.trim()) {
      // una línea en blanco cierra un bloque sin etiqueta
      if (cur && (cur as { lines: string[] }).lines.length) cur = null;
      continue;
    }
    if (!cur) open(null);
    cur!.lines.push(line);
  }

  // Los bloques con etiqueta numerada heredan la línea de acordes que
  // quedó colgando en el bloque anterior («Sol  Re» encima de «1. Letra»).
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const last = prev.lines[prev.lines.length - 1];
    if (last && /^Estrofa \d+$/.test(blocks[i].label ?? '') && parseSheet(last).every((l) => !l.lyric && l.chords.length)) {
      prev.lines.pop();
      blocks[i].lines.unshift(last);
    }
  }

  for (let i = blocks.length - 1; i >= 0; i--) if (!blocks[i].lines.some((l) => l.trim())) blocks.splice(i, 1);

  // Sin etiqueta: el bloque que aparece repetido es el coro; el resto, estrofas.
  const sig = (b: { lines: string[] }) => normalize(parseSheet(b.lines.join('\n')).map((l) => l.lyric).join(' '));
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(sig(b), (counts.get(sig(b)) ?? 0) + 1);
  let verseN = 0;
  for (const b of blocks) {
    if (b.label) {
      const m = /^Estrofa (\d+)$/.exec(b.label);
      if (m) verseN = Math.max(verseN, Number(m[1]));
      continue;
    }
    if ((counts.get(sig(b)) ?? 0) > 1 && sig(b)) b.label = 'Coro';
    else b.label = `Estrofa ${++verseN}`;
  }

  // Quitar la sangría común de cada bloque (las estrofas numeradas «1.» la dejan)
  const dedent = (lines: string[]) => {
    const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
    return Number.isFinite(ind) && ind > 0 ? lines.map((l) => l.slice(ind)) : lines;
  };
  return blocks
    .map((b) => ({ label: b.label!, kind: kindOf(b.label!), lines: parseSheet(dedent(b.lines).join('\n')) }))
    .filter((s) => s.lines.length);
}

// ── Simplificar ─────────────────────────────────────────────────────────────

const lyricSig = (s: Section) => normalize(s.lines.map((l) => l.lyric).join(' '));
const chordSig = (s: Section) =>
  s.lines.map((l) => l.chords.map((c) => `${c.chord.root}${c.chord.suffix}/${c.chord.bass ?? ''}`).join(' ')).join('|');
const hasChords = (s: Section) => s.lines.some((l) => l.chords.length);

/**
 * Proyecta los acordes de una línea base sobre otra línea con la misma
 * melodía (otra estrofa): cada acorde cae en la palabra con el mismo índice.
 */
export function projectChords(base: SheetLine, target: SheetLine): SheetLine {
  if (!target.lyric.trim()) return { ...target, chords: base.chords };
  const starts = (s: string) => {
    const out: number[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push(m.index);
    return out;
  };
  const bw = starts(base.lyric);
  const tw = starts(target.lyric);
  if (!bw.length || !tw.length) return { ...target, chords: base.chords };
  const chords: SheetChord[] = base.chords.map((c) => {
    // palabra de la base donde cae el acorde
    let wi = 0;
    while (wi + 1 < bw.length && bw[wi + 1] <= c.pos) wi++;
    const ratio = bw.length > 1 ? wi / (bw.length - 1) : 0;
    const ti = Math.min(tw.length - 1, Math.round(ratio * (tw.length - 1)));
    return { pos: c.pos >= base.lyric.length ? target.lyric.length : tw[ti], chord: c.chord };
  });
  return { ...target, chords };
}

export interface SimplifyOptions {
  /** Coros repetidos como «↻ Coro» en lugar de volver a escribirlos. */
  collapseChorus: boolean;
  /** Estrofas con la misma progresión: acordes solo en la primera. */
  shareVerseChords: boolean;
}

export interface Simplified {
  blocks: Block[];
  /** Cuántas líneas se ahorraron frente al texto completo. */
  savedLines: number;
  notes: string[];
}

export function simplify(sections: Section[], o: SimplifyOptions): Simplified {
  const blocks: Block[] = [];
  const notes: string[] = [];
  const seen = new Map<string, string>(); // firma de letra → etiqueta
  let savedLines = 0;
  let baseVerse: Section | null = null;
  const sameAs: string[] = [];

  for (const s of sections) {
    const ls = lyricSig(s);
    const prevLabel = ls ? seen.get(ls) : undefined;
    if (prevLabel && o.collapseChorus) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'repeat' && last.label === prevLabel) last.times++;
      else if (last?.type === 'section' && last.section.label === prevLabel) blocks.push({ type: 'repeat', label: prevLabel, times: 1 });
      else blocks.push({ type: 'repeat', label: prevLabel, times: 1 });
      savedLines += s.lines.length - 1;
      continue;
    }
    if (ls && !seen.has(ls)) seen.set(ls, s.label);

    if (s.kind === 'verse' || s.kind === 'other') {
      if (s.kind === 'verse' && !baseVerse && hasChords(s)) baseVerse = s;
      else if (s.kind === 'verse' && baseVerse && s !== baseVerse) {
        const lyricLines = (x: Section) => x.lines.filter((l) => l.lyric.trim());
        const compatible = lyricLines(s).length === lyricLines(baseVerse).length;
        const noChords = !hasChords(s);
        const same = hasChords(s) && chordSig(s) === chordSig(baseVerse);
        if (compatible && (noChords || same)) {
          sameAs.push(s.label);
          if (o.shareVerseChords) {
            const lyricOnly: Section = { ...s, lines: s.lines.filter((l) => l.lyric.trim()).map((l) => ({ ...l, chords: [] })) };
            savedLines += s.lines.filter((l) => !l.lyric.trim()).length;
            blocks.push({ type: 'section', section: lyricOnly, sameChordsAs: baseVerse.label, inherited: false });
          } else {
            const base: Section = baseVerse;
            const bl = lyricLines(base);
            const projected: Section = noChords ? { ...s, lines: lyricLines(s).map((l, i) => projectChords(bl[i], l)) } : s;
            blocks.push({ type: 'section', section: projected, sameChordsAs: null, inherited: noChords });
          }
          continue;
        }
      }
    }
    blocks.push({ type: 'section', section: s, sameChordsAs: null, inherited: false });
  }

  if (sameAs.length && baseVerse) notes.push(`${sameAs.join(', ')} usan los acordes de ${baseVerse.label}`);
  const reps = blocks.filter((b): b is Extract<Block, { type: 'repeat' }> => b.type === 'repeat');
  if (reps.length) {
    const total = reps.reduce((n, r) => n + r.times, 0);
    notes.push(`${reps[0].label} se repite ${total} ${total === 1 ? 'vez' : 'veces'} (escrito una sola vez)`);
  }
  return { blocks, savedLines, notes };
}

/** Acordes distintos del himno, en orden de aparición (para el resumen del músico). */
export function chordPalette(sections: Section[], shift: number, notation: Notation, flats: boolean): string[] {
  const out: string[] = [];
  for (const s of sections)
    for (const l of s.lines)
      for (const c of l.chords) {
        const n = chordToString(c.chord, shift, notation, flats);
        if (!out.includes(n)) out.push(n);
      }
  return out;
}

/** Texto plano para buscar (título + letra, sin acentos). */
export function searchText(h: Hymn): string {
  const lyric = parseSheet(h.text)
    .map((l) => l.lyric)
    .join(' ');
  return normalize(`${h.num} ${h.title} ${lyric}`);
}

/**
 * Texto completo para el escenario de AutoTune: coros repetidos escritos
 * de nuevo y acordes proyectados en todas las estrofas (formato [Acorde]),
 * para que la letra que sigue al cantante muestre acordes en cada línea.
 */
export function expandForStage(text: string): string {
  const { blocks } = simplify(splitSections(text), { collapseChorus: false, shareVerseChords: false });
  return blocks
    .filter((b): b is Extract<Block, { type: 'section' }> => b.type === 'section')
    .map((b) => {
      const lines = b.section.lines.map((l) => {
        let out = l.lyric;
        const sorted = [...l.chords].sort((a, c) => c.pos - a.pos);
        for (const c of sorted) {
          const pos = Math.min(c.pos, out.length);
          out = out.slice(0, pos) + `[${chordToString(c.chord, 0, 'english', false)}]` + out.slice(pos);
        }
        return out.trim();
      });
      return [`[${b.section.label}]`, ...lines].join('\n');
    })
    .join('\n\n');
}
