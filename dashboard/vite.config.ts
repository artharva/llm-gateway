import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the dashboard calls the gateway through this proxy, so the
// browser sees one origin and no CORS setup is needed. In Docker, nginx does the same.
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  // Recharts is most of the bundle; one chunk is fine for an internal admin page.
  build: { chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    proxy: { '/admin': gateway, '/health': gateway },
  },
});
