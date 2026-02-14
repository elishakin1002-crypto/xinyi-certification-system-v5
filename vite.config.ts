import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': 'http://localhost:3001'
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
        }
      }
    };
});
