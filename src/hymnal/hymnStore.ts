import { useSyncExternalStore } from 'react';
import { cleanPastedSheet, parseChordProFile } from '../song/importSheet';
import { Hymn, HYMN_COUNT } from './model';

/**
 * Himnario guardado en este dispositivo (100 % offline).
 * La app no trae letras: cada himno lo carga la iglesia o el músico
 * (pegando, importando archivos o un respaldo .json compartido).
 */

export interface HymnSettings {
  fontSize: number; // px de la letra
  notation: 'latin' | 'english';
  collapseChorus: boolean;
  shareVerseChords: boolean;
  accent: boolean; // acordes resaltados
  chordsOnly: boolean; // vista solo acordes (para músicos)
  showChords: boolean; // apagar para el proyector / congregación
  light: boolean; // tema claro para exteriores
  scroll: number; // px/s por defecto
  leadIn: number; // segundos de cuenta regresiva antes de desplazar
}

interface Data {
  hymns: Record<number, Hymn>;
  favorites: number[];
  setlist: number[];
  settings: HymnSettings;
}

const KEY = 'lsa.himnario.v1';
export const defaultSettings: HymnSettings = {
  fontSize: typeof window !== 'undefined' && window.innerWidth < 500 ? 20 : 26,
  notation: 'latin',
  collapseChorus: true,
  shareVerseChords: true,
  accent: true,
  chordsOnly: false,
  showChords: true,
  light: false,
  scroll: 22,
  leadIn: 3,
};

function load(): Data {
  const d: Data = { hymns: {}, favorites: [], setlist: [], settings: { ...defaultSettings } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Data>;
      return { ...d, ...p, settings: { ...defaultSettings, ...(p.settings ?? {}) } };
    }
  } catch {
    /* almacenamiento bloqueado */
  }
  return d;
}

let data = load();
const listeners = new Set<() => void>();
function commit(next: Data) {
  data = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* sin espacio */
  }
  listeners.forEach((l) => l());
}

export const hymnStore = {
  get: () => data,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  hymn: (n: number): Hymn | null => data.hymns[n] ?? null,
  save(h: Hymn) {
    commit({ ...data, hymns: { ...data.hymns, [h.num]: { ...h, updated: Date.now() } } });
  },
  remove(n: number) {
    const hymns = { ...data.hymns };
    delete hymns[n];
    commit({ ...data, hymns });
  },
  setScroll(n: number, scroll: number) {
    const h = data.hymns[n];
    if (h) commit({ ...data, hymns: { ...data.hymns, [n]: { ...h, scroll } } });
  },
  toggleFavorite(n: number) {
    const f = data.favorites.includes(n) ? data.favorites.filter((x) => x !== n) : [...data.favorites, n];
    commit({ ...data, favorites: f });
  },
  setSetlist(list: number[]) {
    commit({ ...data, setlist: list });
  },
  settings: (patch: Partial<HymnSettings>) => commit({ ...data, settings: { ...data.settings, ...patch } }),
};

export function useHymns<T>(sel: (d: Data) => T): T {
  return useSyncExternalStore(hymnStore.subscribe, () => sel(hymnStore.get()));
}

// ── Importar / exportar ─────────────────────────────────────────────────────

export interface ImportResult {
  added: number[];
  skipped: string[];
}

const validNum = (n: number) => Number.isInteger(n) && n >= 1 && n <= HYMN_COUNT;

function toHymn(num: number, title: string, text: string, key: Hymn['key'], bpm: number | null): Hymn {
  return { num, title: title.trim() || `Himno ${num}`, key, bpm, scroll: null, text: text.trim(), updated: Date.now() };
}

/** «012 - Título.cho», «12. Título.txt», «Himno 12 Título» → 12 */
function numFromName(name: string): number | null {
  const m = /(?:^|\D)(\d{1,3})(?:\D|$)/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Un solo texto con varios himnos separados por encabezados:
 *   ### 12 Título del himno
 *   (cifrado)
 * También acepta «{number: 12}» / «{title: …}» de ChordPro.
 */
export function parseBulkText(raw: string): Hymn[] {
  const out: Hymn[] = [];
  const parts = raw.replace(/\r/g, '').split(/^#{2,3}\s*/m).filter((p) => p.trim());
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const m = /^(\d{1,3})[\s.\-–:]*(.*)$/.exec(head.trim());
    if (!m) continue;
    const body = rest.join('\n');
    const c = /^\s*\{/m.test(body) ? parseChordProFile(body) : cleanPastedSheet(body);
    out.push(toHymn(Number(m[1]), m[2] || c.title, c.sheet, c.key, c.bpm));
  }
  return out;
}

export async function importFiles(files: FileList | File[]): Promise<ImportResult> {
  const res: ImportResult = { added: [], skipped: [] };
  const hymns: Hymn[] = [];
  for (const f of Array.from(files)) {
    const raw = await f.text();
    if (/\.json$/i.test(f.name)) {
      try {
        const p = JSON.parse(raw) as { hymns?: Record<string, Hymn> | Hymn[] };
        const list = Array.isArray(p.hymns) ? p.hymns : Object.values(p.hymns ?? {});
        hymns.push(...list.map((h) => ({ ...toHymn(Number(h.num), h.title, h.text, h.key ?? null, h.bpm ?? null), scroll: h.scroll ?? null })));
      } catch {
        res.skipped.push(`${f.name} (JSON inválido)`);
      }
      continue;
    }
    if (/^#{2,3}\s*\d/m.test(raw)) {
      hymns.push(...parseBulkText(raw));
      continue;
    }
    const isPro = /\.(cho|chopro|chordpro|crd|pro)$/i.test(f.name) || /^\s*\{\s*(title|t)\s*:/im.test(raw);
    const c = isPro ? parseChordProFile(raw) : cleanPastedSheet(raw);
    const numDirective = /^\s*\{\s*(?:number|num|n)\s*:\s*(\d+)\s*\}/im.exec(raw);
    const num = numDirective ? Number(numDirective[1]) : numFromName(f.name);
    if (!num || !validNum(num)) {
      res.skipped.push(`${f.name} (sin número de himno)`);
      continue;
    }
    const title = c.title || f.name.replace(/\.[^.]+$/, '').replace(/^\D*\d{1,3}[\s.\-_]*/, '').replace(/[_-]+/g, ' ');
    hymns.push(toHymn(num, title, c.sheet, c.key, c.bpm));
  }
  const merged = { ...data.hymns };
  for (const h of hymns) {
    if (!h.text) continue; // número vacío de la plantilla
    if (!validNum(h.num)) {
      res.skipped.push(`#${h.num} ${h.title}`);
      continue;
    }
    merged[h.num] = h;
    res.added.push(h.num);
  }
  commit({ ...data, hymns: merged });
  return res;
}

/** Respaldo para compartir con otro músico o pasar al celular. */
export function exportJson(): Blob {
  const payload = { app: 'live-stage-assistant', kind: 'himnario', version: 1, exported: new Date().toISOString(), hymns: data.hymns };
  return new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
}
