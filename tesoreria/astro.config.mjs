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
  //
  // allowedDomains NO es opcional aquí, aunque su default sea []: con la lista
  // vacía Astro ignora Host y X-Forwarded-*, y arma url.origin como
  // http://localhost:4322. Como checkOrigin compara la cabecera Origin contra
  // url.origin, detrás del proxy TODO POST daría 403. Con la lista puesta,
  // url.origin queda en https://tesoreria.masada324.org y coincide.
  // Las entradas de localhost/127.0.0.1 son para que `astro dev` funcione por
  // cualquiera de las dos. Quien borre esto rompe todos los formularios.
  security: {
    checkOrigin: true,
    allowedDomains: [
      { hostname: 'tesoreria.masada324.org', protocol: 'https' },
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
    ],
  },

  // No usamos <Image>, así que el endpoint de imágenes no debe existir.
  image: { service: { entrypoint: 'astro/assets/services/noop' } },

  integrations: [],

  vite: { build: { sourcemap: false } },
});
