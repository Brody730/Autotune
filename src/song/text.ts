/** Normaliza texto para comparar letras: minúsculas, sin acentos ni signos. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

export function bigrams(t: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t[i] + ' ' + t[i + 1]);
  return out;
}

/** Quita "(Live)", "[feat. X]", " - Remastered" etc. de un título. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .trim();
}
