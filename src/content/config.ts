import { defineCollection, z } from 'astro:content';

const eventos = defineCollection({
  type: 'content',
  schema: () =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      location: z.string(),
      address: z.string().optional(),
      flyer: z.string().optional(),
      flyerAlt: z.string().optional(),
      type: z.enum(['tenida', 'interlogial', 'aniversario', 'publico', 'otro']).default('otro'),
      audience: z.enum(['publico', 'hermanos', 'invitacion']).default('publico'),
      rsvpEmail: z.string().email().optional(),
      rsvpWhatsapp: z.string().optional(),
      excerpt: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

const noticias = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      author: z.string().optional(),
      excerpt: z.string().optional(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

const cuadro = defineCollection({
  type: 'data',
  schema: z.object({
    anio: z.number().int(),
    anioVulgar: z.string(),
    venerableMaestro: z.object({ nombre: z.string(), grado: z.string().optional() }),
    primerVigilante: z.object({ nombre: z.string(), grado: z.string().optional() }).optional(),
    segundoVigilante: z.object({ nombre: z.string(), grado: z.string().optional() }).optional(),
    orador: z.object({ nombre: z.string(), grado: z.string().optional() }).optional(),
    secretario: z.object({ nombre: z.string(), grado: z.string().optional() }).optional(),
    tesorero: z.object({ nombre: z.string(), grado: z.string().optional() }).optional(),
    oficiales: z
      .array(z.object({ cargo: z.string(), nombre: z.string(), grado: z.string().optional() }))
      .default([]),
    maestros: z.array(z.string()).default([]),
    companeros: z.array(z.string()).default([]),
    aprendices: z.array(z.string()).default([]),
  }),
});

const pastmasters = defineCollection({
  type: 'data',
  schema: z.object({
    items: z.array(
      z.object({
        anio: z.number().int(),
        nombre: z.string(),
        vigente: z.boolean().default(false),
      }),
    ),
  }),
});

export const collections = { eventos, noticias, cuadro, pastmasters };
