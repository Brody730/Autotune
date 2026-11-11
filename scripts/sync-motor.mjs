// Copia el motor de pistas a public/motor para que la página lo ofrezca como
// descarga (el instalador baja estos archivos desde el propio sitio).
// Se ejecuta solo antes de `npm run dev` y `npm run build`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'stem-server');
const out = join(root, 'public', 'motor');
mkdirSync(out, { recursive: true });

for (const f of ['server.py', 'analyze.py', 'requirements.txt']) copyFileSync(join(src, f), join(out, f));

// Los .bat necesitan saltos de línea de Windows aunque git los guarde con LF
const bat = readFileSync(join(src, 'instalador-web.bat'), 'utf8').replace(/\r?\n/g, '\r\n');
writeFileSync(join(out, 'instalar-motor-de-pistas.bat'), bat);
console.log('motor de pistas → public/motor');
