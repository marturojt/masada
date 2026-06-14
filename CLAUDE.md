# CLAUDE.md

Guía para Claude Code en este repositorio. El detalle completo está en `README.md`
(stack, estructura, cómo agregar contenido, despliegue) y `HANDOFF.md` (estado actual
y pendientes). **Lee ambos antes de trabajar.**

## Qué es
Sitio público de la R∴L∴S∴ Masada No. 324. Astro 4 + MDX, salida estática, CSS propio
(sin Tailwind ni frameworks JS). Producción: https://masada324.org

## Comandos
```bash
npm install        # node_modules NO se versiona; correr tras clonar
npm run dev        # http://localhost:4321
npm run build      # valida y genera dist/  ← usar para verificar cambios
bash deploy/publish.sh   # build + rsync al VPS (solo cuando se pida)
```

## Convenciones (importante)
- **Redacción en español, sin guiones largos (—). Usar comas** (lectura más natural).
- Contenido en colecciones: eventos/noticias en `.mdx`, cuadro/pastmasters en `.json`.
  Esquemas en `src/content/config.ts`. Plantillas en `public/*-template.md`.
- Cuadro logial: la columna **Maestros se autogenera** de dignatarios + oficiales; el
  array `"maestros"` es solo para maestros sin cargo. El V∴M∴ vigente NO va en Past Masters.
- Tags de noticias son funcionales (`/noticias/tag/<slug>/` vía `slugifyTag`).
- `draft: true` oculta eventos/noticias.
- Tras editar, correr `npm run build` para confirmar que compila.
- Commit directo a `main`. Commit/push solo cuando el usuario lo pida.
