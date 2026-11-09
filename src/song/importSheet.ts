import { parseChord } from './chords';
import type { KeyRef } from '../lib/store';

/**
 * Importar cifrados que el usuario copia y pega (de LaCuerda, Cifra Club,
 * Ultimate Guitar…) o archivos ChordPro (CCLI SongSelect, OnSong, etc.).
 * No descarga nada de esos sitios: solo limpia lo que la persona pega.
 */

export interface ImportedSheet {
  title: string;
  artist: string;
  key: KeyRef | null;
  bpm: number | null;
  sheet: string;
}

function keyFromName(name: string): KeyRef | null {
  const c = parseChord(name.trim().replace(/\s+/g, ''));
  return c ? { root: c.root, scale: c.minor ? 'minor' : 'major' } : null;
}

// Líneas de "relleno" típicas de los sitios de cifras (es / pt / en)
const JUNK = [
  /^\s*(afinaci[oó]n|afina[cç][aã]o|tuning)\b.*$/i,
  /^\s*(capo(traste)?|cejilla)\b.*$/i,
  /^\s*(composi[cç][aã]o|composici[oó]n|autor(es)?|written by)\b.*$/i,
  /^\s*(cifra club|lacuerda|ultimate guitar|acordes\.lacuerda)\b.*$/i,
  /^\s*(ver tradu[cç][aã]o|imprimir|print|compartir|share|favorit[oa]s?|seguir)\s*$/i,
  /^\s*(simplificar cifra|auto rolagem|mostrar acordes|tamanho|tamaño|exibir|ocultar)\b.*$/i,
  /^\s*(versi[oó]n|vers[aã]o)\s*\d*\s*(de\s+\d+)?\s*$/i,
  /^\s*(publicidad|publicidade|advertisement|anuncio)\s*$/i,
  /^\s*\d+\s*(views|visualiza[cç][oõ]es|visitas)\b.*$/i,
];
// Tablaturas: e|--3--|  B|---  etc.
const TAB_LINE = /^\s*[eBGDAEbgda]\s*[|:].*[-|]{3,}/;

/** Limpia una cifra pegada y extrae tono, título, autor y BPM si aparecen. */
export function cleanPastedSheet(raw: string): ImportedSheet {
  let key: KeyRef | null = null;
  let bpm: number | null = null;
  let title = '';
  let artist = '';
  const out: string[] = [];

  const lines = raw
    .replace(/ /g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));

  for (const line of lines) {
    const t = line.trim();
    // Tono: «Tom: G», «Tono: Sol», «Key: D», «Tonalidad: Mi»
    const km = /^(tom|tono|tonalidad|key)\s*[:=]\s*(\S+)/i.exec(t);
    if (km) {
      key ??= keyFromName(km[2].replace(/[()]/g, ''));
      continue;
    }
    const bm = /^(bpm|tempo)\s*[:=]?\s*(\d{2,3})\b/i.exec(t);
    if (bm) {
      bpm ??= Number(bm[2]);
      continue;
    }
    if (TAB_LINE.test(line)) continue;
    if (JUNK.some((re) => re.test(t))) continue;
    out.push(line);
  }

  // Quitar el bloque de tablatura con su encabezado «[Tab - Intro]» si quedó vacío
  const text = out
    .join('\n')
    .replace(/^\s*\[tab[^\]]*\]\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Título y autor: primeras líneas si no son acordes ni secciones (p. ej. «Océanos\nHillsong»)
  const head = text.split('\n').slice(0, 3).map((l) => l.trim());
  const isMusic = (l: string) => !l || /^\[/.test(l) || l.split(/\s+/).every((w) => parseChord(w.replace(/[()]/g, '')));
  let body = text;
  if (head[0] && !isMusic(head[0]) && head[0].length < 60) {
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(head[0]);
    if (dash) {
      title = dash[1];
      artist = dash[2];
      body = text.split('\n').slice(1).join('\n');
    } else if (head[1] && !isMusic(head[1]) && head[1].length < 40 && !head[2]) {
      // «Título» + «Autor» + línea en blanco
      title = head[0];
      artist = head[1];
      body = text.split('\n').slice(2).join('\n');
    }
  }
  return { title, artist, key, bpm, sheet: body.replace(/^\n+/, '') };
}

/**
 * ChordPro (.cho/.chopro/.chordpro/.pro, exportado por CCLI SongSelect,
 * OnSong, SongBook…). Las directivas pasan a encabezados y los acordes
 * [G] se quedan en línea (la app ya los entiende y transporta).
 */
export function parseChordProFile(raw: string): ImportedSheet {
  let title = '';
  let artist = '';
  let key: KeyRef | null = null;
  let bpm: number | null = null;
  const out: string[] = [];
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const d = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line);
    if (!d) {
      if (/^\s*#/.test(line)) continue; // comentario de archivo
      out.push(line.replace(/\s+$/, ''));
      continue;
    }
    const name = d[1].toLowerCase();
    const val = (d[2] ?? '').trim();
    if (name === 'title' || name === 't') title = val;
    else if (name === 'artist' || name === 'subtitle' || name === 'st' || name === 'composer') artist ||= val;
    else if (name === 'key') key = keyFromName(val);
    else if (name === 'tempo') bpm = Number(val) || null;
    else if (name === 'start_of_chorus' || name === 'soc') out.push(val ? `[${val}]` : '[Coro]');
    else if (name === 'start_of_verse' || name === 'sov') out.push(val ? `[${val}]` : '[Estrofa]');
    else if (name === 'start_of_bridge' || name === 'sob') out.push(val ? `[${val}]` : '[Puente]');
    else if (/^(comment|c|ci|comment_italic|cb|comment_box)$/.test(name)) out.push(`[${val}]`);
    else if (/^(end_of_|eo)/.test(name)) out.push('');
  }
  return { title, artist, key, bpm, sheet: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** Detecta el formato por extensión/contenido. */
export function importFile(name: string, raw: string): ImportedSheet {
  const isChordPro = /\.(cho|chopro|chordpro|crd|pro)$/i.test(name) || /^\s*\{\s*(title|t)\s*:/im.test(raw);
  const r = isChordPro ? parseChordProFile(raw) : cleanPastedSheet(raw);
  if (!r.title) r.title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return r;
}

/** Enlaces de búsqueda (se abren en el navegador; la persona copia y pega). */
export function searchLinks(query: string) {
  const q = encodeURIComponent(query.trim());
  return [
    { label: 'LaCuerda', url: `https://www.google.com/search?q=site%3Alacuerda.net+${q}` },
    { label: 'Cifra Club', url: `https://www.google.com/search?q=site%3Acifraclub.com+${q}` },
    { label: 'Google', url: `https://www.google.com/search?q=acordes+${q}` },
  ];
}
