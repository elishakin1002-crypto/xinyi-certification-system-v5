import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const devPort = Number(process.env.VITE_DEV_PORT || env.VITE_DEV_PORT || 3000);
    const apiPort = Number(process.env.VITE_API_PORT || env.VITE_API_PORT || 3001);
    const apiHost = String(process.env.VITE_API_HOST || env.VITE_API_HOST || 'localhost').trim() || 'localhost';
    const apiTarget = String(env.VITE_API_PROXY_TARGET || `http://${apiHost}:${apiPort}`).trim();
    return {
      server: {
        allowedHosts: true,
        port: Number.isFinite(devPort) ? devPort : 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': apiTarget || 'http://localhost:3001'
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.KIMI_API_KEY || ''),
        'process.env.KIMI_API_KEY': JSON.stringify(env.KIMI_API_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@src': path.resolve(__dirname, './src'),
        }
      }
    };
});
