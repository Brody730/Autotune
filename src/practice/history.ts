/** Historial de prácticas (en este dispositivo). */
export interface PracticeRecord {
  id: string;
  songKey: string;
  title: string;
  style: string;
  bpm: number;
  shift: number;
  score: number;
  perfect: number;
  good: number;
  miss: number;
  extras: number;
  maxStreak: number;
  recordingId: string | null;
  date: number;
}

const KEY = 'lsa.practice.history';

export function practiceHistory(): PracticeRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as PracticeRecord[];
  } catch {
    return [];
  }
}

export function addPractice(r: PracticeRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...practiceHistory()].slice(0, 200)));
  } catch {
    /* sin espacio */
  }
}

export function bestScore(songKey: string, style: string): number | null {
  const s = practiceHistory().filter((r) => r.songKey === songKey && r.style === style);
  return s.length ? Math.max(...s.map((r) => r.score)) : null;
}
