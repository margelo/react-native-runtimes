import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();

  const sections = new Map<string, string[]>();
  for (const page of pages) {
    const top = page.slugs[0] ?? 'docs';
    const list = sections.get(top) ?? [];
    list.push(
      `- [${page.data.title}](/raw/${page.slugs.join('/')}): ${page.data.description ?? ''}`,
    );
    sections.set(top, list);
  }

  const body = [
    '# React Native Runtimes',
    '',
    '> Run React Native UI and state work across named JS runtimes. Threaded rendering, headless tasks, and shared native-backed state.',
    '',
    'This file lists every page in the docs in a machine-readable format. Pair it with `/llms-full.txt` for the full content concatenated in one document.',
    '',
  ];

  for (const [section, items] of sections) {
    body.push(`## ${section}`);
    body.push('');
    body.push(...items);
    body.push('');
  }

  return new Response(body.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
