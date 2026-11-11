import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Recorrido de bienvenida: ilumina cada parte de la app y explica para qué
 * sirve. Se muestra solo la primera vez (se recuerda en este dispositivo) y
 * se puede repetir con el botón «?» de la barra superior.
 */

const DONE_KEY = 'lsa.tour.done';

export function tourPending(): boolean {
  try {
    return !localStorage.getItem(DONE_KEY);
  } catch {
    return false;
  }
}

function markDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* noop */
  }
}

interface Step {
  /** Selector del elemento a iluminar (sin él, el mensaje va al centro). */
  target?: string;
  emoji: string;
  title: string;
  body: string;
  tips?: string[];
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: 'Bienvenido a Live Stage Assistant',
    body: 'Tu asistente para cantar y tocar en vivo: escucha lo que suena y te muestra el tono, los acordes y la letra. Te enseño todo en un minuto.',
    tips: ['El navegador te pedirá permiso para usar el micrófono: acéptalo, la app lo necesita para escucharte.'],
  },
  {
    target: '[data-tour="hero"]',
    emoji: '🎤',
    title: 'Nota en vivo y afinador',
    body: 'Canta o toca: aquí aparece en grande la nota que suena y, debajo, la aguja te dice si vas bajo (♭) o alto (♯).',
    tips: ['Cuando la app reconoce la canción, la letra aparece aquí mismo y avanza contigo.'],
  },
  {
    target: '[data-tour="key"]',
    emoji: '🎼',
    title: 'Tonalidad',
    body: 'Después de unos segundos cantando, la app deduce en qué tono estás y muestra las notas de la escala.',
    tips: ['Con el candado 🔓/🔒 fijas el tono para que no cambie a media canción.'],
  },
  {
    target: '[data-tour="chord"]',
    emoji: '🎹',
    title: 'Acordes',
    body: 'Te sugiere el acorde que acompaña la nota que suena. Si la canción tiene cifrado, lo muestra ya transportado al tono en que estás cantando.',
    tips: ['Con − / auto / + subes o bajas el tono a mano.'],
  },
  {
    target: '[data-tour="harmony"]',
    emoji: '🧭',
    title: 'Campo armónico',
    body: 'Los siete acordes del tono (I, IV, V…) para improvisar o acompañar sin cifrado. Se iluminan los que combinan con la nota actual.',
  },
  {
    target: '[data-tour="song"]',
    emoji: '🔎',
    title: 'Reconocer la canción',
    body: 'La app reconoce la alabanza por lo que se canta y trae su letra. También puedes buscarla por nombre o identificar una grabación que esté sonando.',
    tips: ['Con el botón de acordes agregas el cifrado de esa canción.'],
  },
  {
    target: '[data-tour="rec"]',
    emoji: '⏺',
    title: 'Grabar en vivo',
    body: 'Graba el ensayo o el servicio con un toque. La grabación se guarda en tu dispositivo, con una marca en cada canción.',
  },
  {
    target: '[data-tour="band"]',
    emoji: '👥',
    title: 'Banda',
    body: 'Crea tu ministerio e invita a los integrantes: arma servicios y ensayos, comparte la bóveda de cifrados y dirige un JAM donde todos ven el mismo tono y las señales (coro, puente, final…).',
    tips: ['Necesita una cuenta gratuita.'],
  },
  {
    target: '[data-tour="library"]',
    emoji: '📚',
    title: 'Biblioteca',
    body: 'Todo lo que has cantado queda aquí: canciones con el tono en que las cantaste, medleys y sesiones para repetir, y tus grabaciones.',
  },
  {
    target: '[data-tour="practice"]',
    emoji: '🎮',
    title: 'Práctica',
    body: 'Toca tu bajo sobre una pista (norteña, cumbia, rock…) al estilo Guitar Hero: la app escucha cada nota, te da puntaje y graba tu toma.',
    tips: ['Necesita una canción con acordes en tu biblioteca o en la bóveda.'],
  },
  {
    target: '[data-tour="stems"]',
    emoji: '🎚',
    title: 'Pistas',
    body: 'Pega un enlace de YouTube y la app separa voz, batería, bajo y demás, detecta acordes y notas, y te deja practicar sobre la grabación original silenciando tu instrumento.',
    tips: ['Solo en computadora: usa un programa («motor de pistas») instalado en tu PC. En el celular todavía no está disponible.'],
  },
  {
    target: '[data-tour="account"]',
    emoji: '👤',
    title: 'Cuenta',
    body: 'Sin cuenta todo funciona y se guarda en este dispositivo. Con cuenta, tus canciones y sesiones se sincronizan entre tus dispositivos.',
    tips: ['Aquí también mides tu rango vocal e instalas la app en tu pantalla de inicio.'],
  },
  {
    target: '[data-tour="controls"]',
    emoji: '⚙️',
    title: 'Ajustes rápidos',
    body: 'Elige el micrófono o la interfaz de audio, cambia entre Do-Re-Mi y C-D-E, reinicia la tonalidad (↺) o pon la pantalla completa (⛶).',
  },
  {
    emoji: '🙌',
    title: '¡Listo!',
    body: 'Empieza a cantar y la app hace el resto.',
    tips: ['Puedes repetir este recorrido cuando quieras con el botón «?» de la barra superior.'],
  },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour({ onClose }: { onClose(): void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  const finish = useCallback(() => {
    markDone();
    onClose();
  }, [onClose]);

  // Medir el elemento iluminado (y volver a medir si cambia la pantalla)
  useLayoutEffect(() => {
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (!el) {
      setBox(null);
      return;
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return setBox(null);
      const pad = 6;
      setBox({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };
    measure();
    const t = window.setTimeout(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step.target]);

  // Colocar la tarjeta junto al elemento sin salirse de la pantalla
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = c.offsetWidth;
    const ch = c.offsetHeight;
    const m = 12;
    if (!box) return setCardPos({ top: Math.max(m, (vh - ch) / 2), left: Math.max(m, (vw - cw) / 2) });
    const below = box.top + box.height + m;
    const above = box.top - ch - m;
    // Debajo si cabe; si no, arriba; si tampoco, encima del elemento pegada al borde inferior
    const centered = Math.max(m, Math.min(vw - cw - m, box.left + box.width / 2 - cw / 2));
    if (below + ch <= vh - m) return setCardPos({ top: below, left: centered });
    if (above >= m) return setCardPos({ top: above, left: centered });
    // Elemento alto: a un lado si cabe
    const midY = Math.max(m, Math.min(vh - ch - m, box.top + box.height / 2 - ch / 2));
    const right = box.left + box.width + m;
    const leftSide = box.left - cw - m;
    if (right + cw <= vw - m) return setCardPos({ top: midY, left: right });
    if (leftSide >= m) return setCardPos({ top: midY, left: leftSide });
    setCardPos({ top: Math.max(m, vh - ch - m), left: centered });
  }, [box, i]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') i < STEPS.length - 1 ? setI(i + 1) : finish();
      else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [i, finish]);

  const last = i === STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Recorrido de bienvenida">
      {box ? <div className="tour-hole" style={box} /> : <div className="tour-dim" />}
      <div ref={card} className="tour-card" style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: 'hidden' }}>
        <div className="tour-top">
          <span className="tour-emoji">{step.emoji}</span>
          <span className="tour-count">
            {i + 1} / {STEPS.length}
          </span>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.tips?.length ? (
          <ul>
            {step.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
        <div className="tour-bar">
          <div style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="tour-btns">
          {!last ? (
            <button className="ctl small" onClick={finish}>
              Saltar
            </button>
          ) : null}
          <span className="tour-spacer" />
          {i > 0 ? (
            <button className="ctl" onClick={() => setI(i - 1)}>
              ← Atrás
            </button>
          ) : null}
          <button className="cta" onClick={() => (last ? finish() : setI(i + 1))} autoFocus>
            {last ? '¡Empezar!' : i === 0 ? 'Ver el recorrido →' : 'Siguiente →'}
          </button>
        </div>
      </div>
    </div>
  );
}
