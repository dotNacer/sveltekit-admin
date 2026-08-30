import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // `@prisma/client` est résolu vers un client généré dans le store pnpm, dont
  // l'`exports` map ne satisfait pas le scanner de dépendances de Vite. Il n'a
  // de toute façon rien à faire dans un bundle navigateur : on l'exclut du
  // pré-bundling et on le garde externe côté SSR.
  optimizeDeps: { exclude: ['@prisma/client'] },
  ssr: { external: ['@prisma/client'] }
});
