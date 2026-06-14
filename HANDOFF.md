# Handoff — Sitio Masada No. 324

Documento para retomar el trabajo. Última actualización: **14 de junio de 2026**.

> Lee primero el `README.md` para el panorama general (stack, estructura, cómo agregar
> contenido y desplegar). Este documento cubre el **estado actual** y lo **pendiente**.

---

## Estado actual

Sitio funcional y desplegable. Última sesión de trabajo en el commit
`2df2824` (ya en `main` y en GitHub). Build verde (7 páginas + RSS + sitemap).

### Páginas en producción
- **Home** (`/`) — hero, síntesis histórica de Masada, servicios, próximos eventos, últimas noticias.
- **Cuadro logial** (`/cuadro-logial/`) — dignatarios, oficiales, columnas de miembros y past masters.
- **Eventos** (`/eventos/` + detalle) — con RSVP por WhatsApp/correo.
- **Noticias** (`/noticias/` + detalle + páginas por etiqueta).
- **Ingreso** (`/ingreso/`) — requisitos y contacto.

---

## Hecho en la última sesión

1. **Limpieza de la biblioteca eliminada** — se quitó la colección `books`, el JSON de
   catálogo y todas las menciones (config, home, nota de bienvenida).
2. **Cuadro logial 2026** — correcciones de nombres (Luis Luna Avila sin acento;
   tesorero ahora Mario Eduardo Userralde Gordillo).
3. **Columnas de miembros** — Maestros / Compañeros / Aprendices. Maestros se derivan
   automáticamente de dignatarios + oficiales. Cada columna tiene una descripción del
   grado y su símbolo de trabajo, ocultos tras un ícono ⓘ (toggle por clic).
4. **Sección Past Masters** — histórico 2022–2025 en `pastmasters/historico.json`.
5. **Tags funcionales** — enlaces a `/noticias/tag/<slug>/`, con componente reutilizable
   `NewsList.astro` y helper `slugifyTag` en `lib/format.ts`.
6. **Nueva nota pública** — "El silencio como disciplina iniciática"
   (`2026-06-14-silencio-disciplina-iniciatica.mdx`), a propósito de la tenida
   interlogial del 15 de junio.

---

## Pendiente / próximos pasos

- [ ] **Llenar el cuadro de miembros** — el usuario dará más nombres. Recordar:
  - Maestros sin cargo → agregar al array `"maestros"` (los dignatarios/oficiales ya entran solos).
  - Compañeros actuales: José Manuel de la Rosa Nava, Pedro Eduardo Velázquez Hernández.
  - Aprendices actuales: Jonathan Israel Rodríguez Melo.
- [ ] **Histórico completo de Past Masters** — hoy solo están 2022–2025. El usuario
  pasará toda la historia de la logia para completar `pastmasters/historico.json`.
- [ ] **Desplegar a producción** cuando se decida (`bash deploy/publish.sh`).
- [ ] (Opcional) Limpiar el código inerte de la insignia "Vigente" en la sección Past
  Masters de `cuadro-logial.astro` (campo `vigente` ya no se usa, un past master nunca
  está vigente). Es inofensivo; quedó pendiente de confirmar si se quita.

---

## Notas de contexto

- **Preferencia de redacción:** sin guiones largos (—), usar comas.
- **Dato del cuadro:** Mario Arturo Jiménez Terrón es el **V∴M∴ vigente 2026**; por eso
  NO está en Past Masters.
- **Imágenes:** flyers de eventos en `public/images/eventos/`, proporción 4:5.
- **Audiencia de eventos:** el campo `audience` controla la etiqueta del detalle. La
  tenida interlogial del 15-jun es `hermanos`; la nota del silencio es pública y NO
  invita al público al evento, solo lo usa como contexto.
- `node_modules` no se versiona: si el repo está recién clonado, correr `npm install`
  antes de `npm run dev/build`.
