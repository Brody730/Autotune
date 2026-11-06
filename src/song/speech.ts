/**
 * Envoltorio de la Web Speech API (SpeechRecognition).
 * Disponible en Chrome y Edge. Brave/Firefox la exponen a medias o no la
 * tienen: en ese caso se reporta 'unsupported' y la app usa la huella de audio.
 */

interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
  length: number;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function getCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => getCtor() !== null;

export interface SpeechHandlers {
  /** Texto definitivo de una frase. */
  onFinal(text: string): void;
  /** Texto provisional (va cambiando mientras se canta). */
  onInterim(text: string): void;
  onError(code: string): void;
}

export class SpeechListener {
  private rec: SR | null = null;
  private running = false;
  private fatal = false;
  private restartTimer = 0;

  constructor(
    private lang: string,
    private h: SpeechHandlers,
  ) {}

  start() {
    const Ctor = getCtor();
    if (!Ctor) {
      this.h.onError('unsupported');
      return;
    }
    this.running = true;
    this.fatal = false;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) this.h.onFinal(text);
        else interim += text;
      }
      this.h.onInterim(interim);
    };
    rec.onerror = (e) => {
      // no-speech / aborted son normales; el resto se reporta
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
        this.fatal = true;
      }
      this.h.onError(e.error);
    };
    // Chrome corta el reconocimiento tras silencios: reiniciarlo
    rec.onend = () => {
      if (!this.running || this.fatal) return;
      this.restartTimer = window.setTimeout(() => {
        try {
          rec.start();
        } catch {
          /* ya iniciado */
        }
      }, 250);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.h.onError((err as Error).name || 'start-failed');
    }
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.restartTimer);
    if (this.rec) {
      this.rec.onend = null;
      this.rec.onresult = null;
      this.rec.onerror = null;
      try {
        this.rec.abort();
      } catch {
        /* noop */
      }
    }
    this.rec = null;
  }
}
