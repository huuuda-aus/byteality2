import { defineConfig } from 'vite';

// Two pages: the game and the level generator gallery (both are in the production build).
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', gallery: 'gallery.html' } } },
});
