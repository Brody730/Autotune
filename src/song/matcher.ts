import { LyricLine, Song } from './lyrics';
import { bigrams } from './text';

/**
 * ¿Cuánto del texto escuchado aparece en la letra? 0..1
 * Combina bigramas (orden de palabras) y palabras sueltas.
 */
export function songScore(heard: string[], song: Song): number {
  const t = heard.slice(-30);
  if (t.length < 3) return 0;
  const bg = bigrams(t);
  const biHits = bg.filter((b) => song.bigramSet.has(b)).length / Math.max(1, bg.length);
  const uniHits = t.filter((w) => w.length > 2 && song.tokenSet.has(w)).length /
    Math.max(1, t.filter((w) => w.length > 2).length);
  return 0.7 * biHits + 0.3 * uniHits;
}

/**
 * Alinea las últimas palabras escuchadas con una línea de la letra.
 * Favorece la línea actual y las siguientes (los coros se repiten:
 * sin este sesgo saltaría a la primera aparición).
 */
export function alignLine(
  heard: string[],
  lines: LyricLine[],
  current: number,
): { index: number; score: number } | null {
  const recent = heard.slice(-7);
  if (recent.length < 2) return null;
  const recentBi = bigrams(recent);
  const tail = recent.slice(-4).filter((w) => w.length > 1);

  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const window = [...(lines[i - 1]?.tokens ?? []), ...lines[i].tokens];
    const winBi = new Set(bigrams(window));
    const own = new Set(lines[i].tokens);
    let s = 0;
    recentBi.forEach((b, k) => {
      if (winBi.has(b)) s += 1 + k / recentBi.length; // los más recientes pesan más
    });
    for (const w of tail) if (own.has(w)) s += 0.5;
    if (s === 0) continue;

    if (current >= 0) {
      const d = i - current;
      if (d >= 0 && d <= 3) s += 0.8 * (1 - d / 4);
      else if (d < 0) s -= Math.min(1, 0.15 * -d);
      else s -= Math.min(1, 0.05 * d);
    }
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best >= 0 && bestScore >= 1.8 ? { index: best, score: bestScore } : null;
}
