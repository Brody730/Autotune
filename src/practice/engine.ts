import { BASS_OPTIONS, PITCH_PROCESSOR_SOURCE, PITCH_WORKLET_MODULE_TYPE, PITCH_WORKLET_NAME } from '../audio/pitchWorklet';
import { LiveRecorder } from '../lib/recordings';
import { Style } from './styles';
import { Timeline } from './timeline';

/**
 * Sesión de práctica: toca la pista (batería + acordes + bajo guía opcional),
 * escucha tu bajo por la interfaz de audio y califica cada nota.
 * Todo usa el MISMO reloj (AudioContext.currentTime): la pista se programa
 * con precisión de muestra y cada nota detectada trae su instante exacto.
 */

export type Judge = 'perfect' | 'good' | 'miss';

export interface PlayedNote {
  /** Tiempo en pulsos desde el inicio de la canción (ya corregido por latencia). */
  beat: number;
  midi: number;
  /** Índice de la nota esperada que acertó (o null = nota propia / arreglo). */
  target: number | null;
  /** Para notas propias: ¿es nota del acorde (arreglo) o de paso? */
  kind?: 'acorde' | 'paso';
}

export interface Results {
  total: number;
  perfect: number;
  good: number;
  miss: number;
  score: number; // 0..100
  maxStreak: number;
  /** ms promedio: negativo = te adelantas, positivo = te atrasas. */
  avgOffsetMs: number | null;
  extras: PlayedNote[];
  perChord: { name: string; hit: number; total: number }[];
  recordingId: string | null;
}

