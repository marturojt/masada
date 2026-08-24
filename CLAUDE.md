# CLAUDE.md

Guía para Claude Code en este repositorio. El detalle completo está en `README.md`
(stack, estructura, cómo agregar contenido, despliegue) y `HANDOFF.md` (estado actual
y pendientes). **Lee ambos antes de trabajar.**

## Qué hay aquí

Dos proyectos, con sus propias dependencias y su propio `package.json`:

| Carpeta | Qué es |
|---|---|
| raíz | Sitio público. Astro 4 + MDX, salida estática. https://masada324.org |
| `tesoreria/` | Sistema interno de tesorería. Astro 7 con SSR + PostgreSQL. En producción: https://tesoreria.masada324.org |

El sitio no depende de la tesorería. Lo único que las conecta es la exportación del
cuadro logial, que escribe `src/content/cuadro/<año>.json` y solo cuando se pide.

## Sitio público (raíz)

```bash
npm install        # node_modules NO se versiona; correr tras clonar
npm run dev        # http://localhost:4321
npm run build      # valida y genera dist/  ← usar para verificar cambios
bash deploy/publish.sh   # build + rsync al VPS (solo cuando se pida)
```

Convenciones:
- Contenido en colecciones: eventos/noticias en `.mdx`, cuadro/pastmasters en `.json`.
  Esquemas en `src/content/config.ts`. Plantillas en `public/*-template.md`.
- Cuadro logial: la columna **Maestros se autogenera** de dignatarios + oficiales; el
  array `"maestros"` es solo para maestros sin cargo. El V∴M∴ vigente NO va en Past Masters.
- Tags de noticias son funcionales (`/noticias/tag/<slug>/` vía `slugifyTag`).
- `draft: true` oculta eventos/noticias.
- Tras editar, correr `npm run build` para confirmar que compila.

## Tesorería (`tesoreria/`)

```bash
cd tesoreria
npm install
npm run migrar     # aplica migraciones pendientes
npm run dev        # http://127.0.0.1:4322
npm run check      # tipos + verificación de guardias de sesión
npm run prueba     # pruebas contra una base de pruebas aparte
```

Lee `tesoreria/README.md` antes de tocarla. Lo que hay que tener presente:

- **Las reglas de dinero viven en PostgreSQL**, no en la interfaz: bloqueo del mes
  cerrado, doble firma, topes de aplicación de pagos, máquina de estados del egreso.
  Si una regla nueva importa, va en una migración, no solo en el código.
- **Las migraciones son inmutables** una vez aplicadas: el runner guarda su sha256 y
  aborta si cambian. Para corregir algo, se crea una migración nueva.
- **El dinero son enteros de centavos.** Nunca float.
- **La autorización es explícita** en cada página con `requerirSesion` o `requerirVM`.
  `npm run check` falla si una página nueva la olvida.
- **Sin JavaScript de cliente.** Formularios HTML con POST a la propia página y
  redirect 303, token CSRF por sesión y nonce de un solo uso.
- Los estilos se copian del sitio con `npm run estilos`, no se importan por ruta.

## Convenciones de todo el repositorio

- **Redacción en español, sin guiones largos (—). Usar comas** (lectura más natural).
  Aplica también a comentarios de código, mensajes de error y textos de la interfaz:
  los lee el tesorero, no un programador.
- Commit directo a `main`. Commit/push solo cuando el usuario lo pida.
