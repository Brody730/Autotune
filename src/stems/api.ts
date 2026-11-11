/**
 * Cliente del «motor de pistas»: un servidor local (carpeta stem-server) que
 * descarga el audio de YouTube, separa los instrumentos con Demucs y detecta
 * acordes y notas. Corre en la PC del usuario porque necesita Python y GPU;
 * la página (aunque esté publicada en Vercel) se conecta a 127.0.0.1.
 */

export const ENGINE_URL = (import.meta.env.VITE_STEMS_URL as string | undefined) || 'http://127.0.0.1:8765';

/** Dónde se descarga el instalador del motor (lo sirve la propia página). */
export const INSTALLER_URL = `${import.meta.env.BASE_URL}motor/instalar-motor-de-pistas.bat`;

const OFFLINE = 'Se perdió la conexión con el Motor de pistas. Ábrelo desde el acceso directo «Motor de pistas» de tu escritorio y vuelve a intentarlo.';

/**
 * ¿El navegador tiene bloqueada la conexión de esta página con programas de
 * la propia PC? (Chrome/Edge: permiso «Acceso a la red local».) null = no se sabe.
 */
export async function localAccessBlocked(): Promise<boolean | null> {
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const st = await navigator.permissions.query({ name: name as PermissionName });
      return st.state === 'denied';
    } catch {
      /* este navegador no conoce ese permiso */
    }
  }
  return null;
}

export interface Note {
  /** Segundo de inicio. */
  t: number;
  /** Duración en segundos. */
  d: number;
  midi: number;
}

export interface ChordSeg {
  t: number;
  end: number;
  root: number;
  minor: boolean;
}

export interface Analysis {
  duration: number;
  bpm: number;
  key: { root: number; scale: 'major' | 'minor' };
  beats: number[];
  /** Pulso (0-3) donde empieza el compás. */
  phase: number;
  chords: ChordSeg[];
  bass: Note[];
  melody: Note[];
}

export interface EngineTrack {
  id: string;
  title: string;
  artist: string;
  url: string | null;
  thumbnail: string | null;
  model: '4' | '6';
  stems: string[];
  created: number;
  analysis: Analysis;
}

export interface Job {
  id: string | null;
  status: 'queued' | 'running' | 'done' | 'error';
  stage?: string;
  progress?: number;
  message?: string;
  track?: EngineTrack;
}

export interface Health {
  ok: boolean;
  version: string;
  device: 'cuda' | 'cpu';
  gpu: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENGINE_URL + path, init);
  } catch {
    throw new Error(OFFLINE);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function engineHealth(): Promise<Health | null> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(ENGINE_URL + '/health', { signal: ctl.signal });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const h = (await res.json()) as Health & { app?: string };
    return h.app === 'lsa-stems' ? h : null;
  } catch {
    return null;
  }
}

export const startJob = (url: string, model: '4' | '6') =>
  call<Job>('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, model }) });

export const startFileJob = (file: File, model: '4' | '6') =>
  call<Job>(`/jobs/file?model=${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });

export const getJob = (id: string) => call<Job>(`/jobs/${id}`);

export async function fetchStem(trackId: string, stem: string, semitones = 0, speed = 1): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/tracks/${trackId}/stem/${stem}.mp3?semitones=${semitones}&speed=${speed}`);
  } catch {
    throw new Error(OFFLINE);
  }
  if (!res.ok) throw new Error(`No se pudo bajar la pista «${stem}» (${res.status}). Puede que ya no esté en el motor: vuelve a separarla.`);
  return res.blob();
}

export async function downloadZip(
  trackId: string,
  opts: { volumes: Record<string, number>; semitones: number; speed: number; notation: 'latin' | 'american'; sheet: string; title: string; artist: string; start?: number; end?: number },
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/tracks/${trackId}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!res.ok) throw new Error(res.status === 404 ? 'Esta pista ya no está en el motor: vuelve a separarla para descargar el ZIP.' : `Error ${res.status}`);
  return res.blob();
}

export const deleteEngineTrack = (id: string) => call<{ ok: boolean }>(`/tracks/${id}`, { method: 'DELETE' }).catch(() => null);
