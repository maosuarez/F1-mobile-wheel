import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 activa certificado autofirmado para el modo WiFi (npm run dev:wifi).
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: https ? [basicSsl()] : [],
  build: {
    rollupOptions: {
      input: { main: 'index.html', wheel: 'wheel/index.html' },
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': 'http://localhost:8000',
    },
  },
});
