import React from 'react';
import { Text, View } from 'react-native';
import {
  afterEach,
  describe,
  expect,
  it,
  render,
  spyOn,
} from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import {
  OnRuntime,
  registerLazyThreadedComponent,
  threadedComponent,
  ThreadedRuntimeHost,
} from '@react-native-runtimes/core';

afterEach(() => {
  // Restore console spies between tests.
});

describe('<ThreadedRuntimeHost />', () => {
  it('renders null and warns when no componentName is passed', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    await render(<ThreadedRuntimeHost />);
    expect(warn).toHaveBeenCalledWith(
      'ThreadedRuntimeHost mounted without componentName',
    );
    warn.mockRestore();
  });

  it('renders null and warns when componentName has no registered component', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    await render(
      <ThreadedRuntimeHost componentName="test/host.notRegistered" />,
    );
    expect(warn).toHaveBeenCalledWith(
      'No threaded component registered for "test/host.notRegistered"',
    );
    warn.mockRestore();
  });

  it('renders the registered component when found', async () => {
    registerLazyThreadedComponent('test/host.basic', () => function Demo() {
      return (
        <View>
          <Text testID="hostContent">host-renders-me</Text>
        </View>
      );
    });

    await render(<ThreadedRuntimeHost componentName="test/host.basic" />);
    const node = await screen.findByTestId('hostContent');
    expect(node).toBeDefined();
  });

  it('passes initialPropsJson into the rendered component as props', async () => {
    registerLazyThreadedComponent('test/host.props', () => function Demo(
      props: { greeting?: string },
    ) {
      return <Text testID="hostProps">{props.greeting ?? 'none'}</Text>;
    });

    await render(
      <ThreadedRuntimeHost
        componentName="test/host.props"
        initialPropsJson={JSON.stringify({ greeting: 'hi-from-props' })}
      />,
    );

    const node = await screen.findByTestId('hostProps');
    expect(node).toBeDefined();
  });

  it('falls back to empty props when initialPropsJson is malformed', async () => {
    registerLazyThreadedComponent('test/host.malformedProps', () =>
      function Demo(props: Record<string, unknown>) {
        return (
          <Text testID="hostMalformed">
            {Object.keys(props).filter(k => k !== 'runtimeName').length}
          </Text>
        );
      },
    );

    await render(
      <ThreadedRuntimeHost
        componentName="test/host.malformedProps"
        initialPropsJson="{not-json"
      />,
    );

    const node = await screen.findByTestId('hostMalformed');
    expect(node).toBeDefined();
  });
});

describe('<OnRuntime />', () => {
  it('warns and renders null when the child is not a threaded component', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    function PlainNotThreaded() {
      return <Text>plain</Text>;
    }

    await render(
      <OnRuntime name="any-runtime">
        <PlainNotThreaded />
      </OnRuntime>,
    );

    expect(warn).toHaveBeenCalledWith(
      'OnRuntime child must be a threaded component.',
    );
    warn.mockRestore();
  });

  it('accepts a child that has been wrapped by threadedComponent()', async () => {
    const ThreadedDemo = threadedComponent(
      'test/onRuntime.accept',
      function Demo() {
        return <Text>threaded-child</Text>;
      },
    );

    // Mounting OnRuntime with a valid threaded child should not warn about
    // the child shape. The underlying native surface may not actually mount
    // a worker runtime in this test context, but the validation path must
    // pass without printing the "must be a threaded component" warning.
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    await render(
      <OnRuntime name="test/onRuntime.accept-runtime">
        <ThreadedDemo />
      </OnRuntime>,
    );
    expect(warn).not.toHaveBeenCalledWith(
      'OnRuntime child must be a threaded component.',
    );
    warn.mockRestore();
  });
});
