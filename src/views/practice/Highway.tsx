import { useEffect, useRef } from 'react';
import { PracticeSession } from '../../practice/engine';
import { BASS_STRINGS, STRING_NAMES } from '../../practice/timeline';

/**
 * «Carretera» tipo Guitar Hero: las notas del bajo avanzan de derecha a
 * izquierda hacia la línea de golpe. Cada carril es una cuerda (Sol arriba,
 * Mi abajo, como en una tablatura) y cada nota muestra su traste.
 */
export function Highway({ session, flatsNames }: { session: PracticeSession; flatsNames: (midi: number) => string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvas.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) {
        cv.width = W * dpr;
        cv.height = H * dpr;
      }
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      const tl = session.tl;
      const now = session.beatNow();
      const hitX = Math.round(W * 0.18);
      const pxPerBeat = tl.audio ? Math.max(90, Math.min(160, W / 7)) : Math.max(70, Math.min(200, W / (tl.beatsPerBar * 2.2)));
      const top = 34;
      const laneH = (H - top - 10) / 4;
      const laneY = (s: number) => top + (3 - s) * laneH + laneH / 2; // Sol arriba
      const x = (beat: number) => hitX + (beat - now) * pxPerBeat;

      // Compases
      for (let b = Math.floor(now - hitX / pxPerBeat); b < now + (W - hitX) / pxPerBeat + 1; b++) {
        if (b < 0 || b > tl.totalBeats || tl.audio) continue;
        const bar = b % tl.beatsPerBar === 0;
        g.strokeStyle = bar ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        g.lineWidth = bar ? 2 : 1;
        g.beginPath();
        g.moveTo(x(b), top - 6);
        g.lineTo(x(b), H - 6);
        g.stroke();
      }
      // Cuerdas
      for (let s = 0; s < 4; s++) {
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 1 + (3 - s) * 0.6;
        g.beginPath();
        g.moveTo(0, laneY(s));
        g.lineTo(W, laneY(s));
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.font = '600 12px Bahnschrift, system-ui';
        g.fillText(STRING_NAMES[s], 8, laneY(s) - 6);
      }
      // Acordes arriba
      g.font = '700 16px Bahnschrift, system-ui';
      for (const c of tl.chords) {
        const cx = x(c.startBeat);
        if (cx > W || x(c.endBeat) < 0) continue;
        g.fillStyle = c.startBeat <= now && now < c.endBeat ? '#ffb02e' : 'rgba(255,255,255,0.55)';
        g.fillText(c.name, Math.max(cx + 4, hitX + 4 > cx && now < c.endBeat ? hitX + 6 : cx + 4), 20);
      }
      // Línea de golpe
      g.fillStyle = 'rgba(255,176,46,0.12)';
      g.fillRect(hitX - 10, top - 6, 20, H - top);
      g.strokeStyle = '#ffb02e';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(hitX, top - 6);
      g.lineTo(hitX, H - 6);
      g.stroke();

      // Notas esperadas
      tl.bass.forEach((b, i) => {
        const x0 = x(b.beat);
        const w = Math.max(26, b.len * pxPerBeat - 6);
        if (x0 > W + 10 || x0 + w < -10) return;
        const y = laneY(b.string);
        const j = session.judges[i];
        const color = j === 'perfect' ? '#3ee08f' : j === 'good' ? '#9be37a' : j === 'miss' ? 'rgba(255,77,77,0.45)' : '#ffb02e';
        g.fillStyle = color;
        g.globalAlpha = j === 'miss' ? 0.5 : 1;
        const r = Math.min(laneH * 0.36, 16);
        g.beginPath();
        g.roundRect(x0 - r, y - r, w, r * 2, r);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = j ? '#06120b' : '#1a1206';
        g.font = `800 ${Math.round(r * 1.05)}px Bahnschrift, system-ui`;
        g.textAlign = 'left';
        g.fillText(String(b.fret), x0 - r * 0.45, y + r * 0.38);
        if (w > 60) {
          g.font = `600 ${Math.round(r * 0.75)}px Bahnschrift, system-ui`;
          g.fillText(b.name, x0 + r * 0.8, y + r * 0.3);
        }
      });

      // Lo que tocaste (puntos): verde = acierto, cian = nota propia
      for (const p of session.played) {
        const px = x(p.beat);
        if (px < -10 || px > W) continue;
        const s = BASS_STRINGS.reduce((best, open, k) => (p.midi - open >= 0 && p.midi - open <= 15 ? k : best), 0);
        g.fillStyle = p.target !== null ? '#3ee08f' : '#59d0ff';
        g.beginPath();
        g.arc(px, laneY(s) + laneH * 0.32, 4, 0, Math.PI * 2);
        g.fill();
      }

      // Cuenta de entrada
      if (now < 0) {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff';
        g.font = `800 ${Math.round(H * 0.35)}px Bahnschrift, system-ui`;
        g.textAlign = 'center';
        g.fillText(String(Math.max(1, Math.ceil(-now * (tl.clickSec ? tl.beatSec / tl.clickSec : 1)))), W / 2, H * 0.62);
        g.textAlign = 'left';
      }
      // Nota que suena ahora
      if (session.liveMidi !== null) {
        g.fillStyle = 'rgba(89,208,255,0.9)';
        g.font = '700 14px Bahnschrift, system-ui';
        g.textAlign = 'right';
        g.fillText(`Tocas: ${flatsNames(Math.round(session.liveMidi))}`, W - 10, 20);
        g.textAlign = 'left';
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [session, flatsNames]);

  return <canvas ref={canvas} className="highway" />;
}
