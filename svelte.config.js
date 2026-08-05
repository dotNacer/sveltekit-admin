import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      'sveltekit-admin': './src/lib/index.js',
      'sveltekit-admin/*': './src/lib/*'
    }
  }
};

export default config;
