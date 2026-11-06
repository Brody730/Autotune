import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { startSync, stopSync } from './store';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/** Usuario actual (null = sin sesión o nube no configurada). */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let current: string | null = null;
    const apply = (u: User | null) => {
      setUser(u);
      setReady(true);
      if (u && u.id !== current) {
        current = u.id;
        void startSync(u.id);
      } else if (!u && current) {
        current = null;
        stopSync();
      }
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, ready };
}

/** ¿Qué métodos de inicio de sesión están activos en Supabase? */
export function useProviders() {
  const [p, setP] = useState<{ google: boolean; email: boolean } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => r.json())
      .then((s: { external?: { google?: boolean; email?: boolean } }) =>
        setP({ google: !!s.external?.google, email: s.external?.email !== false }),
      )
      .catch(() => setP({ google: false, email: true }));
  }, []);
  return p;
}

const redirectTo = () => window.location.origin + window.location.pathname;

export async function signInWithGoogle() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

/** Enlace mágico: llega un correo con un botón para entrar (sin contraseña). */
export async function signInWithEmail(email: string) {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

export async function signOut() {
  await supabase?.auth.signOut();
}
