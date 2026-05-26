import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { InferPageType } from 'fumadocs-core/source';
import type { source } from './source';

const CONTENT_ROOT = path.join(process.cwd(), 'content', 'docs');

export async function getLLMText(page: InferPageType<typeof source>) {
  const filePath = path.join(CONTENT_ROOT, page.path);
  let raw = '';
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    raw = '';
  }

  // Strip the YAML frontmatter so the LLM gets the actual prose.
  const stripped = raw.replace(/^---[\s\S]*?---\s*/m, '');

  return `# ${page.data.title}
> ${page.data.description ?? ''}

Source: ${page.url}

${stripped.trim()}
`;
}
