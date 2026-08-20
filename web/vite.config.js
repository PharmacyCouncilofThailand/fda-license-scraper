import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The search page is the React app. Everything else the browser asks for —
 * form.html, theme.css, logo.png — lives in `public/` here and is copied out
 * verbatim, so there is still exactly one copy of each and the PDF renderer
 * keeps loading `/form.html` from Express as before.
 *
 * The build writes into `../public`, which is what Express serves. That
 * directory is build output now: edit files here, not there.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `npm start` in the parent runs the API on 3000; dev talks to it through here.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
