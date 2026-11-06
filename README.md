# Live Stage Assistant

**App en vivo:** https://autotune-nu.vercel.app — se publica sola en Vercel con cada cambio en `main`.

Asistencia en vivo para músicos: detección de tonalidad en tiempo real, acordes y teleprompter para escenario.

## Estado

**MVP en marcha**: micrófono → AudioWorklet (YIN) → nota → tonalidad → acordes, más reconocimiento de canción (voz → letra, huella de audio) y letra que sigue al cantante. Ver `docs/CHANGELOG.md`.

- `src/audio/yin.ts` — algoritmo YIN (autocorrelación con interpolación parabólica).
- `src/audio/pitchWorklet.ts` — fuente del AudioWorklet `pitch-detector` (blob module).
- `src/audio/engine.ts` — ciclo de vida: AudioContext, getUserMedia, AudioWorkletNode.
- `src/audio/music.ts` — notas ↔ MIDI, inferencia de tonalidad, acordes.

## Cuentas y publicación

Ver [`docs/CUENTAS_Y_PUBLICACION.md`](docs/CUENTAS_Y_PUBLICACION.md) (Supabase, PayPal, PWA, tiendas).

## Stack

- React 18 + TypeScript + Vite
- PWA (`vite-plugin-pwa`/Workbox) — shell offline + assets estáticos.
- Capacitor — próxima iteración para wrappers nativos iOS/Android.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
