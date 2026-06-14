import { source } from '@/lib/source';
import { getLLMText } from '@/lib/get-llm-text';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();

  const parts = await Promise.all(pages.map((page) => getLLMText(page)));

  return new Response(parts.join('\n\n---\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
