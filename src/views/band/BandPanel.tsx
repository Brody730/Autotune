import { FormEvent, useState } from 'react';
import { Notation } from '../../audio/music';
import { BandEvent, createBand, friendly, joinBand, removeMember, renameBand, updateMember } from '../../band/api';
import { activeBand, bandStore, myMember, useBand } from '../../band/bandStore';
import { ROLES, roleById } from '../../band/roles';
import { cloudEnabled } from '../../lib/config';
import { useStore } from '../../lib/store';
import { Panel } from '../LibraryPanel';
import { Events } from './Events';
import { Vault } from './Vault';

type Tab = 'vault' | 'events' | 'members';

export function BandPanel({
  notation,
  loggedIn,
  onClose,
  onLogin,
  onHostJam,
  onJoinJam,
}: {
  notation: Notation;
  loggedIn: boolean;
  onClose(): void;
  onLogin(): void;
  onHostJam(ev: BandEvent | null): void;
  onJoinJam(): void;
}) {
  const bands = useBand((s) => s.bands);
  const activeId = useBand((s) => s.activeId);
  const loading = useBand((s) => s.loading);
  const error = useBand((s) => s.error);
  const [tab, setTab] = useState<Tab>('events');
  const [setup, setSetup] = useState<'create' | 'join' | null>(null);

  if (!cloudEnabled || !loggedIn) {
    return (
      <Panel title="Ministerio" onClose={onClose}>
        <div className="empty">
          <p className="verse">«Cantadle cántico nuevo; hacedlo bien, tañendo con júbilo.» — Salmo 33:3</p>
          <p>El modo banda une a todo el ministerio de alabanza: bóveda de cifrados compartida, lista de cada servicio y la JAM en vivo en la pantalla de cada integrante.</p>
          <button className="cta" onClick={onLogin}>
            Inicia sesión para empezar
          </button>
        </div>
      </Panel>
    );
  }

  const band = activeBand();

  return (
    <Panel title="Ministerio" onClose={onClose}>
      {error ? <div className="notice-box">⚠ {error}</div> : null}

      {!bands.length || setup ? (
        <BandSetup mode={setup ?? 'create'} setMode={setSetup} hasBands={bands.length > 0} loading={loading} />
      ) : (
        <>
          <div className="band-head">
            <div className="band-pick">
              {bands.length > 1 ? (
                <select value={activeId ?? ''} onChange={(e) => void bandStore.setActive(e.target.value)}>
                  {bands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <h2>{band?.name}</h2>
              )}
              <button className="ctl small" onClick={() => setSetup('join')}>
                + Otra banda
              </button>
            </div>
            <div className="jam-ctas">
              <button className="cta" onClick={() => onHostJam(null)} title="Este dispositivo escucha a la voz principal y lo transmite a todos">
                🎤 Dirigir JAM aquí
              </button>
              <button className="ctl amber" onClick={onJoinJam} title="Ver en tu pantalla lo que se está cantando">
                👥 Unirme a la JAM
              </button>
            </div>
          </div>

          <div className="tabs">
            {(
              [
                ['events', '⛪ Servicios y ensayos'],
                ['vault', '📖 Bóveda de cifrados'],
                ['members', '👥 Integrantes'],
              ] as [Tab, string][]
            ).map(([t, l]) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'vault' ? <Vault notation={notation} /> : null}
          {tab === 'events' ? <Events notation={notation} onUseInJam={(ev) => onHostJam(ev)} /> : null}
          {tab === 'members' ? <Members /> : null}
        </>
      )}
    </Panel>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {ROLES.map((r) => (
        <option key={r.id} value={r.id}>
          {r.icon} {r.label}
        </option>
      ))}
    </select>
  );
}

function BandSetup({
  mode,
  setMode,
  hasBands,
  loading,
}: {
  mode: 'create' | 'join';
  setMode(m: 'create' | 'join' | null): void;
  hasBands: boolean;
  loading: boolean;
}) {
  const profileName = useStore((d) => d.profile.displayName);
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('unirse') ?? '');
  const [me, setMe] = useState(profileName);
  const [role, setRole] = useState('voz');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const b = mode === 'create' ? await createBand(name.trim(), me.trim(), role) : await joinBand(code.trim(), me.trim(), role);
      await bandStore.reloadBands();
      await bandStore.setActive(b.id);
      setMode(null);
    } catch (x) {
      setErr(friendly(x));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty">Cargando…</div>;

  return (
    <div className="band-setup">
      <p className="verse">«Servid a Jehová con alegría; venid ante su presencia con regocijo.» — Salmo 100:2</p>
      <div className="seg">
        <button className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')} type="button">
          Crear ministerio / banda
        </button>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')} type="button">
          Unirme con código
        </button>
      </div>
      <form className="acard" onSubmit={submit}>
        {mode === 'create' ? (
          <label className="field">
            Nombre del ministerio o banda
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Alabanza Iglesia Vida Nueva" />
          </label>
        ) : (
          <label className="field">
            Código de invitación (te lo pasa quien creó la banda)
            <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ej. K7Q2XM" maxLength={8} className="code-input" />
          </label>
        )}
        <label className="field">
          Tu nombre
          <input required value={me} onChange={(e) => setMe(e.target.value)} placeholder="Ej. Ana" />
        </label>
        <label className="field">
          Tu rol
          <RoleSelect value={role} onChange={setRole} />
        </label>
        {err ? <p className="err-text">{err}</p> : null}
        <div className="row-btns">
          <button className="cta" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'create' ? 'Crear' : 'Unirme'}
          </button>
          {hasBands ? (
            <button className="ctl" type="button" onClick={() => setMode(null)}>
              Cancelar
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Members() {
  const membersList = useBand((s) => s.members);
  const userId = useBand((s) => s.userId);
  const band = activeBand();
  const me = myMember();
  const [copied, setCopied] = useState(false);
  if (!band) return null;
  const link = `${location.origin}${location.pathname}?unirse=${band.invite_code}`;
  const share = async () => {
    const text = `Únete a «${band.name}» en Live Stage Assistant. Código: ${band.invite_code}\n${link}`;
    try {
      if (navigator.share) await navigator.share({ title: band.name, text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelado */
    }
  };

  return (
    <>
      <div className="invite">
        <div>
          <small>Código de invitación</small>
          <b className="code">{band.invite_code}</b>
        </div>
        <button className="cta" onClick={() => void share()}>
          {copied ? '✓ Copiado' : '📨 Invitar a la banda'}
        </button>
      </div>
      <div className="list">
        {membersList.map((m) => {
          const r = roleById(m.role);
          const mine = m.user_id === userId;
          return (
            <div key={m.user_id} className="row-item static">
              <span className="avatar sm">{r.icon}</span>
              <div className="ri-main">
                <b>
                  {m.display_name || '(sin nombre)'} {mine ? <em className="muted-text">· tú</em> : null}
                </b>
                <span>
                  {r.label}
                  {m.is_admin ? ' · admin' : ''}
                </span>
              </div>
              {mine ? (
                <RoleSelect
                  value={m.role}
                  onChange={(role) => void updateMember(band.id, m.user_id, { role }).then(() => bandStore.refresh('members')).catch((e) => alert(friendly(e)))}
                />
              ) : me?.is_admin ? (
                <button
                  className="ctl small danger"
                  onClick={() =>
                    confirm(`¿Quitar a ${m.display_name} de la banda?`) &&
                    void removeMember(band.id, m.user_id).then(() => bandStore.refresh('members')).catch((e) => alert(friendly(e)))
                  }
                >
                  Quitar
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="row-btns">
        {me?.is_admin ? (
          <button
            className="ctl"
            onClick={() => {
              const n = prompt('Nuevo nombre del ministerio', band.name);
              if (n?.trim()) void renameBand(band.id, n.trim()).then(() => bandStore.reloadBands());
            }}
          >
            Renombrar
          </button>
        ) : null}
        <button
          className="ctl danger"
          onClick={() => {
            if (!userId || !confirm(`¿Salir de «${band.name}»?`)) return;
            void removeMember(band.id, userId)
              .then(() => bandStore.reloadBands())
              .then(() => bandStore.setActive(bandStore.get().bands.find((b) => b.id !== band.id)?.id ?? null));
          }}
        >
          Salir de la banda
        </button>
      </div>
    </>
  );
}
