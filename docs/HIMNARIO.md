# 📖 Himnario «Himnos de Gloria y Triunfo»

Módulo del Live Stage Assistant (AutoTune) para tocar los himnos del 1 al 329 con letra y acordes, **sin internet**.

## Por qué la app no trae las letras

- La compilación del himnario y muchas de sus traducciones al español tienen derechos de **Editorial Vida**. Aunque muchos himnos originales son antiguos, la traducción o el arreglo que trae el himnario puede no ser de dominio público.
- Los cifrados de AcordesWeb, Cifra Club y LaCuerda son aportes de sus usuarios. Cada sitio tiene sus términos y no permiten copiarlos en masa para meterlos en otra app.
- Por eso la app trae el **motor** (visor, simplificación, transposición y desplazamiento), y cada iglesia o músico carga los himnos que tiene derecho a usar. Esto es lo mismo que ya hacía «Biblioteca» con los cifrados pegados.
- **Para publicarla en Play Store con las letras incluidas** hay que pedirle permiso por escrito a Editorial Vida (HarperCollins Christian Publishing) o usar solo himnos de dominio público. Las dos apps que ya están en la tienda no dicen tener licencia, así que no conviene tomarlas como ejemplo.

## Cómo cargar los himnos

1. **Uno por uno**: 📖 Himnario → toca un número «Sin cargar» → pega la letra con acordes → 🧹 *Limpiar pegado* (quita publicidad, «Tono:», tablaturas) → Guardar.
2. **De golpe**: llena [`himnario-plantilla.txt`](himnario-plantilla.txt) (ya tiene los encabezados `### 1` … `### 329`) → ⤓ Importar. Los números que dejes vacíos se ignoran.
3. **Archivos sueltos**: `.txt` o ChordPro (`.cho`) con el número en el nombre (`012 Título.cho`) o la directiva `{number: 12}`.
4. **De otro músico**: ⤒ *Respaldo .json* en un equipo → ⤓ *Importar* en el otro. Así lo carga una sola persona y lo comparte con la banda.

### Formato de un himno

```
Tono: Sol
1. Sol            Do        Sol
   primera línea de la estrofa…
              Re           Sol
   segunda línea…

Coro:
Do             Sol
línea del coro…

2. letra de la segunda estrofa (sin acordes)…
```

- Las partes se marcan con `[Estrofa 1]`, `[Coro]`, `Coro:` o numerando `1.` `2.` como en el himnario impreso. Si no se marca nada, el bloque que se repite se toma como coro.
- **Basta escribir el coro una vez y los acordes solo en la primera estrofa.** La app hace lo demás:
  - *Simplificado* (por defecto): el coro aparece una vez y luego como «↻ Coro ×N». Las estrofas con la misma progresión salen sin acordes y con la nota «acordes de Estrofa 1».
  - *Simplificado apagado*: los acordes de la estrofa 1 se ponen palabra por palabra en todas las estrofas.
- También se acepta `[Sol]letra` (ChordPro) y notación americana (`G`, `C`, `D7`).

## Pensado para el músico

| Necesidad | Qué hace la app |
|---|---|
| Tocar sin tocar la pantalla | Desplazamiento automático con cuenta regresiva; la velocidad se guarda **por himno** |
| Pasar página con el pie | Pedales Bluetooth: PageDown/PageUp avanzan una pantalla, ←/→ cambian de himno |
| Ver bien los acordes | Acordes resaltados y modo *Solo acordes* (compases) |
| Proyector / congregación | Modo *Solo letra* |
| Al aire libre | Tema *Claro* |
| Tono del cantante | Transponer por medio tono y capo (muestra en qué tono suena) |
| Que no se apague la pantalla | Wake Lock mientras el himno está abierto |
| Culto del domingo | *Lista del culto* ordenable; ←/→ siguen ese orden |
| Afinador / tono en vivo | 🎤 *Escenario* manda el himno al escenario de AutoTune (detección de tono en vivo y letra que sigue al cantante) |

## Lo que se mejoró frente a las apps de Play Store

Revisión del 2026-11-23:

- *Himnos De Gloria y Triunfo* (Spirit Bible Apps, 4.4★, más de 50 mil descargas) y *Himnario de Gloria y Triunfo* (Digital Wolf, 4.7★, más de un millón de descargas): **solo traen letra, sin acordes**, y las dos tienen anuncios.
- Quejas de los usuarios, y qué hace esta app con cada una:
  - El tamaño de letra no se queda guardado → aquí todos los ajustes se guardan.
  - La app tarda en abrir y a veces se traba → aquí todo está en el dispositivo, sin anuncios ni red.
  - Hay errores en la letra (p. ej. «clama» por «calma» en el 115) → aquí cada himno se puede corregir con ✎ Editar.
  - Faltan himnos → aquí se pueden agregar.
  - Molestan los anuncios → aquí no hay ninguno.

## Rumbo al APK (todavía no se genera)

La app ya es una PWA offline: se puede instalar desde el navegador («Agregar a pantalla principal») y los himnos viven en el dispositivo. Para el APK:

1. `npm i @capacitor/core @capacitor/cli @capacitor/android` y `npx cap init "Himnos de Gloria y Triunfo" com.<tuorg>.himnario --web-dir dist`.
2. Agregar `@capacitor-community/keep-awake` (pantalla encendida nativa) y `@capacitor/filesystem` (importar y exportar respaldos desde el almacenamiento del teléfono).
3. Que el APK abra directo en el himnario: usar la ruta `?vista=himnario` o una compilación aparte con `HymnalPanel` como inicio.
4. `npm run build && npx cap sync android && npx cap open android` → generar el APK firmado en Android Studio.
5. Si va a la Play Store con letras incluidas, primero hay que tener la licencia (ver arriba).

## Archivos

- `src/hymnal/model.ts`: secciones, simplificación, proyección de acordes y texto para el escenario.
- `src/hymnal/hymnStore.ts`: almacenamiento local, ajustes, importar y exportar.
- `src/hymnal/HymnalPanel.tsx`: lista, búsqueda, pestañas y editor.
- `src/hymnal/HymnViewer.tsx`: visor en pantalla completa.
