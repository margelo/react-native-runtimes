import Link from 'next/link';
import {
  ArrowRightIcon,
  CpuIcon,
  DatabaseIcon,
  LayersIcon,
  ListChecksIcon,
  PlayIcon,
  RocketIcon,
  ZapIcon,
} from 'lucide-react';

const features = [
  {
    icon: LayersIcon,
    title: 'Threaded rendering',
    body: 'Mount React components or whole screens on a named secondary runtime so the main JS stays free for navigation and input.',
  },
  {
    icon: DatabaseIcon,
    title: 'Native-backed shared state',
    body: 'A small Zustand-like API on top of a C++ singleton — every runtime sees the same value and the same revision.',
  },
  {
    icon: ZapIcon,
    title: 'Prewarming and headless tasks',
    body: 'Spin up runtimes ahead of time, hydrate them in the background, and open them with zero perceived delay.',
  },
  {
    icon: CpuIcon,
    title: 'Background business logic',
    body: 'Pin functions to a "background" runtime with a one-line directive, then keep call sites ordinary.',
  },
  {
    icon: ListChecksIcon,
    title: 'Big lists, smooth UI',
    body: 'Run FlashList or LegendList on a worker runtime so scrolling never competes with the rest of your app.',
  },
  {
    icon: RocketIcon,
    title: 'Incremental adoption',
    body: 'Opt in one component or one screen at a time. The rest of your app keeps working exactly as it did.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative isolate overflow-hidden border-b">
        <div
          className="absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
          aria-hidden
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--color-fd-primary)/.25,transparent_50%),radial-gradient(circle_at_70%_60%,oklch(0.7_0.15_280/.25),transparent_55%)]" />
        </div>

        <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-24 text-center">
          <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Run React Native across many named JS runtimes.
          </h1>
          <p className="max-w-2xl text-balance text-lg text-fd-muted-foreground">
            React Native Runtimes lets you mount components, schedule
            functions, and share state across multiple JavaScript runtimes — so
            your main UI thread is never blocked by lists, chat, sync, or
            crypto.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/docs/getting-started/quick-start"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
            >
              <PlayIcon className="size-4" />
              Quick start
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center gap-2 rounded-md border bg-fd-card px-5 py-2.5 text-sm font-medium transition hover:bg-fd-accent"
            >
              Read the docs
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">
              What you get
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Two libraries that work together:{' '}
              <code className="rounded bg-fd-muted px-1.5 py-0.5 text-sm">
                @react-native-runtimes/core
              </code>{' '}
              for runtime composition and{' '}
              <code className="rounded bg-fd-muted px-1.5 py-0.5 text-sm">
                @react-native-runtimes/state
              </code>{' '}
              for native-backed shared state.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="group relative rounded-xl border bg-fd-card p-5 transition hover:border-fd-primary/40"
              >
                <Icon className="size-5 text-fd-primary" />
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-fd-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              A second runtime, in a few lines
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Wrap any top-level component in <code>OnRuntime</code>. Metro
              auto-registers it; native mounts it on the named runtime.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-fd-primary/15 text-xs font-semibold text-fd-primary">
                  1
                </span>
                <span>Install the packages and wrap your Metro config.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-fd-primary/15 text-xs font-semibold text-fd-primary">
                  2
                </span>
                <span>
                  Prewarm a runtime from the app delegate or{' '}
                  <code>MainApplication</code>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-fd-primary/15 text-xs font-semibold text-fd-primary">
                  3
                </span>
                <span>
                  Drop <code>OnRuntime</code> around the slow part of your UI.
                </span>
              </li>
            </ul>
            <Link
              href="/docs/getting-started/installation"
              className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary hover:underline"
            >
              Installation guide <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border bg-fd-card">
            <div className="flex items-center gap-2 border-b bg-fd-muted/40 px-4 py-2 text-xs text-fd-muted-foreground">
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-yellow-400/70" />
              <span className="size-2.5 rounded-full bg-green-400/70" />
              <span className="ml-2 font-mono">ConversationPreview.tsx</span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 text-sm leading-relaxed">
              <code>{`import { OnRuntime } from '@react-native-runtimes/core';

function MessageList({ conversationId }) {
  // runs on 'messages-runtime', not the main runtime
  return <ActualMessageList conversationId={conversationId} />;
}

export function ConversationPreview() {
  return (
    <OnRuntime name="messages-runtime">
      <MessageList conversationId="release-room" />
    </OnRuntime>
  );
}`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Built for production React Native apps
          </h2>
          <p className="max-w-2xl text-fd-muted-foreground">
            Use it for chat screens, infinite lists, sync engines, headless
            hydration, or any work that should never compete with the main UI
            runtime.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/docs/recipes/chat-on-secondary-runtime"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
            >
              See real-world recipes
              <ArrowRightIcon className="size-4" />
            </Link>
            <Link
              href="/docs/concepts/runtimes"
              className="inline-flex items-center justify-center gap-2 rounded-md border bg-fd-card px-5 py-2.5 text-sm font-medium transition hover:bg-fd-accent"
            >
              Learn the concepts
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
