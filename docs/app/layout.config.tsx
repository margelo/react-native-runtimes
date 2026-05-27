import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
        <Logo size={24} className="shrink-0" />
        React Native Runtimes
      </span>
    ),
  },
  links: [
    {
      text: 'Docs',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'GitHub',
      url: 'https://github.com/Szymon20000/react-native-runtimes',
      external: true,
    },
  ],
  githubUrl: 'https://github.com/Szymon20000/react-native-runtimes',
};
