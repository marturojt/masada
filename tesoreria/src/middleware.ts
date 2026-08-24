/*
 * Middleware: resuelve la sesión, decide el acceso con criterio cerrado por
 * defecto, y pone las cabeceras de seguridad.
 *
 * Cerrado por defecto significa que toda ruta exige sesión salvo las de la lista
 * PUBLICAS. Si algún día una ruta nueva no aparece en esa lista, el peor caso es
 * que pida iniciar sesión, no que sirva datos financieros. Cada página además
 * llama requerirSesion, que convierte cualquier desacuerdo entre esta lista y la
 * página en un error ruidoso en lugar de una fuga silenciosa.
 */
import { defineMiddleware } from 'astro:middleware';
import { leerSesion } from './lib/sesion';

/** Rutas que a propósito no exigen sesión. Exactas, sin prefijos. */
const PUBLICAS = new Set(['/entrar', '/salir']);

/** Prefijos de recursos que sirve el propio Astro o Vite, no son datos. */
const PREFIJOS_RECURSOS = ['/_astro/', '/_image', '/@', '/node_modules/', '/favicon'];

const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "script-src 'self'",
].join('; ');

/** Solo se acepta volver a una ruta propia, jamás a lo que venga en la query. */
function rutaSegura(ruta: string): string {
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return '/';
  return ruta;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.idPeticion = crypto.randomUUID().slice(0, 8);
  ctx.locals.sesion = null;

  const ruta = ctx.url.pathname.replace(/\/+$/, '') || '/';
  const esRecurso = PREFIJOS_RECURSOS.some((p) => ctx.url.pathname.startsWith(p));

  if (!esRecurso) {
    ctx.locals.sesion = await leerSesion(ctx);

    if (!ctx.locals.sesion && !PUBLICAS.has(ruta)) {
      const volver = rutaSegura(ctx.url.pathname + ctx.url.search);
      const destino =
        volver === '/' ? '/entrar' : `/entrar?volver=${encodeURIComponent(volver)}`;
      return ctx.redirect(destino, 303);
    }
  }

  const respuesta = await next();

  respuesta.headers.set('X-Robots-Tag', 'noindex, nofollow');
  respuesta.headers.set('X-Content-Type-Options', 'nosniff');
  /*
   * same-origin y no no-referrer, a propósito: con no-referrer, Safari manda
   * Origin: null en los POST aunque sean del mismo sitio, y eso hace que la
   * comprobación de origen rechace el login con "Cross-site POST form
   * submissions are forbidden". Hacia otros sitios el referente sigue sin salir.
   */
  respuesta.headers.set('Referrer-Policy', 'same-origin');
  respuesta.headers.set('X-Frame-Options', 'DENY');
  respuesta.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  /*
   * Si la respuesta ya trae su propia política, se respeta: el endpoint de
   * comprobantes manda una más estricta, con sandbox, y sería un error pisarla
   * con la del panel.
   */
  if (!respuesta.headers.has('content-security-policy')) {
    respuesta.headers.set('Content-Security-Policy', CSP);
  }

  /* Información financiera en laptops compartidas: nada de caché. */
  if (respuesta.headers.get('content-type')?.includes('text/html')) {
    respuesta.headers.set('Cache-Control', 'private, no-store');
  }

  return respuesta;
});
