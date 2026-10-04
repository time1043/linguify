import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Linguify',
    description: 'Look up selected words in your local vocabulary buckets',
    permissions: ['storage', 'offscreen', 'sidePanel', 'tabs', 'scripting'],
    host_permissions: [
      'https://api.deepseek.com/*',
      'https://www.youtube.com/*',
      'https://api.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://*.akamaized.net/*',
      'https://*.bilivideo.com/*',
      'https://*.hdslb.com/*',
    ],
    web_accessible_resources: [
      {
        resources: ['injected.js'],
        matches: ['https://www.youtube.com/*'],
      },
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
