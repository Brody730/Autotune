import { MAX_FREQ, MIN_FREQ, yinDetect } from './yin';

export const PITCH_WORKLET_NAME = 'pitch-detector';
export const PITCH_WORKLET_MODULE_TYPE = 'application/javascript';

/** Tamaño de ventana de análisis y salto entre análisis (muestras). */
export const FRAME_SIZE = 2048;
export const HOP_SIZE = 1024;

/**
 * Opciones del detector (processorOptions). Por defecto: voz.
 * Para bajo: decimate 2 (analiza a 24 kHz → ventana de 85 ms que alcanza el
 * Mi grave de 41 Hz sin multiplicar el costo), minFreq 38.
 */
export interface PitchOptions {
  frameSize?: number;
  hop?: number;
  minFreq?: number;
  maxFreq?: number;
  threshold?: number;
  decimate?: number;
}

export const BASS_OPTIONS: PitchOptions = { frameSize: 2048, hop: 512, minFreq: 38, maxFreq: 420, threshold: 0.18, decimate: 2 };

/**
 * Código del AudioWorkletProcessor. Se construye como string porque el
 * worklet se carga desde un Blob; la función YIN se inyecta desde yin.ts
 * para que haya una única implementación.
 * Cada mensaje lleva `t`: el instante (en el reloj del AudioContext) del
 * centro de la ventana analizada, para medir a tiempo la nota tocada.
 */
export const PITCH_PROCESSOR_SOURCE = `
const yinDetect = ${yinDetect.toString()};

class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.frameSize = o.frameSize || ${FRAME_SIZE};
    this.hop = o.hop || ${HOP_SIZE};
    this.minFreq = o.minFreq || ${MIN_FREQ};
    this.maxFreq = o.maxFreq || ${MAX_FREQ};
    this.threshold = o.threshold || 0.15;
    this.decimate = Math.max(1, o.decimate || 1);
    this.ring = new Float32Array(this.frameSize);
    this.frame = new Float32Array(this.frameSize);
    this.yinBuf = new Float32Array(this.frameSize / 2);
    this.writePos = 0;
    this.filled = 0;
    this.sinceLast = 0;
    this.acc = 0;
    this.accN = 0;
  }

  push(v) {
    this.ring[this.writePos] = v;
    this.writePos = (this.writePos + 1) % this.frameSize;
    this.filled = Math.min(this.frameSize, this.filled + 1);
    this.sinceLast++;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const ch = input[0];
    const n = ch.length;
    const d = this.decimate;
    for (let i = 0; i < n; i++) {
      if (d === 1) {
        this.push(ch[i]);
      } else {
        this.acc += ch[i];
        if (++this.accN === d) {
          this.push(this.acc / d);
          this.acc = 0;
          this.accN = 0;
        }
      }
    }

    if (this.filled >= this.frameSize && this.sinceLast >= this.hop) {
      this.sinceLast = 0;
      const size = this.frameSize;
      const tail = size - this.writePos;
      this.frame.set(this.ring.subarray(this.writePos), 0);
      this.frame.set(this.ring.subarray(0, this.writePos), tail);
      const sr = sampleRate / d; // sampleRate y currentTime son globales del worklet
      const r = yinDetect(this.frame, sr, this.minFreq, this.maxFreq, this.threshold, this.yinBuf);
      r.t = currentTime + n / sampleRate - size / 2 / sr;
      this.port.postMessage(r);
    }
    return true; // mantener vivo el procesador
  }
}

registerProcessor('${PITCH_WORKLET_NAME}', PitchProcessor);
`;
