import { FormEvent, useEffect, useRef, useState } from 'react';
import { Notation } from '../audio/music';
import { signInWithEmail, signInWithGoogle, signOut, useAuth } from '../lib/auth';
import { cloudEnabled, DONATE_LABEL, DONATE_URL, showDonations } from '../lib/config';
import { store, useStore, useSyncState } from '../lib/store';
import { Panel } from './LibraryPanel';
import { noteLabel } from './SongDetail';
import { useInstallPrompt } from '../lib/install';

export function AccountPanel({
  notation,
  liveMidi,
  onClose,
}: {
  notation: Notation;
  liveMidi: number | null;
  onClose(): void;
}) {
  const { user } = useAuth();
  const sync = useSyncState();
  const profile = useStore((d) => d.profile);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const install = useInstallPrompt();

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <Panel title="Cuenta" onClose={onClose}>
      <div className="account-grid">
        {/* ── Sesión ─────────────────── */}
        <section className="acard">
          <h3>Tu cuenta</h3>
          {!cloudEnabled ? (
            <p className="muted-text">
              Modo local: tus canciones, medleys y grabaciones se guardan en este dispositivo. Las cuentas (para sincronizar
              entre celular y computadora) se activan cuando se configure el servidor.
            </p>
          ) : user ? (
            <>
              <div className="who">
                <span className="avatar">{(profile.displayName || user.email || '?').slice(0, 1).toUpperCase()}</span>
                <div>
                  <b>{profile.displayName || user.email}</b>
                  <span className={`sync ${sync}`}>
                    {sync === 'syncing' ? 'Sincronizando…' : sync === 'ok' ? '✓ Sincronizado' : sync === 'error' ? '⚠ Error al sincronizar' : ''}
                  </span>
                </div>
              </div>
              <button className="ctl" onClick={() => void signOut()}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <p className="muted-text">Crea tu cuenta gratis para tener tu repertorio, tus tonos y tus medleys en todos tus dispositivos.</p>
              <button className="cta google" onClick={() => void signInWithGoogle().catch((x) => setErr((x as Error).message))}>
                Continuar con Google
              </button>
              <div className="or">o con tu correo (sin contraseña)</div>
              {sent ? (
                <p className="ok-text">📧 Te enviamos un enlace a {email}. Ábrelo en este dispositivo para entrar.</p>
              ) : (
                <form className="email-form" onSubmit={sendLink}>
                  <input type="email" required placeholder="tu@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button className="ctl" type="submit">
                    Enviar enlace
                  </button>
                </form>
              )}
              {err ? <p className="err-text">{err}</p> : null}
            </>
          )}
          <label className="field">
            Nombre (como te verán en la app)
            <input
              defaultValue={profile.displayName}
              placeholder="Ej. Carlos — guitarra"
              onBlur={(e) => e.target.value !== profile.displayName && store.setProfile({ displayName: e.target.value.trim() })}
            />
          </label>
        </section>

        {/* ── Rango vocal ────────────── */}
        <section className="acard">
          <h3>Mi rango vocal</h3>
          <p className="muted-text">Con tu rango, la biblioteca te sugiere en qué tono cantar cada canción.</p>
          <div className="range-show">
            <span>
              <small>Grave</small>
              <b>{noteLabel(profile.vocalLow, notation)}</b>
            </span>
            <span className="range-bar" />
            <span>
              <small>Aguda</small>
              <b>{noteLabel(profile.vocalHigh, notation)}</b>
            </span>
          </div>
          {testing ? (
            <RangeTest notation={notation} liveMidi={liveMidi} onDone={() => setTesting(false)} />
          ) : (
            <button className="cta" onClick={() => setTesting(true)}>
              🎤 {profile.vocalLow === null ? 'Medir mi rango' : 'Volver a medir'}
            </button>
          )}
        </section>

        {/* ── Instalar ───────────────── */}
        <section className="acard">
          <h3>Instalar la app</h3>
          <p className="muted-text">Funciona en celular, tablet y computadora, también sin internet (excepto la búsqueda de canciones).</p>
          {install.canPrompt ? (
            <button className="cta" onClick={() => void install.prompt()}>
              ⬇ Instalar Live Stage Assistant
            </button>
          ) : install.installed ? (
            <p className="ok-text">✓ Ya está instalada en este dispositivo.</p>
          ) : install.ios ? (
            <p className="muted-text">
              En iPhone/iPad: abre esta página en Safari, toca <b>Compartir</b> ⬆ y luego <b>«Agregar a inicio»</b>.
            </p>
          ) : (
            <p className="muted-text">Usa el menú del navegador → «Instalar aplicación» / «Agregar a pantalla de inicio».</p>
          )}
        </section>

        {/* ── Apoyo ──────────────────── */}
        {showDonations ? (
          <section className="acard support">
            <h3>❤ Apoya el proyecto</h3>
            <p>
              Live Stage Assistant es <b>gratis y sin anuncios</b>, y así seguirá. Si te sirve en tu iglesia o banda, puedes
              apoyar su desarrollo con lo que quieras.
            </p>
            <a className={`cta ${/ko-fi/i.test(DONATE_URL) ? 'kofi' : 'paypal'}`} href={DONATE_URL} target="_blank" rel="noreferrer">
              {DONATE_LABEL}
            </a>
          </section>
        ) : null}

        {/* ── Datos ──────────────────── */}
        <section className="acard">
          <h3>Tus datos</h3>
          <p className="muted-text">Copia de seguridad de canciones, cifrados, tonos y medleys (las grabaciones se descargan aparte).</p>
          <BackupButtons />
        </section>
      </div>
    </Panel>
  );
}

