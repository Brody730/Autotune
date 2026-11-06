import { MAX_FREQ, MIN_FREQ, yinDetect } from './yin';

export const PITCH_WORKLET_NAME = 'pitch-detector';
export const PITCH_WORKLET_MODULE_TYPE = 'application/javascript';

/** Tamaño de ventana de análisis y salto entre análisis (muestras). */
export const FRAME_SIZE = 2048;
export const HOP_SIZE = 1024;

/**
 * Código del AudioWorkletProcessor. Se construye como string porque el
 * worklet se carga desde un Blob; la función YIN se inyecta desde yin.ts
 * para que haya una única implementación.
 */
export const PITCH_PROCESSOR_SOURCE = `
const yinDetect = ${yinDetect.toString()};
const FRAME_SIZE = ${FRAME_SIZE};
const HOP_SIZE = ${HOP_SIZE};
const MIN_FREQ = ${MIN_FREQ};
const MAX_FREQ = ${MAX_FREQ};

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(FRAME_SIZE);
    this.frame = new Float32Array(FRAME_SIZE);
    this.yinBuf = new Float32Array(FRAME_SIZE / 2);
    this.writePos = 0;
    this.filled = 0;
    this.sinceLast = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const ch = input[0];
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      this.ring[this.writePos] = ch[i];
      this.writePos = (this.writePos + 1) % FRAME_SIZE;
    }
    this.filled = Math.min(FRAME_SIZE, this.filled + n);
    this.sinceLast += n;

    if (this.filled >= FRAME_SIZE && this.sinceLast >= HOP_SIZE) {
      this.sinceLast = 0;
      // Desenrollar el ring buffer en orden cronológico
      const tail = FRAME_SIZE - this.writePos;
      this.frame.set(this.ring.subarray(this.writePos), 0);
      this.frame.set(this.ring.subarray(0, this.writePos), tail);
      // sampleRate es global dentro de AudioWorkletGlobalScope
      const r = yinDetect(this.frame, sampleRate, MIN_FREQ, MAX_FREQ, 0.15, this.yinBuf);
      this.port.postMessage(r);
    }
    return true; // mantener vivo el procesador
  }
}

registerProcessor('${PITCH_WORKLET_NAME}', PitchProcessor);
`;
