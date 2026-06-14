import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';

export const metadata = {
  title: {
    default: 'React Native Runtimes',
    template: '%s · React Native Runtimes',
  },
  description:
    'Run React Native UI and state work across named JS runtimes. Threaded rendering, headless tasks, and shared native-backed state.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
