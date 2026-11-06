import { bigrams, tokens } from './text';

export interface LyricLine {
  /** Segundo de inicio (letra sincronizada) o null. */
  t: number | null;
  text: string;
  tokens: string[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  lines: LyricLine[];
  synced: boolean;
  duration: number | null;
  source: 'voz' | 'huella' | 'manual';
  /** Bigramas de toda la letra, para verificar que la canción sigue sonando. */
  bigramSet: Set<string>;
  tokenSet: Set<string>;
  /** Letra original, para guardarla en el repertorio local. */
  raw: { synced: string | null; plain: string | null };
}

const LRC_LINE = /^\s*((?:\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const LRC_TIME = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Convierte LRC ("[01:23.45] texto") en líneas con tiempo. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = LRC_LINE.exec(raw);
    if (!m) continue;
    const text = m[2].trim();
    let tm: RegExpExecArray | null;
    LRC_TIME.lastIndex = 0;
    while ((tm = LRC_TIME.exec(m[1]))) {
      const frac = tm[3] ? Number(`0.${tm[3]}`) : 0;
      out.push({ t: Number(tm[1]) * 60 + Number(tm[2]) + frac, text, tokens: tokens(text) });
    }
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)).filter((l) => l.text.length > 0);
}

export function parsePlain(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ t: null, text: l, tokens: tokens(l) }));
}

export function buildSong(
  meta: { id: string; title: string; artist: string; duration?: number | null; source: Song['source'] },
  synced: string | null,
  plain: string | null,
): Song | null {
  let lines = synced ? parseLrc(synced) : [];
  const isSynced = lines.length > 0;
  if (!isSynced && plain) lines = parsePlain(plain);
  if (lines.length === 0) return null;
  const all = lines.flatMap((l) => l.tokens);
  return {
    ...meta,
    duration: meta.duration ?? null,
    lines,
    synced: isSynced,
    bigramSet: new Set(bigrams(all)),
    tokenSet: new Set(all),
    raw: { synced, plain },
  };
}

/** Índice de la línea activa para un tiempo dado (letra sincronizada). */
export function lineAtTime(song: Song, pos: number): number {
  let idx = -1;
  for (let i = 0; i < song.lines.length; i++) {
    const t = song.lines[i].t;
    if (t !== null && t <= pos + 0.15) idx = i;
    else if (t !== null && t > pos) break;
  }
  return idx;
}
