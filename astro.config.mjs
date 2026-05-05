import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://masada324.org',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/rss.xml'),
    }),
  ],
  build: {
    format: 'directory',
  },
});
