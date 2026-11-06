/**
 * Configuración por variables de entorno (archivo .env.local, ver .env.example).
 * Si Supabase no está configurado, la app funciona 100% local (sin cuentas).
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Enlace de donación (p. ej. https://paypal.me/tu-usuario). Vacío = ocultar. */
export const DONATE_URL = (import.meta.env.VITE_DONATE_URL as string | undefined)?.trim() || '';

/**
 * true en las versiones de App Store / Google Play: sus reglas no permiten
 * enlaces de donación externos en apps (salvo ONG registradas), así que se ocultan.
 */
export const STORE_BUILD = import.meta.env.VITE_STORE_BUILD === 'true';

export const showDonations = Boolean(DONATE_URL) && !STORE_BUILD;

/** Texto del botón según la plataforma del enlace. */
export const DONATE_LABEL = /ko-fi\.com/i.test(DONATE_URL)
  ? '☕ Invítame un café en Ko-fi'
  : /paypal\./i.test(DONATE_URL)
    ? 'Donar con PayPal'
    : 'Apoyar el proyecto';
