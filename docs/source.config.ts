import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    // Fumadocs adds GFM, syntax highlighting via Shiki, etc. by default.
  },
});
