# Cuentas, donaciones y publicación en todas las plataformas

## 1. Activar las cuentas (Supabase) — 10 minutos

1. Crea una cuenta en <https://supabase.com> → **New project** (plan gratis: 50 000 usuarios activos/mes).
2. **SQL Editor → New query**: pega el contenido de [`supabase/schema.sql`](../supabase/schema.sql) y pulsa **Run**.
   Crea las tablas `profiles`, `songs`, `sessions` con seguridad por usuario (cada quien solo ve lo suyo).
3. **Project Settings → API**: copia **Project URL** y la clave **anon public**.
4. En la carpeta del proyecto, copia `.env.example` como `.env.local` y pega:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   VITE_DONATE_URL=https://paypal.me/tu-usuario
   ```
   La clave *anon* es pública por diseño (va dentro de la app); la protección la da el `schema.sql`. **Nunca** pongas la `service_role` key.
5. **Authentication → URL Configuration**: en *Site URL* y *Redirect URLs* agrega `http://localhost:5174` y, al publicar, tu dominio.
6. (Opcional) **Authentication → Providers → Google**: actívalo con un *OAuth Client* de Google Cloud Console. Sin esto, funciona el inicio de sesión por enlace al correo.
7. Reinicia `npm run dev`.

Sin estos pasos la app funciona igual en **modo local** (todo en el dispositivo, sin cuenta).

## 2. Qué se sincroniza

| Dato | Dónde vive | ¿Se sincroniza? |
|---|---|---|
| Canciones, cifrados, tono original, **mi tono**, tono/rango en que se cantó | `localStorage` + Supabase | Sí |
| Sesiones y medleys guardados | `localStorage` + Supabase | Sí |
| Perfil y rango vocal | `localStorage` + Supabase | Sí |
| Letras descargadas (repertorio para reconocer sin red) | `localStorage` | No (se vuelven a bajar) |
| **Grabaciones de audio** | IndexedDB del dispositivo | **No** (pesan mucho: ~1 MB/min). Se descargan como archivo |

Conflictos: gana el cambio más reciente (`updated`). Borrados: marca `deleted` para que se propaguen.

## 3. Donaciones (no invasivas)

- Tarjeta **«❤ Apoya el proyecto»** en *Cuenta*, con botón de PayPal.
- Un recordatorio pequeño **solo al terminar una grabación**, como máximo **una vez cada 14 días**, y se cierra con ✕.
- Sin anuncios, sin funciones bloqueadas, sin rastreo.
- Si `VITE_DONATE_URL` está vacío, no aparece nada.

### ⚠ Tiendas de apps
- **App Store (iOS)**: Apple no permite enlaces a donaciones externas dentro de apps, salvo para **organizaciones sin fines de lucro registradas**. Para personas, las propinas deben ser compras dentro de la app (Apple se queda 15–30 %).
- **Google Play**: las donaciones deben usar *Google Play Billing*, salvo excepciones (ONG aprobadas).
- Por eso existe `VITE_STORE_BUILD=true`: al compilar para las tiendas **oculta** los botones de donación. La versión web/PWA (instalable desde el navegador) sí puede mostrar PayPal libremente.

## 4. Plataformas

| Plataforma | Cómo | Estado |
|---|---|---|
| Web (cualquier navegador) | Publicar `dist/` en Netlify / Vercel / Cloudflare Pages (gratis, HTTPS obligatorio para el micrófono) | Listo |
| Android, Windows, macOS, ChromeOS | **PWA**: botón «Instalar» en *Cuenta* o menú del navegador | Listo |
| iPhone / iPad | PWA: Safari → Compartir → «Agregar a inicio» | Listo (reconocimiento de voz limitado en Safari) |
| Google Play / App Store | **Capacitor** (`npx cap add android` / `ios`) envolviendo el mismo código | Siguiente paso |

Notas por plataforma:
- **Reconocimiento de letra por voz**: Chrome/Edge (escritorio y Android). Safari iOS lo soporta parcialmente; Brave y Firefox no. Para las apps nativas habrá que usar el reconocedor del sistema vía plugin de Capacitor.
- **Grabación**: Chrome/Edge/Android graban en `webm/opus`; Safari en `m4a`. Ambas funcionan.
- En celulares, la pantalla se mantiene encendida mientras el micrófono está activo (Wake Lock).
