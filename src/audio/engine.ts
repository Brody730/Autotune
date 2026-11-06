import { PITCH_PROCESSOR_SOURCE, PITCH_WORKLET_MODULE_TYPE, PITCH_WORKLET_NAME } from './pitchWorklet';
import { PitchResult } from './yin';

export interface DetectedFrame {
  /** null cuando no hay tono claro (silencio, ruido, consonantes). */
  midi: number | null;
  frequency: number | null;
  clarity: number;
  /** Nivel de entrada 0..1 (escala perceptual). */
  level: number;
}

export type FrameCallback = (frame: DetectedFrame) => void;

/** Umbrales de aceptación de pitch. */
const MIN_CLARITY = 0.8;
const MIN_RMS = 0.008;

export class PitchEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private moduleUrl: string | null = null;
  private disposed = false;

  get state(): AudioContextState | 'closed' {
    return this.ctx?.state ?? 'closed';
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get trackLabel(): string {
    return this.stream?.getAudioTracks()[0]?.label ?? '';
  }

  /** Abre el micrófono (deviceId opcional) y arranca el análisis. */
  async start(onFrame: FrameCallback, deviceId?: string): Promise<void> {
    this.disposed = false;

    // Procesado del navegador desactivado: la cancelación de eco y la
    // supresión de ruido deforman la voz cantada y engañan al detector.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.moduleUrl = URL.createObjectURL(
      new Blob([PITCH_PROCESSOR_SOURCE], { type: PITCH_WORKLET_MODULE_TYPE }),
    );
    await ctx.audioWorklet.addModule(this.moduleUrl);

    const source = ctx.createMediaStreamSource(stream);
    // Pasa-altos: elimina rumble de escenario / golpes de micrófono
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 60;
    highpass.Q.value = 0.7;

    const worklet = new AudioWorkletNode(ctx, PITCH_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    worklet.port.onmessage = (event: MessageEvent<PitchResult>) => {
      if (this.disposed) return;
      const { frequency, clarity, rms } = event.data;
      const level = Math.min(1, Math.sqrt(rms) * 2.2);
      const voiced = frequency !== null && clarity >= MIN_CLARITY && rms >= MIN_RMS;
      onFrame({
        midi: voiced ? 69 + 12 * Math.log2(frequency! / 440) : null,
        frequency: voiced ? frequency : null,
        clarity,
        level,
      });
    };

    // El worklet necesita estar conectado a destination para ser procesado;
    // un Gain en 0 evita que el micrófono suene por los altavoces.
    const mute = ctx.createGain();
    mute.gain.value = 0;

    source.connect(highpass);
    highpass.connect(worklet);
    worklet.connect(mute);
    mute.connect(ctx.destination);
    this.nodes = [source, highpass, worklet, mute];

    await ctx.resume().catch(() => undefined);
  }

  /** Reanuda el AudioContext (algunos navegadores exigen un gesto del usuario). */
  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  async stop(): Promise<void> {
    this.disposed = true;
    for (const node of this.nodes) {
      if (node instanceof AudioWorkletNode) node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        /* noop */
      }
    }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    this.moduleUrl = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
