import { MusicalKey } from '../audio/music';
import { transposeShift } from '../song/chords';
import { KeyRef } from './store';

const ref = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });

/**
 * Tono sugerido para una voz: mueve el rango que se cantó (low..high, en
 * sungKey) hasta que quepa en el rango del usuario. Se permite cantar una
 * octava abajo/arriba (p. ej. hombre cantando canción de mujer).
 * Devuelve los semitonos respecto a `base` (-5..+6) o null si faltan datos.
 */
export function suggestShift(opts: {
  base: KeyRef;
  sungKey: KeyRef | null;
  low: number | null;
  high: number | null;
  vocalLow: number | null;
  vocalHigh: number | null;
}): number | null {
  const { base, sungKey, low, high, vocalLow, vocalHigh } = opts;
  if (low === null || high === null || vocalLow === null || vocalHigh === null || !sungKey) return null;
  // Rango de la melodía expresado en el tono base
  const sungShift = transposeShift(ref(base), ref(sungKey));
  const lo0 = low - sungShift;
  const hi0 = high - sungShift;
  const uCenter = (vocalLow + vocalHigh) / 2;
  let best = 0;
  let bestCost = Infinity;
  for (let s = -6; s <= 6; s++) {
    for (const oct of [-12, 0, 12]) {
      const lo = lo0 + s + oct;
      const hi = hi0 + s + oct;
      const out = Math.max(0, vocalLow - lo) + Math.max(0, hi - vocalHigh);
      const cost = out * 10 + Math.abs((lo + hi) / 2 - uCenter) + Math.abs(oct) / 24;
      if (cost < bestCost) {
        bestCost = cost;
        best = s;
      }
    }
  }
  return best === -6 ? 6 : best;
}

export function shiftKeyRef(k: KeyRef, s: number): KeyRef {
  return { root: (k.root + s + 120) % 12, scale: k.scale };
}

export function keyShiftBetween(from: KeyRef, to: KeyRef): number {
  return transposeShift(ref(from), ref(to));
}
