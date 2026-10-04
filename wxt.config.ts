import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Linguify',
    description: 'Look up selected words in your local vocabulary buckets',
    permissions: ['storage', 'offscreen'],
    host_permissions: ['https://api.deepseek.com/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
