/**
 * Reproductor multipista: todas las pistas se decodifican a memoria y se
 * lanzan en el mismo instante del AudioContext, así quedan sincronizadas
 * muestra a muestra. Cada pista tiene su propio volumen.
 */
export class StemPlayer {
  readonly ctx: AudioContext;
  private master: GainNode;
  private gains = new Map<string, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  private timer = 0;
  private closed = false;
  playing = false;
  duration = 0;
  loop: { a: number; b: number } | null = null;
  onChange: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async load(blobs: Record<string, Blob>, onProgress?: (done: number, total: number) => void) {
    const names = Object.keys(blobs);
    let done = 0;
    for (const name of names) {
      const buf = await this.ctx.decodeAudioData(await blobs[name].arrayBuffer());
      if (this.closed) return;
      this.buffers.set(name, buf);
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.gains.set(name, g);
      this.duration = Math.max(this.duration, buf.duration);
      onProgress?.(++done, names.length);
    }
  }

  /** Picos (0..1) para dibujar la forma de onda de una pista. */
  peaks(name: string, buckets: number): Float32Array {
    const out = new Float32Array(buckets);
    const buf = this.buffers.get(name);
    if (!buf) return out;
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const stride = Math.max(1, Math.floor(step / 64));
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let j = i * step; j < end; j += stride) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      out[i] = max;
    }
    return out;
  }

  setGain(name: string, value: number) {
    this.gains.get(name)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  /** Posición actual en segundos. */
  time(): number {
    if (!this.playing) return this.offset;
    let t = this.offset + (this.ctx.currentTime - this.startedAt);
    const l = this.loop;
    if (l && this.offset < l.b && t >= l.b) t = l.a + ((t - l.a) % (l.b - l.a));
    return Math.min(t, this.duration);
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* ya detenida */
      }
      s.disconnect();
    }
    this.sources = [];
    window.clearInterval(this.timer);
  }

  async play() {
    if (this.playing || this.closed) return;
    await this.ctx.resume();
    if (this.offset >= this.duration - 0.05) this.offset = this.loop?.a ?? 0;
    const when = this.ctx.currentTime + 0.06;
    const l = this.loop;
    for (const [name, buf] of this.buffers) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      if (l && this.offset < l.b) {
        s.loop = true;
        s.loopStart = l.a;
        s.loopEnd = Math.min(l.b, buf.duration);
      }
      s.connect(this.gains.get(name)!);
      s.start(when, Math.min(this.offset, buf.duration));
      this.sources.push(s);
    }
    this.startedAt = when;
    this.playing = true;
    // Fin de la canción
    this.timer = window.setInterval(() => {
      if (this.playing && !this.loop && this.time() >= this.duration - 0.02) {
        this.pause();
        this.offset = 0;
        this.onChange?.();
      }
    }, 200);
    this.onChange?.();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time();
    this.playing = false;
    this.stopSources();
    this.onChange?.();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const was = this.playing;
    if (was) {
      this.playing = false;
      this.stopSources();
    }
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) void this.play();
    else this.onChange?.();
  }

  setLoop(loop: { a: number; b: number } | null) {
    const t = this.time();
    this.loop = loop && loop.b - loop.a > 0.3 ? loop : null;
    // Reprogramar las fuentes con el nuevo tramo
    if (this.playing) this.seek(this.loop && (t < this.loop.a || t >= this.loop.b) ? this.loop.a : t);
    else this.onChange?.();
  }

  async close() {
    this.closed = true;
    this.playing = false;
    this.stopSources();
    this.buffers.clear();
    await this.ctx.close().catch(() => undefined);
  }
}
