import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Live Stage Assistant',
      short_name: 'LSA',
      description: 'Asistencia en vivo para músicos: tonalidad, acordes y teleprompter.',
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
