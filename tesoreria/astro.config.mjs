import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/*
 * Panel interno de tesorería. Nunca es un sitio público:
 * no hay sitemap, ni RSS, ni canonical, ni indexación.
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  trailingSlash: 'never',
  compressHTML: true,
  devToolbar: { enabled: false },

  server: { host: '127.0.0.1', port: 4322 },

  // Rechaza mutaciones cuya cabecera origin no coincida.
  // Es una capa más, no la única: lib/formulario.ts compara contra TS_ORIGEN
  // y verifica un token CSRF por sesión, que no dependen de url.origin.
  security: { checkOrigin: true },

  // No usamos <Image>, así que el endpoint de imágenes no debe existir.
  image: { service: { entrypoint: 'astro/assets/services/noop' } },

  integrations: [],

  vite: { build: { sourcemap: false } },
});
