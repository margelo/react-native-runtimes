'use client';

import { useState } from 'react';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'fumadocs-ui/components/ui/popover';
import { twMerge } from 'tailwind-merge';
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
} from 'lucide-react';

const cn = (...classes: Array<string | undefined | false>) =>
  twMerge(classes.filter(Boolean).join(' '));

type LLMCopyButtonProps = {
  markdownUrl: string;
};

export function LLMCopyButton({ markdownUrl }: LLMCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onCopy() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(markdownUrl);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy markdown', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        buttonVariants({ color: 'secondary', size: 'sm' }),
        'gap-2',
      )}
      aria-label="Copy this page as Markdown"
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      {copied ? 'Copied' : 'Copy as Markdown'}
    </button>
  );
}

type ViewOptionsProps = {
  markdownUrl: string;
  githubUrl: string;
};

export function ViewOptions({ markdownUrl, githubUrl }: ViewOptionsProps) {
  const absoluteMarkdownUrl =
    typeof window === 'undefined'
      ? markdownUrl
      : new URL(markdownUrl, window.location.origin).toString();

  const items = [
    {
      label: 'View as Markdown',
      description: 'Open the raw .md source in a new tab',
      href: markdownUrl,
      external: true,
    },
    {
      label: 'Open in ChatGPT',
      description: 'Ask ChatGPT about this page',
      href: `https://chatgpt.com/?hints=search&q=${encodeURIComponent(
        `Read ${absoluteMarkdownUrl} and answer my next question about it.`,
      )}`,
      external: true,
    },
    {
      label: 'Open in Claude',
      description: 'Ask Claude about this page',
      href: `https://claude.ai/new?q=${encodeURIComponent(
        `Read ${absoluteMarkdownUrl} and answer my next question about it.`,
      )}`,
      external: true,
    },
    {
      label: 'Open in T3 Chat',
      description: 'Ask T3 Chat about this page',
      href: `https://t3.chat/new?q=${encodeURIComponent(
        `Read ${absoluteMarkdownUrl} and answer my next question about it.`,
      )}`,
      external: true,
    },
    {
      label: 'View source on GitHub',
      description: 'See the MDX in the repository',
      href: githubUrl,
      external: true,
    },
  ];

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ color: 'secondary', size: 'sm' }),
          'gap-2',
        )}
      >
        Open
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col p-1 w-64">
        {items.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noreferrer noopener' : undefined}
            className="flex flex-row items-start gap-2 rounded-md p-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            <div className="flex-1">
              <p className="font-medium">{item.label}</p>
              <p className="text-xs text-fd-muted-foreground">
                {item.description}
              </p>
            </div>
            {item.external && (
              <ExternalLinkIcon className="size-3.5 mt-1 shrink-0 text-fd-muted-foreground" />
            )}
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
