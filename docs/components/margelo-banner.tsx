import { ArrowRight } from 'lucide-react';

export function MargeloBanner() {
  return (
    <div className="mt-6 rounded-lg border bg-fd-card p-3 text-xs">
      <p className="font-semibold text-fd-card-foreground">
        React Native Runtimes is built with{' '}
        <span aria-hidden="true">❤️</span> by Margelo
      </p>
      <p className="mt-1 text-fd-muted-foreground">
        We build fast and beautiful apps. Contact us at margelo.com for
        high-end consultancy services.
      </p>
      <a
        href="https://margelo.com"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-fd-primary px-3 py-1.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
      >
        Let&apos;s talk
        <ArrowRight className="size-3.5" />
      </a>
    </div>
  );
}
