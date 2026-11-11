import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // El motor de pistas (Python, modelos, audios) no es parte de la página
  server: { watch: { ignored: ['**/stem-server/**'] } },
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Live Stage Assistant',
      short_name: 'LSA',
      description: 'Asistente en vivo para ministerios de alabanza y bandas: tono, acordes transportados, letras, JAM y bóveda de cifrados.',
      start_url: '.',
      scope: '.',
      display: 'standalone',
      background_color: '#0b1020',
      theme_color: '#0b1020',
      icons: [
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
  })],
});
