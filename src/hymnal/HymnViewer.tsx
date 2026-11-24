import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keyLabel } from '../audio/music';
import { chordToString, flatsFor, inferSheetKey, shiftedKey, SheetLine } from '../song/chords';
import { ChordLyric, Transpose } from '../song/ChordSheet';
import { hymnStore, useHymns } from './hymnStore';
import { Block, chordPalette, Hymn, simplify, splitSections } from './model';

/**
 * Vista de un himno para tocar: pantalla completa, desplazamiento automático,
 * acordes resaltados, transposición/capo y pedal de pasar página.
 */
export function HymnViewer({
  hymn,
  sequence,
  onNavigate,
  onClose,
  onEdit,
  onStage,
}: {
  hymn: Hymn;
  /** Orden para ← / → (lista del culto, favoritos o todos). */
  sequence: number[];
  onNavigate(num: number): void;
  onClose(): void;
  onEdit(): void;
  /** Mandar al escenario de AutoTune (tono en vivo + letra que sigue al cantante). */
  onStage?(h: Hymn): void;
}) {
  const st = useHymns((d) => d.settings);
  const favs = useHymns((d) => d.favorites);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [capo, setCapo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [speed, setSpeed] = useState(hymn.scroll ?? st.scroll);
  const [progress, setProgress] = useState(0);
  const [isFull, setIsFull] = useState(false);
  const [chrome, setChrome] = useState(true);

  // Cambio de himno: volver arriba y cargar su velocidad
  useEffect(() => {
    setShift(0);
    setPlaying(false);
    setCountdown(0);
    setSpeed(hymn.scroll ?? hymnStore.get().settings.scroll);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [hymn.num]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => splitSections(hymn.text), [hymn.text]);
  const simple = useMemo(
    () => simplify(sections, { collapseChorus: st.collapseChorus, shareVerseChords: st.shareVerseChords }),
    [sections, st.collapseChorus, st.shareVerseChords],
  );
  const origKey = useMemo(() => {
    if (hymn.key) return { ...hymn.key, confidence: 1 };
    return inferSheetKey(sections.flatMap((s) => s.lines));
  }, [hymn.key, sections]);
  const soundingKey = origKey ? shiftedKey(origKey, shift) : null;
  const shapeShift = shift - capo;
  const t: Transpose = { shift: shapeShift, notation: st.notation, flats: flatsFor(origKey ? shiftedKey(origKey, shapeShift) : null) };
  const palette = useMemo(() => chordPalette(sections, t.shift, t.notation, t.flats), [sections, t.shift, t.notation, t.flats]);

  // ── Desplazamiento automático ──
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      const el = scrollRef.current;
      if (!el) return;
      acc += ((now - last) / 1000) * speed;
      last = now;
      if (acc >= 1) {
        const px = Math.floor(acc);
        acc -= px;
        el.scrollTop += px;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setTimeout(() => {
      if (countdown === 1) setPlaying(true);
      setCountdown((c) => c - 1);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [countdown]);

  const togglePlay = useCallback(() => {
    if (playing || countdown > 0) {
      setPlaying(false);
      setCountdown(0);
      return;
    }
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTo({ top: 0 });
    const lead = hymnStore.get().settings.leadIn;
    if (lead > 0 && (el?.scrollTop ?? 0) < 4) setCountdown(lead);
    else setPlaying(true);
  }, [playing, countdown]);

  const changeSpeed = useCallback(
    (d: number) => {
      setSpeed((s) => {
        const v = Math.max(4, Math.min(160, Math.round(s + d)));
        hymnStore.setScroll(hymn.num, v);
        return v;
      });
    },
    [hymn.num],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? el.scrollTop / max : 0);
  };

  // ── Pantalla completa + pantalla siempre encendida ──
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => setIsFull((f) => !f));
  }, []);
  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    const req = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    void req();
    const vis = () => document.visibilityState === 'visible' && void req();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // ── Navegación ──
  const idx = sequence.indexOf(hymn.num);
  const prev = idx > 0 ? sequence[idx - 1] : null;
  const next = idx >= 0 && idx < sequence.length - 1 ? sequence[idx + 1] : null;

  // Teclado y pedales Bluetooth (mandan PageDown/PageUp, flechas o espacio)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      const el = scrollRef.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'PageDown':
          e.preventDefault();
          el?.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
          break;
        case 'PageUp':
          e.preventDefault();
          el?.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'smooth' });
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeSpeed(4);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeSpeed(-4);
          break;
        case 'ArrowRight':
          if (next) onNavigate(next);
          break;
        case 'ArrowLeft':
          if (prev) onNavigate(prev);
          break;
        case '+':
        case '=':
          hymnStore.settings({ fontSize: Math.min(64, st.fontSize + 2) });
          break;
        case '-':
          hymnStore.settings({ fontSize: Math.max(14, st.fontSize - 2) });
          break;
        case 'f':
        case 'F':
          toggleFull();
          break;
        case 'Escape':
          if (!document.fullscreenElement) onClose();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, changeSpeed, next, prev, onNavigate, onClose, toggleFull, st.fontSize]);

  const fav = favs.includes(hymn.num);
  const cls = [
    'hv',
    st.light ? 'light' : '',
    st.accent ? 'accent' : '',
    !st.showChords ? 'no-chords' : '',
    isFull ? 'full' : '',
    chrome ? '' : 'bare',
  ].join(' ');

  return (
    <div ref={rootRef} className={cls} role="dialog" aria-label={`Himno ${hymn.num}: ${hymn.title}`}>
      <div className="hv-progress" style={{ transform: `scaleX(${progress})` }} />
      <header className="hv-top">
        <button className="ctl icon" onClick={onClose} aria-label="Cerrar himno" title="Cerrar (Esc)">
          ✕
        </button>
        <button className="ctl icon" disabled={!prev} onClick={() => prev && onNavigate(prev)} aria-label="Himno anterior" title="Anterior (←)">
          ‹
        </button>
        <div className="hv-title">
          <span className="hv-num">{hymn.num}</span>
          <span className="hv-name">{hymn.title}</span>
        </div>
        <button className="ctl icon" disabled={!next} onClick={() => next && onNavigate(next)} aria-label="Himno siguiente" title="Siguiente (→)">
          ›
        </button>
        <button className={`ctl icon ${fav ? 'active' : ''}`} onClick={() => hymnStore.toggleFavorite(hymn.num)} aria-label="Favorito" aria-pressed={fav}>
          {fav ? '★' : '☆'}
        </button>
        <button className="ctl icon" onClick={toggleFull} aria-label="Pantalla completa" title="Pantalla completa (F)">
          {isFull ? '⤡' : '⤢'}
        </button>
      </header>

      {chrome ? (
        <div className="hv-tools">
          <div className="hv-group" aria-label="Tono">
            <span className="hv-lbl">Tono</span>
            <button className="ctl small" onClick={() => setShift((s) => (s <= -6 ? 5 : s - 1))} aria-label="Bajar medio tono">
              −½
            </button>
            <b className="hv-key">{soundingKey ? keyLabel(soundingKey, st.notation) : '—'}</b>
            <button className="ctl small" onClick={() => setShift((s) => (s >= 6 ? -5 : s + 1))} aria-label="Subir medio tono">
              +½
            </button>
            {shift ? (
              <button className="ctl small" onClick={() => setShift(0)} title="Volver al tono original">
                Orig.
              </button>
            ) : null}
          </div>
          <div className="hv-group">
            <label className="hv-lbl">
              Capo
              <select value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i}>
                    {i || '—'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="hv-group">
            <button className="ctl small" onClick={() => hymnStore.settings({ fontSize: Math.max(14, st.fontSize - 2) })} aria-label="Letra más chica">
              A−
            </button>
            <button className="ctl small" onClick={() => hymnStore.settings({ fontSize: Math.min(64, st.fontSize + 2) })} aria-label="Letra más grande">
              A+
            </button>
            <button
              className="ctl small"
              onClick={() => hymnStore.settings({ notation: st.notation === 'latin' ? 'english' : 'latin' })}
              title="Cambiar notación"
            >
              {st.notation === 'latin' ? 'Do Re Mi' : 'C D E'}
            </button>
          </div>
          <div className="hv-group">
            <Toggle on={st.collapseChorus && st.shareVerseChords} onClick={() => {
              const v = !(st.collapseChorus && st.shareVerseChords);
              hymnStore.settings({ collapseChorus: v, shareVerseChords: v });
            }}>
              Simplificado
            </Toggle>
            <Toggle on={st.accent} onClick={() => hymnStore.settings({ accent: !st.accent })}>
              Resaltar acordes
            </Toggle>
            <Toggle on={st.chordsOnly} onClick={() => hymnStore.settings({ chordsOnly: !st.chordsOnly })}>
              Solo acordes
            </Toggle>
            <Toggle on={!st.showChords} onClick={() => hymnStore.settings({ showChords: !st.showChords })}>
              Solo letra
            </Toggle>
            <Toggle on={st.light} onClick={() => hymnStore.settings({ light: !st.light })}>
              Claro
            </Toggle>
          </div>
          <div className="hv-group">
            <button className="ctl small" onClick={onEdit}>
              ✎ Editar
            </button>
            {onStage ? (
              <button className="ctl small" onClick={() => onStage(hymn)} title="Abrir en el escenario: tono en vivo y letra que sigue al cantante">
                🎤 Escenario
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {chrome && st.showChords && palette.length ? (
        <div className="hv-palette" aria-label="Acordes del himno">
          {palette.map((c) => (
            <span key={c} className="hv-chip">
              {c}
            </span>
          ))}
          {capo ? <span className="hv-note">Capo {capo} · suena en {soundingKey ? keyLabel(soundingKey, st.notation) : ''}</span> : null}
        </div>
      ) : null}

      <div ref={scrollRef} className="hv-body" onScroll={onScroll} onClick={togglePlay} style={{ fontSize: st.fontSize }}>
        {simple.notes.length && chrome ? <div className="hv-notes">{simple.notes.join(' · ')}</div> : null}
        {simple.blocks.map((b, i) => (
          <BlockView key={i} b={b} t={t} chordsOnly={st.chordsOnly && st.showChords} />
        ))}
        <div className="hv-end">— Fin —{next ? ' · toca › para el siguiente' : ''}</div>
      </div>

      {countdown > 0 ? <div className="hv-countdown">{countdown}</div> : null}

      <footer className="hv-bar">
        <button className="ctl small" onClick={() => setChrome((c) => !c)} title="Ocultar controles">
          {chrome ? '▾ Ocultar' : '▴ Controles'}
        </button>
        <button className="ctl small" onClick={() => changeSpeed(-4)} aria-label="Más lento">
          🐢
        </button>
        <button className={`cta hv-play ${playing ? 'on' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pausar desplazamiento' : 'Desplazar automáticamente'}>
          {playing || countdown ? '❚❚' : '▶'}
        </button>
        <button className="ctl small" onClick={() => changeSpeed(4)} aria-label="Más rápido">
          🐇
        </button>
        <span className="hv-speed" title="Velocidad (se guarda por himno)">
          {speed} px/s
        </span>
      </footer>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button className={`ctl small ${on ? 'active' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function ChordsOnlyLine({ line, t }: { line: SheetLine; t: Transpose }) {
  if (!line.chords.length) return null;
  return (
    <div className="hv-bars">
      {line.chords.map((c, i) => (
        <span key={i} className="hv-barchord">
          {chordToString(c.chord, t.shift, t.notation, t.flats)}
        </span>
      ))}
    </div>
  );
}

function BlockView({ b, t, chordsOnly }: { b: Block; t: Transpose; chordsOnly: boolean }) {
  if (b.type === 'repeat') {
    return (
      <div className="hv-repeat">
        ↻ {b.label}
        {b.times > 1 ? ` ×${b.times}` : ''}
      </div>
    );
  }
  const s = b.section;
  return (
    <section className={`hv-sec k-${s.kind}`}>
      <div className="hv-sec-label">
        {s.label}
        {b.sameChordsAs ? <span className="hv-same"> · acordes de {b.sameChordsAs}</span> : null}
        {b.inherited ? <span className="hv-same"> · acordes de la estrofa 1</span> : null}
      </div>
      {chordsOnly
        ? s.lines.map((l, i) => <ChordsOnlyLine key={i} line={l} t={t} />)
        : s.lines.map((l, i) =>
            l.chords.length ? (
              <ChordLyric key={i} line={l} t={t} className={b.inherited ? 'inherited' : ''} />
            ) : (
              <div key={i} className="hv-lyric">
                {l.lyric.trim()}
              </div>
            ),
          )}
      {chordsOnly && b.sameChordsAs ? <div className="hv-same">(igual que {b.sameChordsAs})</div> : null}
    </section>
  );
}