let noiseCache: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = b;
  return b;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class PracticeSession {
  readonly ctx: AudioContext;
  private master: GainNode;
  private backing: GainNode;
  private guide: GainNode;
  private recDest: MediaStreamAudioDestinationNode;
  private nodes: AudioNode[] = [];
  private timer = 0;
  private nextHit = 0;
  private nextBass = 0;
  private nextCount = 0;
  private moduleUrl: string | null = null;
  private recorder: LiveRecorder | null = null;
  private stopped = false;

  /** Instante (reloj del AudioContext) en que empieza la canción tras la cuenta. */
  t0 = 0;
  judges: (Judge | null)[];
  hitOffsets: (number | null)[];
  played: PlayedNote[] = [];
  streak = 0;
  maxStreak = 0;
  /** Nota que suena ahora (para mostrarla en vivo). */
  liveMidi: number | null = null;
  onChange: (() => void) | null = null;

  // detección de ataques
  private lastAttackT = -10;
  private lastGoodT = -10;
  private pending: { midi: number; t: number } | null = null;
  private curNote: { midi: number; t: number } | null = null;
  /** Solo desarrollo: cuadros del detector para depurar. */
  debugFrames: { frequency: number | null; clarity: number; rms: number; t: number; beat: number }[] = [];
  private rmsLow = 1;
  private lastOnset = -1;

  constructor(
    private stream: MediaStream,
    readonly tl: Timeline,
    readonly style: Style,
    private opts: { guide: boolean; latencyMs: number; volume: number; record: boolean; title: string },
  ) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = opts.volume;
    this.backing = this.ctx.createGain();
    this.guide = this.ctx.createGain();
    this.guide.gain.value = opts.guide ? 0.9 : 0;
    this.backing.connect(this.master);
    this.guide.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.recDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
    this.judges = tl.bass.map(() => null);
    this.hitOffsets = tl.bass.map(() => null);
  }

  setGuide(on: boolean) {
    this.guide.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }
  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Pulso actual de la canción (negativo durante la cuenta). */
  beatNow(): number {
    return (this.ctx.currentTime - this.t0) / this.tl.beatSec;
  }
  get finished() {
    return this.beatNow() > this.tl.totalBeats + 0.5;
  }

  async start() {
    const ctx = this.ctx;
    await ctx.resume();
    // Escucha del bajo: pasa-bajos + detector afinado para notas graves
    this.moduleUrl = URL.createObjectURL(new Blob([PITCH_PROCESSOR_SOURCE], { type: PITCH_WORKLET_MODULE_TYPE }));
    await ctx.audioWorklet.addModule(this.moduleUrl);
    const src = ctx.createMediaStreamSource(this.stream);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 30;
    const wk = new AudioWorkletNode(ctx, PITCH_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: BASS_OPTIONS,
    });
    wk.port.onmessage = (e) => this.onFrame(e.data as { frequency: number | null; clarity: number; rms: number; t: number });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(hp).connect(lp).connect(wk).connect(mute).connect(ctx.destination);
    // La toma se graba junto con la pista
    const inGain = ctx.createGain();
    inGain.gain.value = 1;
    src.connect(inGain).connect(this.recDest);
    this.nodes = [src, hp, lp, wk, mute, inGain];

    this.t0 = ctx.currentTime + 0.4 + this.tl.countInBeats * this.tl.beatSec;
    this.nextCount = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();

    if (this.opts.record && typeof MediaRecorder !== 'undefined') {
      this.recorder = new LiveRecorder(this.recDest.stream, `Práctica · ${this.opts.title}`, null);
      await this.recorder.start();
    }
  }

  // ── Programación de la pista (con 150 ms de anticipación) ────────────────
  private schedule() {
    if (this.stopped) return;
    const ctx = this.ctx;
    const horizon = ctx.currentTime + 0.15;
    const bt = (beat: number) => this.t0 + beat * this.tl.beatSec;
    // Cuenta de entrada
    while (this.nextCount < this.tl.countInBeats) {
      const t = this.t0 - (this.tl.countInBeats - this.nextCount) * this.tl.beatSec;
      if (t > horizon) break;
      this.click(t, this.nextCount % this.tl.beatsPerBar === 0);
      this.nextCount++;
    }
    const hits = this.tl.hits;
    while (this.nextHit < hits.length && bt(hits[this.nextHit].beat) <= horizon) {
      const h = hits[this.nextHit++];
      const t = bt(h.beat);
      if (h.drum) this.drum(h.drum, t, h.vel);
      if (h.chord) this.chord(h.chordIdx, h.chord, h.beat, t, h.vel);
    }
    const bass = this.tl.bass;
    while (this.nextBass < bass.length && bt(bass[this.nextBass].beat) <= horizon) {
      const b = bass[this.nextBass++];
      this.bassNote(b.midi, bt(b.beat), b.len * this.tl.beatSec * 0.92);
    }
    // Notas no tocadas → falladas
    this.sweepMisses();
    if (this.finished) this.onChange?.();
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(t: number, filter: BiquadFilterType, freq: number, q: number, peak: number, decay: number) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.002, decay);
    s.connect(f).connect(g).connect(this.backing);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.05);
  }

  private drum(d: string, t: number, vel: number) {
    const ctx = this.ctx;
    if (d === 'kick') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      this.env(g, t, 0.9 * vel, 0.003, 0.32);
      o.connect(g).connect(this.backing);
      o.start(t);
      o.stop(t + 0.4);
    } else if (d === 'snare') {
      this.noiseBurst(t, 'highpass', 1400, 0.7, 0.45 * vel, 0.16);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 190;
      this.env(g, t, 0.35 * vel, 0.002, 0.08);
      o.connect(g).connect(this.backing);
      o.start(t);
      o.stop(t + 0.12);
    } else if (d === 'hat') this.noiseBurst(t, 'highpass', 7500, 0.7, 0.28 * vel, 0.04);
    else if (d === 'guiro') this.noiseBurst(t, 'bandpass', 4200, 4, 0.5 * vel, 0.07);
    else if (d === 'rim') this.noiseBurst(t, 'bandpass', 1800, 8, 0.6 * vel, 0.035);
    else if (d === 'clap') {
      for (const dt of [0, 0.012, 0.024]) this.noiseBurst(t + dt, 'bandpass', 1300, 1.2, 0.35 * vel, dt === 0.024 ? 0.14 : 0.02);
    }
  }

  private chord(idx: number, kind: 'stab' | 'pad', beat: number, t: number, vel: number) {
    const ctx = this.ctx;
    const c = this.tl.chords[idx];
    if (!c) return;
    const timbre = this.style.timbre;
    // Duración: «pam» corto o sostenido hasta el próximo cambio
    const nextChange = Math.min(c.endBeat, Math.ceil((beat + 0.001) / this.tl.beatsPerBar) * this.tl.beatsPerBar);
    const dur = kind === 'stab' ? (timbre === 'piano' ? 0.35 : 0.2) : Math.max(0.3, (nextChange - beat) * this.tl.beatSec * 0.95);
    // Voces entre Sol3 y Sol4
    const tones = timbre === 'guitarra' ? [c.tones[0], c.tones[2], c.tones[0]] : c.tones;
    tones.forEach((pc, i) => {
      let m = 55 + ((pc - 7 + 12) % 12);
      if (timbre === 'guitarra' && i === 2) m += 12;
      const voices = timbre === 'acordeon' ? [-7, 7] : [0];
      for (const cents of voices) {
        const o = ctx.createOscillator();
        o.type = timbre === 'acordeon' ? 'square' : timbre === 'guitarra' ? 'sawtooth' : timbre === 'organo' ? 'sine' : 'triangle';
        o.frequency.value = hz(m);
        o.detune.value = cents;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = timbre === 'guitarra' ? 1800 : timbre === 'acordeon' ? 2400 : 3000;
        const g = ctx.createGain();
        const peak = (0.09 * vel) / voices.length;
        if (kind === 'pad') {
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.08);
          g.gain.setValueAtTime(peak, t + dur - 0.1);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
        } else this.env(g, t, peak * 1.4, 0.006, dur);
        o.connect(f).connect(g).connect(this.backing);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    });
  }

  private bassNote(midi: number, t: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.18, t + Math.min(dur, 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.guide);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private click(t: number, accent: boolean) {
    const o = this.ctx.createOscillator();
    o.frequency.value = accent ? 2000 : 1400;
    const g = this.ctx.createGain();
    this.env(g, t, 0.35, 0.001, 0.06);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  // ── Escucha y calificación ───────────────────────────────────────────────
  private onFrame(r: { frequency: number | null; clarity: number; rms: number; t: number }) {
    if (this.stopped) return;
    if (import.meta.env.DEV) this.debugFrames.push({ ...r, beat: (r.t - this.t0) / this.tl.beatSec });
    const raw = r.frequency !== null ? 69 + 12 * Math.log2(r.frequency / 440) : null;
    // Golpe de energía (ataque de la cuerda), aunque ese cuadro aún no tenga tono claro
    if (r.rms > this.rmsLow * 2.2 && r.rms > 0.01) {
      this.lastAttackT = r.t;
      this.rmsLow = r.rms;
    } else this.rmsLow = Math.min(this.rmsLow * 1.15 + 0.0005, r.rms);

    // En notas cortas de bajo la «claridad» de YIN es moderada (la ventana
    // atrapa el ataque): se acepta claridad media si el tono se repite estable
    const cand = raw !== null && r.clarity >= 0.35 && r.rms >= 0.003;
    if (!cand) {
      // Silencio de verdad → la nota terminó
      if (r.rms < 0.002 || r.t - this.lastGoodT > 0.12) this.curNote = null;
      this.pending = null;
      this.liveMidi = this.curNote?.midi ?? null;
      return;
    }
    this.lastGoodT = r.t;
    const p = this.pending;
    if (!p || Math.abs(raw - p.midi) >= 0.6) {
      this.pending = { midi: raw, t: r.t };
      this.liveMidi = this.curNote?.midi ?? null;
      return;
    }
    // Dos lecturas seguidas coinciden → nota confirmada (en el instante de la primera)
    const midi = (raw + p.midi) / 2;
    this.pending = null;
    const cur = this.curNote;
    let isNew = !cur;
    if (cur) {
      const d = Math.abs(midi - cur.midi);
      const octaveJump = Math.abs(Math.round(midi) - Math.round(cur.midi)) % 12 === 0 && d > 6;
      const reAttack = this.lastAttackT > cur.t + 0.05 && p.t - this.lastAttackT < 0.15;
      // Nota distinta, o la misma vuelta a pulsar (con ataque). Un «salto de
      // octava» del detector poco después del ataque es la misma nota.
      isNew = (d >= 0.6 && !(octaveJump && p.t - cur.t < 0.3)) || reAttack;
    }
    if (isNew && p.t - this.lastOnset > 0.07) {
      this.lastOnset = p.t;
      this.curNote = { midi, t: p.t };
      this.registerOnset(p.t, midi);
    } else if (cur) {
      cur.midi = cur.midi * 0.7 + midi * 0.3;
    }
    this.liveMidi = this.curNote?.midi ?? null;
  }

  private registerOnset(t: number, midiF: number) {
    const lat = this.opts.latencyMs / 1000;
    const beat = (t - lat - this.t0) / this.tl.beatSec;
    if (beat < -0.5 || beat > this.tl.totalBeats + 0.5) return;
    const midi = Math.round(midiF);
    const pc = ((midi % 12) + 12) % 12;
    const winBeats = 0.2 / this.tl.beatSec;
    // Nota esperada más cercana con la misma nota (sin importar octava)
    let best = -1;
    let bestD = Infinity;
    this.tl.bass.forEach((b, i) => {
      if (this.judges[i] !== null) return;
      const d = Math.abs(b.beat - beat);
      if (d <= winBeats && ((b.midi % 12) + 12) % 12 === pc && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      const offMs = (beat - this.tl.bass[best].beat) * this.tl.beatSec * 1000;
      this.judges[best] = Math.abs(offMs) <= 80 ? 'perfect' : 'good';
      this.hitOffsets[best] = offMs;
      this.streak++;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      this.played.push({ beat, midi, target: best });
    } else {
      const chordIdx = Math.max(0, Math.min(this.tl.chords.length - 1, Math.floor(beat / (this.tl.chords[0]?.endBeat || 1))));
      const inChord = this.tl.chords[chordIdx]?.tones.includes(pc);
      this.played.push({ beat, midi, target: null, kind: inChord ? 'acorde' : 'paso' });
    }
    this.onChange?.();
  }

  private sweepMisses() {
    const lateBeat = this.beatNow() - (0.25 + this.opts.latencyMs / 1000) / this.tl.beatSec;
    this.tl.bass.forEach((b, i) => {
      if (this.judges[i] === null && b.beat < lateBeat) {
        this.judges[i] = 'miss';
        this.streak = 0;
      }
    });
  }

  results(): Results {
    const total = this.tl.bass.length;
    const perfect = this.judges.filter((j) => j === 'perfect').length;
    const good = this.judges.filter((j) => j === 'good').length;
    const miss = total - perfect - good;
    const offs = this.hitOffsets.filter((o): o is number => o !== null);
    const perChord = this.tl.chords.map((c, ci) => {
      const idx = this.tl.bass.map((b, i) => (b.chordIdx === ci ? i : -1)).filter((i) => i >= 0);
      return { name: c.name, total: idx.length, hit: idx.filter((i) => this.judges[i] === 'perfect' || this.judges[i] === 'good').length };
    });
    return {
      total,
      perfect,
      good,
      miss,
      score: total ? Math.round(((perfect * 100 + good * 65) / (total * 100)) * 100) : 0,
      maxStreak: this.maxStreak,
      avgOffsetMs: offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : null,
      extras: this.played.filter((p) => p.target === null),
      perChord,
      recordingId: this.recorder?.id ?? null,
    };
  }

  async stop(): Promise<Results> {
    if (!this.stopped) {
      this.stopped = true;
      window.clearInterval(this.timer);
      // las notas que faltaban cuentan como no tocadas
      this.judges = this.judges.map((j, i) => (j === null && this.tl.bass[i].beat < this.beatNow() ? 'miss' : j));
      if (this.recorder) await this.recorder.stop().catch(() => undefined);
      for (const n of this.nodes) {
        try {
          n.disconnect();
        } catch {
          /* noop */
        }
      }
      if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
      await this.ctx.close().catch(() => undefined);
    }
    return this.results();
  }
}

/** Latencia sugerida: salida del sistema + ventana del detector. */
export function defaultLatencyMs() {
  try {
    const saved = Number(localStorage.getItem('lsa.practice.latency'));
    if (saved) return saved;
  } catch {
    /* noop */
  }
  return 90;
}
