import { useState } from 'react';
import { keyLabel, keyUsesFlats, MusicalKey, Notation } from '../../audio/music';
import { inferSheetKey, parseSheet, shiftedKey, transposeSheetRows, transposeSheetText } from '../../song/chords';
import type { KeyRef } from '../../lib/store';
import { keyShiftBetween } from '../../lib/voice';

const mk = (k: KeyRef): MusicalKey => ({ ...k, confidence: 1 });

export function sheetOrigKey(sheet: string, orig: KeyRef | null): KeyRef | null {
  if (orig) return orig;
  const k = inferSheetKey(parseSheet(sheet));
  return k ? { root: k.root, scale: k.scale } : null;
}

/** Semitonos desde el tono original al tono destino (o 0). */
export function shiftTo(orig: KeyRef | null, target: KeyRef | null): number {
  return orig && target ? keyShiftBetween(orig, target) : 0;
}

export function renderSheetText(opts: {
  title: string;
  artist: string;
  sheet: string;
  orig: KeyRef | null;
  shift: number;
  notation: Notation;
}): string {
  const { title, artist, sheet, orig, shift, notation } = opts;
  const target = orig ? shiftedKey(mk(orig), shift) : null;
  const head = [title, artist ? artist : null, target ? `Tono: ${keyLabel(target, notation)}` : null].filter(Boolean).join('\n');
  return `${head}\n\n${transposeSheetText(sheet, shift, notation, keyUsesFlats(target))}\n`;
}

export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Abre una ventana lista para imprimir o «Guardar como PDF». */
export function printText(title: string, text: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px/1.45 Consolas,'Courier New',monospace;margin:24px;color:#111}
pre{white-space:pre-wrap;margin:0 0 28px}h1{font:700 18px system-ui;margin:0 0 4px}
.pb{page-break-after:always}</style></head><body><pre>${esc(text)}</pre>
<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

/** Cifrado en texto tipo LaCuerda / Cifraclub, transportado. */
export function SheetText({
  sheet,
  orig,
  shift,
  notation,
  size = 16,
}: {
  sheet: string;
  orig: KeyRef | null;
  shift: number;
  notation: Notation;
  size?: number;
}) {
  const target = orig ? shiftedKey(mk(orig), shift) : null;
  const rows = transposeSheetRows(sheet, shift, notation, keyUsesFlats(target));
  return (
    <pre className="cifra" style={{ fontSize: size }}>
      {rows.map((r, i) => (
        <span key={i} className={`cr ${r.kind}`}>
          {r.text || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/** Controles de transporte: − / tono / + / original. */
export function TransposeControls({
  orig,
  shift,
  setShift,
  notation,
}: {
  orig: KeyRef | null;
  shift: number;
  setShift(n: number): void;
  notation: Notation;
}) {
  const wrap = (n: number) => {
    let w = ((n % 12) + 12) % 12;
    if (w > 6) w -= 12;
    return w;
  };
  const target = orig ? shiftedKey(mk(orig), shift) : null;
  return (
    <div className="tp-controls">
      <span className="tp-key">
        {orig ? (
          <>
            <small>{shift === 0 ? 'Tono original' : `Original ${keyLabel(mk(orig), notation)} →`}</small>
            <b>{target ? keyLabel(target, notation) : '—'}</b>
          </>
        ) : (
          <small>Tono no detectado (indícalo al editar)</small>
        )}
      </span>
      <span className="tr-btns">
        <button onClick={() => setShift(wrap(shift - 1))} title="Bajar medio tono">
          −½
        </button>
        <button className={shift === 0 ? 'on' : ''} onClick={() => setShift(0)}>
          original
        </button>
        <button onClick={() => setShift(wrap(shift + 1))} title="Subir medio tono">
          +½
        </button>
      </span>
    </div>
  );
}

export function useFontSize(key = 'lsa.cifra.size', def = 16) {
  const [size, setSize] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(key)) || def;
    } catch {
      return def;
    }
  });
  const change = (d: number) => {
    const n = Math.max(11, Math.min(30, size + d));
    setSize(n);
    try {
      localStorage.setItem(key, String(n));
    } catch {
      /* noop */
    }
  };
  return { size, change };
}
