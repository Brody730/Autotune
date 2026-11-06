export interface PitchResult {
  /** Frecuencia fundamental en Hz, o null si no hay tono claro. */
  frequency: number | null;
  /** 0..1 — qué tan periódica es la señal (1 - mínimo de la CMNDF). */
  clarity: number;
  /** Nivel RMS del frame (0..1). */
  rms: number;
}

export const MIN_FREQ = 65; // ~C2
export const MAX_FREQ = 1100; // ~C#6

/**
 * YIN (de Cheveigné & Kawahara, 2002).
 * Función autocontenida: NO referencia nada externo porque su código fuente
 * se inyecta tal cual dentro del AudioWorklet (ver pitchWorklet.ts).
 */
export function yinDetect(
  buf: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
  threshold: number,
  yinBuf: Float32Array,
): { frequency: number | null; clarity: number; rms: number } {
  const size = buf.length;
  const half = size >> 1;

  let sumSq = 0;
  for (let i = 0; i < size; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / size);

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(half - 1, Math.ceil(sampleRate / minFreq));

  // 1) Función de diferencia  d(τ) = Σ (x[j] - x[j+τ])²
  yinBuf[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < half; j++) {
      const delta = buf[j] - buf[j + tau];
      sum += delta * delta;
    }
    yinBuf[tau] = sum;
  }

  // 2) Diferencia media normalizada acumulada (CMNDF)
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += yinBuf[tau];
    yinBuf[tau] = running > 0 ? (yinBuf[tau] * tau) / running : 1;
  }

  // 3) Umbral absoluto: primer mínimo local por debajo del umbral
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (yinBuf[tau] < threshold) {
      while (tau + 1 <= tauMax && yinBuf[tau + 1] < yinBuf[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  // Si nada cruza el umbral, tomamos el mínimo global (con baja claridad)
  if (tauEst < 0) {
    let best = tauMin;
    for (let tau = tauMin + 1; tau <= tauMax; tau++) {
      if (yinBuf[tau] < yinBuf[best]) best = tau;
    }
    tauEst = best;
  }

  // 4) Interpolación parabólica
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = yinBuf[tauEst - 1];
    const s1 = yinBuf[tauEst];
    const s2 = yinBuf[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }

  const clarity = Math.max(0, Math.min(1, 1 - yinBuf[tauEst]));
  const frequency = sampleRate / betterTau;
  if (!isFinite(frequency) || frequency < minFreq || frequency > maxFreq) {
    return { frequency: null, clarity: 0, rms: rms };
  }
  return { frequency: frequency, clarity: clarity, rms: rms };
}