function BackupButtons() {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const exportData = () => {
    const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `live-stage-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importData = async (f: File) => {
    try {
      const d = JSON.parse(await f.text()) as ReturnType<typeof store.get>;
      let n = 0;
      for (const s of Object.values(d.songs ?? {})) {
        const cur = store.get().songs[s.key];
        if (!cur || s.updated > cur.updated) {
          store.upsertSong(s.key, s.title, s.artist, s);
          n++;
        }
      }
      for (const s of Object.values(d.sessions ?? {})) {
        const cur = store.get().sessions[s.id];
        if (!cur || s.updated > cur.updated) {
          store.upsertSession(s);
          n++;
        }
      }
      setMsg(`✓ ${n} elementos importados`);
    } catch {
      setMsg('⚠ Archivo no válido');
    }
  };
  return (
    <div className="row-btns">
      <button className="ctl" onClick={exportData}>
        ⬇ Exportar respaldo
      </button>
      <button className="ctl" onClick={() => file.current?.click()}>
        ⬆ Importar
      </button>
      <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
      {msg ? <span className="muted-text">{msg}</span> : null}
    </div>
  );
}

/** Prueba de rango: canta tu nota más grave y luego la más aguda (cómodas). */
function RangeTest({ notation, liveMidi, onDone }: { notation: Notation; liveMidi: number | null; onDone(): void }) {
  const [step, setStep] = useState<'low' | 'high'>('low');
  const counts = useRef(new Map<number, number>());
  const [captured, setCaptured] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(null);

  useEffect(() => {
    if (liveMidi === null) return;
    const m = Math.round(liveMidi);
    const c = counts.current;
    c.set(m, (c.get(m) ?? 0) + 1);
    // Solo cuentan notas sostenidas (≥ ~0.3 s), no deslices
    const held = [...c.entries()].filter(([, n]) => n >= 12).map(([k]) => k);
    if (held.length) setCaptured(step === 'low' ? Math.min(...held) : Math.max(...held));
  }, [liveMidi, step]);

  const next = () => {
    if (captured === null) return;
    if (step === 'low') {
      setLow(captured);
      setStep('high');
      counts.current = new Map();
      setCaptured(null);
    } else {
      const lo = Math.min(low!, captured);
      const hi = Math.max(low!, captured);
      store.setProfile({ vocalLow: lo, vocalHigh: hi });
      onDone();
    }
  };

  return (
    <div className="range-test">
      <p>
        {step === 'low' ? (
          <>
            <b>1/2</b> Canta «aaa» y baja hasta tu nota <b>más grave cómoda</b>. Sostenla un momento.
          </>
        ) : (
          <>
            <b>2/2</b> Ahora sube hasta tu nota <b>más aguda cómoda</b> (sin forzar).
          </>
        )}
      </p>
      <div className="rt-now">
        <span>
          <small>Ahora</small>
          <b>{noteLabel(liveMidi, notation)}</b>
        </span>
        <span>
          <small>{step === 'low' ? 'Más grave' : 'Más aguda'}</small>
          <b className="amber">{noteLabel(captured, notation)}</b>
        </span>
      </div>
      <div className="row-btns">
        <button className="ctl" onClick={onDone}>
          Cancelar
        </button>
        <button
          className="ctl"
          onClick={() => {
            counts.current = new Map();
            setCaptured(null);
          }}
        >
          Repetir
        </button>
        <button className="cta" disabled={captured === null} onClick={next}>
          {step === 'low' ? 'Siguiente →' : 'Guardar rango'}
        </button>
      </div>
    </div>
  );
}
