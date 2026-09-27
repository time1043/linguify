import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vocab Lens',
    description: 'Look up selected words in your local vocabulary buckets',
    permissions: ['storage'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
