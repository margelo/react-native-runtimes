import { describe, expect, it } from 'react-native-harness';
import { createSharedStore } from '@react-native-runtimes/state';

describe('SharedZustandStore — basic state', () => {
  it('getState() returns initial state before hydration', () => {
    const store = createSharedStore({
      name: 'test-basic-initial',
      initialState: { counter: 0 },
    });
    expect(store.getState().counter).toBe(0);
  });

  it('setState() updates state and increments revision', async () => {
    const store = createSharedStore({
      name: 'test-basic-set',
      initialState: { counter: 0 },
    });
    await store.hydrate();
    const revision = await store.setState({ counter: 42 });
    expect(store.getState().counter).toBe(42);
    expect(revision).toBeGreaterThan(0);
  });

  it('getRevision() matches the revision returned by setState()', async () => {
    const store = createSharedStore({
      name: 'test-basic-revision',
      initialState: { value: 'a' },
    });
    await store.hydrate();
    const revision = await store.setState({ value: 'b' });
    expect(store.getRevision()).toBe(revision);
  });

  it('clear() resets state to initialState', async () => {
    const store = createSharedStore({
      name: 'test-basic-clear',
      initialState: { counter: 99 },
    });
    await store.hydrate();
    await store.setState({ counter: 55 });
    await store.clear();
    expect(store.getState().counter).toBe(99);
  });
});

describe('SharedZustandStore — subtrees', () => {
  it('setSubtreeState() updates only the target subtree', async () => {
    const store = createSharedStore({
      name: 'test-subtree-isolation',
      initialState: { a: 1, b: 2 },
      subtrees: ['a', 'b'],
    });
    await store.hydrate();
    await store.setSubtreeState('a', 10);
    expect(store.getState().a).toBe(10);
    expect(store.getState().b).toBe(2);
  });

  it('getRevision() per subtree tracks independently', async () => {
    const store = createSharedStore({
      name: 'test-subtree-revisions',
      initialState: { x: 0, y: 0 },
      subtrees: ['x', 'y'],
    });
    await store.hydrate();
    await store.setSubtreeState('x', 7);
    const revX = store.getRevision('x');
    const revY = store.getRevision('y');
    expect(revX).toBeGreaterThan(0);
    expect(revY).toBeGreaterThan(0);
    expect(revX).not.toBe(revY);
  });

  it('clear(subtreeKey) resets only that subtree', async () => {
    const store = createSharedStore({
      name: 'test-subtree-clear',
      initialState: { p: 'original', q: 'original' },
      subtrees: ['p', 'q'],
    });
    await store.hydrate();
    await store.setSubtreeState('p', 'changed');
    await store.setSubtreeState('q', 'changed');
    await store.clear('p');
    expect(store.getState().p).toBe('original');
    expect(store.getState().q).toBe('changed');
  });
});


describe('SharedZustandStore — subscriptions', () => {
  it('subscribe() fires when state changes', async () => {
    const store = createSharedStore({
      name: 'test-subscribe-fires',
      initialState: { tick: 0 },
    });
    await store.hydrate();

    let fired = false;
    const unsub = store.subscribe(() => {
      fired = true;
    });

    await store.setState({ tick: 1 });
    unsub();

    expect(fired).toBe(true);
  });

  it('unsubscribe() stops further notifications', async () => {
    const store = createSharedStore({
      name: 'test-subscribe-unsub',
      initialState: { tick: 0 },
    });
    await store.hydrate();

    let count = 0;
    const unsub = store.subscribe(() => {
      count += 1;
    });

    await store.setState({ tick: 1 });
    unsub();
    await store.setState({ tick: 2 });

    expect(count).toBe(1);
  });
});
