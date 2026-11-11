# Motor de pistas

Programa local que usa la pantalla **🎚 Pistas** de Live Stage Assistant:

```
enlace de YouTube → yt-dlp → ffmpeg → Demucs (voz · batería · bajo · guitarra · piano · otros)
                  → análisis (tempo, tono, acordes, notas del bajo, melodía) → MP3 por pista
```

Corre en tu PC (no en Vercel) porque necesita Python, ~2 GB de librerías y, de preferencia, una tarjeta NVIDIA. La página —local o la publicada— se conecta sola a `http://127.0.0.1:8765`.

## Uso

1. **Una sola vez:** doble clic en `instalar.bat` (descarga ~3 GB; todo queda dentro de esta carpeta).
2. **Cada vez que quieras separar canciones:** doble clic en `iniciar.bat` y deja la ventana abierta.
3. En la app: **🎚 Pistas** → pega el enlace de YouTube → **✂ Separar**.

Las canciones ya separadas quedan guardadas en el navegador: se pueden practicar sin el motor. El motor solo hace falta para separar canciones nuevas, cambiar tono/velocidad y generar el ZIP.

> **Celular:** por ahora no funciona. El motor corre solo en la PC y las pistas se guardan en el navegador de esa PC; no se sincronizan con el teléfono. La app lo avisa al abrir 🎚 Pistas desde un celular.

Si YouTube deja de descargar, abre `actualizar-youtube.bat`.

## Carpetas (no se suben a git)

| Carpeta | Qué guarda |
|---|---|
| `.venv`, `python`, `bin` | Python privado y librerías |
| `models` | Modelos de Demucs (se bajan la primera vez, ~80 MB cada uno) |
| `data` | Audios separados y su análisis (bórrala para liberar espacio) |

Para desinstalar, borra esas carpetas.

## Seguridad y uso

- Solo escucha en `127.0.0.1` y solo acepta peticiones de la app (`https://autotune-nu.vercel.app` y `localhost`). Otros orígenes: variable `LSA_STEMS_ORIGINS` (separados por coma).
- Solo acepta enlaces de YouTube, de hasta 15 minutos.
- Es para **uso personal**: descarga solo música que tengas derecho a usar.

## API

| Ruta | |
|---|---|
| `GET /health` | Estado y dispositivo (GPU/CPU) |
| `POST /jobs` `{url, model: "4"\|"6"}` | Encola una canción |
| `POST /jobs/file?model=4` | Igual, con un archivo de audio como cuerpo |
| `GET /jobs/{id}` | Avance |
| `GET /tracks/{id}/stem/{pista}.mp3?semitones=&speed=` | Audio de una pista (con tono/velocidad) |
| `POST /tracks/{id}/download` | ZIP: mezcla, pistas, `notas.txt`, `cifrado.txt`, `notas.mid` |
| `DELETE /tracks/{id}` | Borra la canción del motor |
