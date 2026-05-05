import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export const prerender = true;

export async function GET(context: APIContext) {
  const all = (await getCollection('noticias', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  return rss({
    title: 'Noticias · R∴L∴S∴ Masada No. 324',
    description: 'Avisos y comunicados de la R∴L∴S∴ Masada No. 324',
    site: context.site ?? 'https://masada324.org',
    items: all.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.date,
      description: entry.data.excerpt ?? '',
      link: `/noticias/${entry.slug}/`,
    })),
    customData: '<language>es-mx</language>',
  });
}
