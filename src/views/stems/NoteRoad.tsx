import { useEffect, useRef } from 'react';
import { ChordSeg, Note } from '../../stems/api';
import { fretFor, STRING_NAMES } from '../../practice/timeline';

/**
 * Carretera de notas sobre el audio real: el tiempo corre de derecha a
 * izquierda hacia la línea de «ahora». En modo bajo cada carril es una cuerda
 * (con su traste); en modo melodía la altura es el tono.
 */
export function NoteRoad({
  mode,
  notes,
  chords,
  semitones,
  getTime,
  nameOf,
  chordName,
  liveMidi,
}: {
  mode: 'bass' | 'melody';
  notes: Note[];
  chords: ChordSeg[];
  semitones: number;
  /** Tiempo actual en segundos de la canción ORIGINAL. */
  getTime(): number;
  nameOf(midi: number): string;
  chordName(c: ChordSeg): string;
  liveMidi: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(liveMidi);
  live.current = liveMidi;

  useEffect(() => {
    // Cuerda y traste de cada nota del bajo, buscando la posición más cómoda
    let prevFret = 3;
    const laid = notes.map((n) => {
      const midi = n.midi + semitones;
      if (mode !== 'bass') return { ...n, midi, string: 0, fret: -1 };
      const pos = fretFor(midi, prevFret);
      const valid = pos.fret >= 0 && pos.fret <= 20;
      if (valid && pos.fret) prevFret = pos.fret;
      return { ...n, midi, string: pos.string, fret: valid ? pos.fret : -1 };
    });
    const midis = laid.map((n) => n.midi);
    const lo = midis.length ? Math.min(...midis) - 1 : 48;
    const hi = midis.length ? Math.max(...midis) + 1 : 72;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvas.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      const now = getTime();
      const hitX = Math.round(W * 0.2);
      const pps = Math.max(80, Math.min(170, W / 6));
      const top = 30;
      const x = (t: number) => hitX + (t - now) * pps;
      const tMin = now - hitX / pps - 1;
      const tMax = now + (W - hitX) / pps + 1;
      const laneH = (H - top - 8) / 4;
      const y = (n: { midi: number; string: number }) =>
        mode === 'bass' ? top + (3 - n.string) * laneH + laneH / 2 : top + 10 + (1 - (n.midi - lo) / Math.max(1, hi - lo)) * (H - top - 26);

      g.textBaseline = 'middle';
      if (mode === 'bass') {
        for (let s = 0; s < 4; s++) {
          const ly = top + (3 - s) * laneH + laneH / 2;
          g.strokeStyle = 'rgba(255,255,255,0.14)';
          g.lineWidth = 1 + (3 - s) * 0.6;
          g.beginPath();
          g.moveTo(0, ly);
          g.lineTo(W, ly);
          g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.font = '600 11px Bahnschrift, system-ui';
          g.textAlign = 'left';
          g.fillText(STRING_NAMES[s], 6, ly - 9);
        }
      }

      // Acordes arriba
      g.font = '700 15px Bahnschrift, system-ui';
      g.textAlign = 'left';
      for (const c of chords) {
        if (c.end < tMin || c.t > tMax) continue;
        const cx = x(c.t);
        g.strokeStyle = 'rgba(255,176,46,0.22)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx, 20);
        g.lineTo(cx, H);
        g.stroke();
        g.fillStyle = c.t <= now && now < c.end ? '#ffb02e' : 'rgba(247,243,234,0.6)';
        g.fillText(chordName(c), Math.max(cx + 4, c.t <= now && now < c.end ? hitX + 6 : -999), 12);
      }

      // Notas
      g.font = '700 12px Bahnschrift, system-ui';
      g.textAlign = 'center';
      for (const n of laid) {
        if (n.t + n.d < tMin || n.t > tMax) continue;
        const nx = x(n.t);
        const w = Math.max(22, n.d * pps - 3);
        const ny = y(n);
        const active = n.t <= now && now < n.t + n.d;
        const past = n.t + n.d <= now;
        g.fillStyle = active ? '#ffb02e' : past ? 'rgba(255,255,255,0.12)' : 'rgba(89,208,255,0.85)';
        g.beginPath();
        g.roundRect(nx, ny - 11, w, 22, 7);
        g.fill();
        g.fillStyle = past ? 'rgba(255,255,255,0.45)' : '#0b0b10';
        const label = mode === 'bass' && n.fret >= 0 ? `${n.fret}` : nameOf(n.midi);
        g.fillText(label, nx + Math.min(w / 2, 16), ny + 1);
        if (mode === 'bass' && n.fret >= 0 && w > 58) {
          g.textAlign = 'left';
          g.fillText(nameOf(n.midi), nx + 30, ny + 1);
          g.textAlign = 'center';
        }
      }

      // Línea de «ahora»
      g.strokeStyle = '#f7f3ea';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hitX, 22);
      g.lineTo(hitX, H - 2);
      g.stroke();

      // Tu nota en vivo (micrófono / interfaz)
      const lm = live.current;
      if (lm !== null) {
        const cur = laid.find((n) => n.t <= now + 0.08 && now < n.t + n.d + 0.08);
        const ok = !!cur && ((Math.round(lm) - cur.midi) % 12 + 12) % 12 === 0;
        g.fillStyle = ok ? '#3ee08f' : '#ff4d4d';
        g.font = '700 13px Bahnschrift, system-ui';
        g.textAlign = 'right';
        g.fillText(`Tú: ${nameOf(Math.round(lm))} ${cur ? (ok ? '✓' : '✗') : ''}`, hitX - 8, H - 12);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, notes, chords, semitones, getTime, nameOf, chordName]);

  return <canvas ref={canvas} className="note-road" />;
}
