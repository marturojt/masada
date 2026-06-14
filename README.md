# R∴L∴S∴ Masada No. 324 — Sitio web

Sitio público de la Respetable Logia Simbólica Masada No. 324, jurisdiccionada a la
M∴R∴G∴L∴ Valle de México. Construido con **Astro + MDX**, salida estática, sin frameworks JS.

- **Producción:** https://masada324.org
- **Contacto:** hola@masada324.org

---

## Stack

| Pieza            | Detalle                                              |
| ---------------- | ---------------------------------------------------- |
| Framework        | Astro 4 (salida estática, `format: 'directory'`)     |
| Contenido        | Colecciones de contenido (`astro:content`) + MDX     |
| Estilos          | CSS propio con tokens (`src/styles/`), sin Tailwind  |
| Tipografía       | Cinzel, Cormorant Garamond, Inter (Google Fonts)     |
| Extras           | RSS (`@astrojs/rss`), sitemap (`@astrojs/sitemap`)   |
| Despliegue       | `deploy/publish.sh` → build + rsync a VPS            |

Estética: dorado / obsidiana, modo claro/oscuro (toggle en el header). El carácter `∴`
aparece con la clase `.therefore`.

---

## Desarrollo

```bash
npm install        # primera vez (node_modules está en .gitignore)
npm run dev        # http://localhost:4321
npm run build      # genera dist/
npm run preview    # sirve dist/ localmente
```

---

## Estructura

```
src/
├── components/
│   ├── AtmosphericBanner.astro   # Banner con patrón geométrico animado
│   ├── EventCard.astro           # Tarjeta de evento (listados)
│   ├── NewsList.astro            # Listado de noticias reutilizable (index + tags)
│   ├── Header.astro / Footer.astro
│   └── ThemeToggle.astro         # Cambio claro/oscuro
├── content/
│   ├── config.ts                 # Esquemas (Zod) de todas las colecciones
│   ├── eventos/      *.mdx        # Un archivo por evento
│   ├── noticias/     *.mdx        # Un archivo por noticia
│   ├── cuadro/       <año>.json   # Cuadro logial por año
│   └── pastmasters/  historico.json
├── layouts/PublicLayout.astro    # <head>, SEO, OG, schema.org, Header/Footer
├── lib/format.ts                 # Fechas (es-MX) + slugifyTag
├── pages/
│   ├── index.astro               # Home
│   ├── cuadro-logial.astro       # Dignatarios, miembros y past masters
│   ├── ingreso.astro
│   ├── eventos/  index.astro + [slug].astro
│   └── noticias/ index.astro + [slug].astro + tag/[tag].astro
└── styles/  tokens.css + global.css

public/
├── images/eventos/               # Flyers de eventos
├── evento-template.md            # Plantilla con frontmatter comentado
└── noticia-template.md
```

---

## Cómo agregar contenido

### Evento
Crea `src/content/eventos/YYYY-MM-DD-nombre.mdx`. Usa `public/evento-template.md`
como base (frontmatter documentado campo por campo). El flyer va en
`public/images/eventos/` (proporción 4:5). El botón de confirmación usa WhatsApp si
defines `rsvpWhatsapp`, si no, correo. Los eventos futuros aparecen en la home.

### Noticia
Crea `src/content/noticias/YYYY-MM-DD-nombre.mdx`. Base: `public/noticia-template.md`.
Los `tags` son **funcionales**: cada uno enlaza a `/noticias/tag/<slug>/` (slug sin
acentos). Las tres notas más recientes aparecen en la home.

### Cuadro logial (por año)
Crea/edita `src/content/cuadro/<año>.json`:

```json
{
  "anio": 2026,
  "anioVulgar": "2026 E∴V∴",
  "venerableMaestro": { "nombre": "..." },
  "primerVigilante": { "nombre": "..." },
  "segundoVigilante": { "nombre": "..." },
  "orador": { "nombre": "..." },
  "secretario": { "nombre": "..." },
  "tesorero": { "nombre": "..." },
  "oficiales": [{ "cargo": "...", "nombre": "..." }],
  "maestros": [],
  "companeros": ["Nombre 1", "Nombre 2"],
  "aprendices": ["Nombre"]
}
```

Notas importantes:
- La columna **Maestros se genera sola** combinando dignatarios + oficiales. El array
  `"maestros"` es solo para maestros **sin cargo** adicionales (se suman sin duplicar).
- `companeros` y `aprendices` se escriben directamente.
- Cada columna se oculta si está vacía.
- Con más de un año en `cuadro/`, aparece un selector de año (`?año=YYYY`).

### Past Masters
Edita `src/content/pastmasters/historico.json` (lista `items` con `anio` y `nombre`).
Un Past Master es quien **concluyó** el cargo de V∴M∴; el venerable vigente NO va aquí
(ya aparece en Dignatarios).

---

## Despliegue

```bash
bash deploy/publish.sh
```

Hace `npm run build`, sube `dist/` por rsync al VPS (alias SSH `freejolitos`) y publica
en `/var/www/html/masada-root`. Requiere alias SSH configurado y `sudo` en el VPS.

---

## Convenciones

- **Redacción:** sin guiones largos (—); usar comas (lectura más natural).
- Borradores: `draft: true` oculta cualquier evento o noticia.
- `node_modules` y `dist/` están en `.gitignore`.
- El flujo de trabajo commitea directamente a `main`.
