import { useSyncExternalStore } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';
import type { SharedZustandStore as NitroSharedZustandStore } from './specs/SharedZustandStore.nitro';

const ROOT_SUBTREE_KEY = '__root__';

type NativeHydrationResult = {
  stateJson: string;
  revision: number;
  restoredFromPersistence?: boolean;
};

type NativeSharedZustandStore = {
  getState(storeName: string): Promise<string | null>;
  getOrInitState?: (
    storeName: string,
    initialJson: string,
    persistKey: string | null,
  ) => Promise<NativeHydrationResult>;
  setState(
    storeName: string,
    stateJson: string,
    source: string | null,
  ): Promise<number>;
  getRevision(storeName: string): Promise<number>;
  clear(storeName: string, source: string | null): Promise<number>;
  getSubtreeState(
    storeName: string,
    subtreeKey: string,
  ): Promise<string | null>;
  getOrInitSubtreeState?: (
    storeName: string,
    subtreeKey: string,
    initialJson: string,
    persistKey: string | null,
  ) => Promise<NativeHydrationResult>;
  setSubtreeState(
    storeName: string,
    subtreeKey: string,
    stateJson: string,
    source: string | null,
  ): Promise<number>;
  getSubtreeRevision(storeName: string, subtreeKey: string): Promise<number>;
  clearSubtree(
    storeName: string,
    subtreeKey: string,
    source: string | null,
  ): Promise<number>;
  setPersistedState?: (persistKey: string, stateJson: string) => Promise<void>;
  clearPersistedState?: (persistKey: string) => Promise<void>;
  notifyChanged?: (
    storeName: string,
    subtreeKey: string,
    stateJson: string | null,
    revision: number,
    source: string | null,
  ) => Promise<void>;
};

type NativeChangeEvent = {
  storeName: string;
  subtreeKey?: string;
  stateJson: string | null;
  revision: number;
  source?: string | null;
};

export type SharedStoreListener<TState> = (
  state: TState,
  revision: number,
  subtreeKey: string,
) => void;

export type SharedStoreReducer<TState, TAction> = (
  state: TState,
  action: TAction,
) => TState;

export type SharedStoreSubtreeKey<TState> = Extract<keyof TState, string>;
export type SharedStorePathSegment = string | number;
export type SharedStorePath = string | readonly SharedStorePathSegment[];

export type SharedStoreSliceReducers<TState, TAction> = Partial<{
  [K in SharedStoreSubtreeKey<TState>]: SharedStoreReducer<TState[K], TAction>;
}>;

export type SharedStorePathApi<TValue, TState, TAction> = {
  key: string;
  segments: readonly string[];
  get(): TValue;
  getRevision(): number;
  hydrate(): Promise<TValue>;
  set(
    partial:
      | TValue
      | Partial<TValue>
      | ((state: TValue) => TValue | Partial<TValue>),
    replace?: boolean,
  ): Promise<number>;
  update(updater: (state: TValue) => TValue): Promise<number>;
  dispatch(action: TAction): Promise<number>;
  clear(): Promise<number>;
  subscribe(
    listener: (
      value: TValue,
      state: TState,
      revision: number,
      pathKey: string,
    ) => void,
  ): () => void;
  use(): TValue;
  use<TSelected>(
    selector: (value: TValue) => TSelected,
    getServerSnapshot?: () => TSelected,
  ): TSelected;
};

export type SharedStorePersistOptions<TState> =
  | boolean
  | {
      key?: string;
      version?: number;
      subtrees?: readonly (SharedStoreSubtreeKey<TState> | SharedStorePath)[];
    };

export type SharedStoreOptions<TState, TAction> = {
  name: string;
  initialState: TState;
  reducer?: SharedStoreReducer<TState, TAction>;
  slices?: SharedStoreSliceReducers<TState, TAction>;
  subtrees?: readonly SharedStoreSubtreeKey<TState>[];
  persist?: SharedStorePersistOptions<TState>;
  sourceId?: string;
};

export type SharedStoreApi<TState, TAction> = {
  name: string;
  getState(): TState;
  getRevision(subtreeKey?: SharedStorePath): number;
  getSubtreeState<K extends SharedStoreSubtreeKey<TState>>(
    subtreeKey: K,
  ): TState[K];
  getPathState<TValue = unknown>(path: SharedStorePath): TValue;
  hydrate(): Promise<TState>;
  setState(
    partial:
      | TState
      | Partial<TState>
      | ((state: TState) => TState | Partial<TState>),
    replace?: boolean,
  ): Promise<number>;
  setSubtreeState<K extends SharedStoreSubtreeKey<TState>>(
    subtreeKey: K,
    partial:
      | TState[K]
      | Partial<TState[K]>
      | ((state: TState[K]) => TState[K] | Partial<TState[K]>),
    replace?: boolean,
  ): Promise<number>;
  setPathState<TValue = unknown>(
    path: SharedStorePath,
    partial:
      | TValue
      | Partial<TValue>
      | ((state: TValue) => TValue | Partial<TValue>),
    replace?: boolean,
  ): Promise<number>;
  dispatch(action: TAction, subtreeKey?: SharedStorePath): Promise<number>;
  dispatchSubtree<K extends SharedStorePath>(
    subtreeKey: K,
    action: TAction,
  ): Promise<number>;
  clear(subtreeKey?: SharedStorePath): Promise<number>;
  subscribe(
    listener: SharedStoreListener<TState>,
    subtreeKeys?: readonly SharedStorePath[],
  ): () => void;
  path<TValue = unknown>(
    path: SharedStorePath,
  ): SharedStorePathApi<TValue, TState, TAction>;
  useStore(): TState;
  useStore<TSelected>(
    selector: (state: TState) => TSelected,
    subtreeKeys?: readonly SharedStorePath[],
    getServerSnapshot?: () => TSelected,
  ): TSelected;
};

type ListenerEntry<TState> = {
  listener: SharedStoreListener<TState>;
  subtreeKeys?: ReadonlySet<string>;
};

const nativeStore = NativeModules.SharedZustandStore as
  | NativeSharedZustandStore
  | undefined;

const eventEmitter = nativeStore
  ? new NativeEventEmitter(nativeStore as any)
  : null;
const runtimeSourceId = `runtime-${Math.random().toString(36).slice(2)}`;
let cachedNitroStore: NitroSharedZustandStore | null | undefined;

function getNitroStore(): NitroSharedZustandStore | null {
  if (cachedNitroStore !== undefined) {
    return cachedNitroStore;
  }

  try {
    cachedNitroStore = NitroModules.hasHybridObject('SharedZustandStore')
      ? NitroModules.createHybridObject<NitroSharedZustandStore>(
          'SharedZustandStore',
        )
      : null;
  } catch (error) {
    cachedNitroStore = null;
    console.warn('[threaded-zustand] Nitro store unavailable', error);
  }

  return cachedNitroStore;
}

function requireNativeStore(): NativeSharedZustandStore {
  if (!nativeStore) {
    throw new Error('SharedZustandStore native module is not installed');
  }
  return nativeStore;
}

function parseState<TState>(stateJson: string): TState {
  return JSON.parse(stateJson) as TState;
}

function stringifyState<TState>(state: TState): string {
  return JSON.stringify(state);
}

function resolveNextState<TState>(
  currentState: TState,
  partial:
    | TState
    | Partial<TState>
    | ((state: TState) => TState | Partial<TState>),
  replace: boolean,
): TState {
  const partialState =
    typeof partial === 'function'
      ? (partial as (state: TState) => TState | Partial<TState>)(currentState)
      : partial;

  if (
    replace ||
    typeof partialState !== 'object' ||
    partialState === null ||
    Array.isArray(partialState)
  ) {
    return partialState as TState;
  }

  return { ...(currentState as object), ...(partialState as object) } as TState;
}

function normalizePath(path: SharedStorePath): string[] {
  if (typeof path === 'string' && path === ROOT_SUBTREE_KEY) {
    return [];
  }

  const segments =
    typeof path === 'string'
      ? path.split('.')
      : path.map(segment => String(segment));
  const normalized = segments
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (normalized.length === 0) {
    throw new Error('Shared store paths must contain at least one segment');
  }

  return normalized;
}

function pathKey(path: SharedStorePath): string {
  const segments = normalizePath(path);
  return segments.length === 0 ? ROOT_SUBTREE_KEY : segments.join('.');
}

function pathSegmentsFromKey(key: string): string[] {
  return key === ROOT_SUBTREE_KEY ? [] : normalizePath(key);
}

function areRelatedPathKeys(left: string, right: string): boolean {
  if (
    left === right ||
    left === ROOT_SUBTREE_KEY ||
    right === ROOT_SUBTREE_KEY
  ) {
    return true;
  }

  return left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function shouldNotifyPath(
  subscribedKeys: ReadonlySet<string> | undefined,
  changedKey: string,
): boolean {
  if (!subscribedKeys) {
    return true;
  }

  for (const subscribedKey of subscribedKeys) {
    if (areRelatedPathKeys(subscribedKey, changedKey)) {
      return true;
    }
  }

  return false;
}

function getValueAtSegments<TValue>(
  state: unknown,
  segments: readonly string[],
): TValue {
  return segments.reduce<unknown>((value, segment) => {
    if (value == null || typeof value !== 'object') {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, state) as TValue;
}

function setValueAtSegments<TState>(
  state: TState,
  segments: readonly string[],
  value: unknown,
): TState {
  if (segments.length === 0) {
    return value as TState;
  }

  const [segment, ...rest] = segments;
  const current =
    state != null && typeof state === 'object'
      ? (state as Record<string, unknown>)[segment]
      : undefined;
  const nextValue = setValueAtSegments(current, rest, value);
  const nextState = Array.isArray(state)
    ? [...state]
    : { ...((state ?? {}) as object) };

  (nextState as Record<string, unknown>)[segment] = nextValue;
  return nextState as TState;
}

function topLevelKeys<TState>(state: TState): SharedStoreSubtreeKey<TState>[] {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return [];
  }
  return Object.keys(state) as SharedStoreSubtreeKey<TState>[];
}

function uniqueSubtrees<TState, TAction>(
  initialState: TState,
  slices?: SharedStoreSliceReducers<TState, TAction>,
  subtrees?: readonly SharedStoreSubtreeKey<TState>[],
): SharedStoreSubtreeKey<TState>[] {
  const keys = subtrees?.length
    ? subtrees
    : slices
    ? (Object.keys(slices) as SharedStoreSubtreeKey<TState>[])
    : topLevelKeys(initialState);
  return Array.from(new Set(keys));
}

function resolvePersistedSubtrees<TState>(
  persist: SharedStorePersistOptions<TState> | undefined,
  name: string,
  nativeSubtreeKeys: readonly string[],
): Map<string, string> {
  if (!persist) {
    return new Map();
  }

  const version = typeof persist === 'object' ? persist.version ?? 1 : 1;
  const baseKey =
    typeof persist === 'object' && persist.key ? persist.key : name;
  const selectedSubtrees =
    typeof persist === 'object' && persist.subtrees?.length
      ? persist.subtrees.map(pathKey)
      : nativeSubtreeKeys;

  return new Map(
    selectedSubtrees.map(subtreeKey => [
      subtreeKey,
      `${baseKey}:${subtreeKey}:v${version}`,
    ]),
  );
}

export function createSharedStore<TState, TAction = unknown>({
  name,
  initialState,
  reducer,
  slices,
  subtrees,
  persist,
  sourceId = runtimeSourceId,
}: SharedStoreOptions<TState, TAction>): SharedStoreApi<TState, TAction> {
  const sliceKeys = uniqueSubtrees(initialState, slices, subtrees);
  const usesSubtrees = sliceKeys.length > 0 && !reducer;
  const nativeSubtreeKeys = usesSubtrees ? sliceKeys : [ROOT_SUBTREE_KEY];
  const persistedSubtrees = resolvePersistedSubtrees(
    persist,
    name,
    nativeSubtreeKeys,
  );
  const listeners = new Set<ListenerEntry<TState>>();
  const subtreeRevisions = new Map<string, number>();
  const hydratedSubtreeKeys = new Set<string>();
  const hydratingSubtreeKeys = new Map<string, Promise<void>>();
  let currentState = initialState;
  let currentRevision = 0;

  function publish(nextState: TState, subtreeKey: string, revision: number) {
    currentState = nextState;
    subtreeRevisions.set(subtreeKey, revision);
    currentRevision = Math.max(currentRevision, revision);
    listeners.forEach(({ listener, subtreeKeys }) => {
      if (shouldNotifyPath(subtreeKeys, subtreeKey)) {
        listener(currentState, currentRevision, subtreeKey);
      }
    });
  }

  function patchPath<TValue>(subtreeKey: string, subtreeState: TValue): TState {
    return setValueAtSegments(
      currentState,
      pathSegmentsFromKey(subtreeKey),
      subtreeState,
    );
  }

  function initialPathValue<TValue>(subtreeKey: string): TValue {
    return (
      subtreeKey === ROOT_SUBTREE_KEY
        ? initialState
        : getValueAtSegments(initialState, pathSegmentsFromKey(subtreeKey))
    ) as TValue;
  }

  function getPathState<TValue>(path: SharedStorePath): TValue {
    return getValueAtSegments(currentState, normalizePath(path)) as TValue;
  }

  function patchSubtree<K extends SharedStoreSubtreeKey<TState>>(
    subtreeKey: K,
    subtreeState: TState[K],
  ): TState {
    return patchPath(subtreeKey, subtreeState);
  }

  function initialSubtree<K extends SharedStoreSubtreeKey<TState>>(
    subtreeKey: K,
  ): TState[K] {
    return initialPathValue(subtreeKey);
  }

  function initialJsonForSubtree(subtreeKey: string): string {
    return stringifyState(initialPathValue(subtreeKey) ?? null);
  }

  function publishJsonState(
    subtreeKey: string,
    stateJson: string | null,
    revision: number,
  ) {
    if (subtreeKey === ROOT_SUBTREE_KEY) {
      const nextState =
        stateJson == null ? initialState : parseState<TState>(stateJson);
      publish(nextState, subtreeKey, revision);
      return;
    }

    const nextSubtreeState =
      stateJson == null ? initialPathValue(subtreeKey) : parseState(stateJson);
    publish(patchPath(subtreeKey, nextSubtreeState), subtreeKey, revision);
  }

  async function persistSubtreeState(subtreeKey: string, stateJson: string) {
    const persistKey = persistedSubtrees.get(subtreeKey);
    if (!persistKey) {
      return;
    }
    const nitroStore = getNitroStore();
    if (nitroStore) {
      nitroStore.setPersistedState(persistKey, stateJson);
      return;
    }
    if (!nativeStore?.setPersistedState) {
      return;
    }
    await nativeStore.setPersistedState(persistKey, stateJson);
  }

  async function clearPersistedSubtreeState(subtreeKey: string) {
    const persistKey = persistedSubtrees.get(subtreeKey);
    if (!persistKey) {
      return;
    }
    const nitroStore = getNitroStore();
    if (nitroStore) {
      nitroStore.clearPersistedState(persistKey);
      return;
    }
    if (!nativeStore?.clearPersistedState) {
      return;
    }
    await nativeStore.clearPersistedState(persistKey);
  }

  async function notifyNativeChange(
    subtreeKey: string,
    stateJson: string | null,
    revision: number,
  ) {
    await nativeStore?.notifyChanged?.(
      name,
      subtreeKey,
      stateJson,
      revision,
      sourceId,
    );
  }

  const subscription = eventEmitter?.addListener(
    'SharedZustandStoreChanged',
    (event: NativeChangeEvent) => {
      if (event.storeName !== name) {
        return;
      }
      if (event.source === sourceId) {
        return;
      }
      const subtreeKey = event.subtreeKey ?? ROOT_SUBTREE_KEY;
      const currentSubtreeRevision = subtreeRevisions.get(subtreeKey) ?? 0;
      if (event.revision < currentSubtreeRevision) {
        return;
      }

      publishJsonState(subtreeKey, event.stateJson, event.revision);
    },
  );

  async function hydrateSubtree(subtreeKey: string) {
    if (hydratedSubtreeKeys.has(subtreeKey)) {
      return;
    }
    const existingHydration = hydratingSubtreeKeys.get(subtreeKey);
    if (existingHydration) {
      await existingHydration;
      return;
    }

    const hydration = hydrateSubtreeOnce(subtreeKey);
    hydratingSubtreeKeys.set(subtreeKey, hydration);

    try {
      await hydration;
    } finally {
      hydratingSubtreeKeys.delete(subtreeKey);
    }
  }

  async function hydrateSubtreeOnce(subtreeKey: string) {
    const store = requireNativeStore();
    const nitroStore = getNitroStore();
    const initialJson = initialJsonForSubtree(subtreeKey);
    const persistKey = persistedSubtrees.get(subtreeKey) ?? null;

    if (nitroStore) {
      const stateJson = nitroStore.getOrInitState(
        name,
        subtreeKey,
        initialJson,
        persistKey ?? '',
      );
      const revision = nitroStore.getRevision(name, subtreeKey);
      publishJsonState(subtreeKey, stateJson, revision);
      hydratedSubtreeKeys.add(subtreeKey);
      return;
    }

    if (
      (subtreeKey === ROOT_SUBTREE_KEY && store.getOrInitState) ||
      (subtreeKey !== ROOT_SUBTREE_KEY && store.getOrInitSubtreeState)
    ) {
      const hydration =
        subtreeKey === ROOT_SUBTREE_KEY
          ? await store.getOrInitState!(name, initialJson, persistKey)
          : await store.getOrInitSubtreeState!(
              name,
              subtreeKey,
              initialJson,
              persistKey,
            );
      publishJsonState(subtreeKey, hydration.stateJson, hydration.revision);
      hydratedSubtreeKeys.add(subtreeKey);
      return;
    }

    const stateJson =
      subtreeKey === ROOT_SUBTREE_KEY
        ? await store.getState(name)
        : await store.getSubtreeState(name, subtreeKey);

    if (stateJson == null) {
      const revision =
        subtreeKey === ROOT_SUBTREE_KEY
          ? await store.setState(name, initialJson, sourceId)
          : await store.setSubtreeState(
              name,
              subtreeKey,
              initialJson,
              sourceId,
            );
      await persistSubtreeState(subtreeKey, initialJson);
      publishJsonState(subtreeKey, initialJson, revision);
      hydratedSubtreeKeys.add(subtreeKey);
      return;
    }

    const revision =
      subtreeKey === ROOT_SUBTREE_KEY
        ? await store.getRevision(name)
        : await store.getSubtreeRevision(name, subtreeKey);
    publishJsonState(subtreeKey, stateJson, revision);
    hydratedSubtreeKeys.add(subtreeKey);
  }

  void Promise.all(nativeSubtreeKeys.map(hydrateSubtree)).catch(error => {
    console.warn(`[threaded-zustand] Failed to hydrate ${name}`, error);
  });

  async function commitPathState<TValue>(
    path: SharedStorePath,
    partial:
      | TValue
      | Partial<TValue>
      | ((state: TValue) => TValue | Partial<TValue>),
    replace: boolean,
  ): Promise<number> {
    const subtreeKey = pathKey(path);
    if (subtreeKey === ROOT_SUBTREE_KEY) {
      return api.setState(partial as unknown as TState, replace);
    }

    const nextSubtreeState = resolveNextState(
      getPathState<TValue>(subtreeKey),
      partial,
      replace,
    );
    const stateJson = stringifyState(nextSubtreeState);
    const nitroStore = getNitroStore();
    const revision = nitroStore
      ? nitroStore.setState(name, subtreeKey, stateJson)
      : await requireNativeStore().setSubtreeState(
          name,
          subtreeKey,
          stateJson,
          sourceId,
        );
    await persistSubtreeState(subtreeKey, stateJson);
    if (nitroStore) {
      await notifyNativeChange(subtreeKey, stateJson, revision);
    }
    publish(patchPath(subtreeKey, nextSubtreeState), subtreeKey, revision);
    hydratedSubtreeKeys.add(subtreeKey);
    return revision;
  }

  const api: SharedStoreApi<TState, TAction> = {
    name,
    getState() {
      return currentState;
    },
    getRevision(subtreeKey) {
      if (subtreeKey == null) {
        return currentRevision;
      }
      return subtreeRevisions.get(pathKey(subtreeKey)) ?? 0;
    },
    getSubtreeState(subtreeKey) {
      return getPathState<TState[typeof subtreeKey]>(subtreeKey);
    },
    getPathState(path) {
      return getPathState(path);
    },
    async hydrate() {
      await Promise.all(nativeSubtreeKeys.map(hydrateSubtree));
      return currentState;
    },
    async setState(partial, replace = false) {
      const nextState = resolveNextState(currentState, partial, replace);
      if (!usesSubtrees) {
        const stateJson = stringifyState(nextState);
        const nitroStore = getNitroStore();
        const revision = nitroStore
          ? nitroStore.setState(name, ROOT_SUBTREE_KEY, stateJson)
          : await requireNativeStore().setState(name, stateJson, sourceId);
        await persistSubtreeState(ROOT_SUBTREE_KEY, stateJson);
        if (nitroStore) {
          await notifyNativeChange(ROOT_SUBTREE_KEY, stateJson, revision);
        }
        publish(nextState, ROOT_SUBTREE_KEY, revision);
        return revision;
      }

      const changedKeys = sliceKeys.filter(
        subtreeKey =>
          (nextState as Record<string, unknown>)[subtreeKey] !==
          (currentState as Record<string, unknown>)[subtreeKey],
      );
      const keysToCommit = changedKeys.length > 0 ? changedKeys : sliceKeys;
      let maxRevision = currentRevision;
      for (const subtreeKey of keysToCommit) {
        const revision = await api.setPathState(
          subtreeKey,
          (nextState as Record<string, unknown>)[
            subtreeKey
          ] as TState[typeof subtreeKey],
          true,
        );
        maxRevision = Math.max(maxRevision, revision);
      }
      return maxRevision;
    },
    async setSubtreeState(subtreeKey, partial, replace = false) {
      if (!usesSubtrees) {
        return api.setState(
          state =>
            resolveNextState(
              state,
              {
                [subtreeKey]: resolveNextState(
                  (state as Record<string, unknown>)[subtreeKey],
                  partial as unknown,
                  replace,
                ),
              } as Partial<TState>,
              false,
            ),
          false,
        );
      }

      return commitPathState(subtreeKey, partial, replace);
    },
    async setPathState(path, partial, replace = false) {
      return commitPathState(path, partial, replace);
    },
    async dispatch(action, subtreeKey) {
      if (subtreeKey != null) {
        return api.dispatchSubtree(pathKey(subtreeKey), action);
      }
      if (reducer) {
        return api.setState(reducer(currentState, action), true);
      }
      if (sliceKeys.length === 1) {
        return api.dispatchSubtree(sliceKeys[0], action);
      }
      throw new Error(
        `Shared store ${name} has multiple subtrees; dispatch requires a subtreeKey`,
      );
    },
    async dispatchSubtree(subtreeKey, action) {
      const key = pathKey(subtreeKey);
      const sliceReducer = (
        slices as
          | Record<string, SharedStoreReducer<unknown, TAction>>
          | undefined
      )?.[key];
      if (!sliceReducer) {
        throw new Error(
          `Shared store ${name} does not have a reducer for subtree ${key}`,
        );
      }
      return api.setPathState(
        key,
        sliceReducer(api.getPathState(key), action),
        true,
      );
    },
    async clear(subtreeKey) {
      if (subtreeKey != null) {
        const key = pathKey(subtreeKey);
        const nitroStore = getNitroStore();
        const revision = nitroStore
          ? nitroStore.clear(name, key)
          : await requireNativeStore().clearSubtree(name, key, sourceId);
        await clearPersistedSubtreeState(key);
        if (nitroStore) {
          await notifyNativeChange(key, null, revision);
        }
        publish(patchPath(key, initialPathValue(key)), key, revision);
        return revision;
      }

      if (!usesSubtrees) {
        const nitroStore = getNitroStore();
        const revision = nitroStore
          ? nitroStore.clear(name, ROOT_SUBTREE_KEY)
          : await requireNativeStore().clear(name, sourceId);
        await clearPersistedSubtreeState(ROOT_SUBTREE_KEY);
        if (nitroStore) {
          await notifyNativeChange(ROOT_SUBTREE_KEY, null, revision);
        }
        publish(initialState, ROOT_SUBTREE_KEY, revision);
        return revision;
      }

      let maxRevision = currentRevision;
      for (const key of sliceKeys) {
        maxRevision = Math.max(maxRevision, await api.clear(key));
      }
      return maxRevision;
    },
    subscribe(listener, subtreeKeys) {
      const entry: ListenerEntry<TState> = {
        listener,
        subtreeKeys: subtreeKeys
          ? new Set(subtreeKeys.map(pathKey))
          : undefined,
      };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    path<TValue = unknown>(path: SharedStorePath) {
      const key = pathKey(path);
      const segments = pathSegmentsFromKey(key);

      void hydrateSubtree(key).catch(error => {
        console.warn(
          `[threaded-zustand] Failed to hydrate ${name}:${key}`,
          error,
        );
      });

      const pathApi: SharedStorePathApi<TValue, TState, TAction> = {
        key,
        segments,
        get() {
          return api.getPathState<TValue>(key);
        },
        getRevision() {
          return api.getRevision(key);
        },
        async hydrate() {
          await hydrateSubtree(key);
          return api.getPathState<TValue>(key);
        },
        set(partial, replace = false) {
          return api.setPathState<TValue>(key, partial, replace);
        },
        update(updater) {
          return api.setPathState<TValue>(key, updater, true);
        },
        dispatch(action) {
          return api.dispatchSubtree(key, action);
        },
        clear() {
          return api.clear(key);
        },
        subscribe(listener) {
          return api.subscribe(
            (state, revision, changedKey) => {
              listener(
                api.getPathState<TValue>(key),
                state,
                revision,
                changedKey,
              );
            },
            [key],
          );
        },
        use<TSelected>(
          selector?: (value: TValue) => TSelected,
          getServerSnapshot?: () => TSelected,
        ) {
          const select =
            selector ?? ((value: TValue) => value as unknown as TSelected);
          return useSyncExternalStore(
            onStoreChange => api.subscribe(() => onStoreChange(), [key]),
            () => select(api.getPathState<TValue>(key)),
            getServerSnapshot ?? (() => select(initialPathValue<TValue>(key))),
          );
        },
      };

      return pathApi;
    },
    useStore<TSelected>(
      selector?: (state: TState) => TSelected,
      subtreeKeys?: readonly SharedStorePath[],
      getServerSnapshot?: () => TSelected,
    ) {
      const select =
        selector ?? ((state: TState) => state as unknown as TSelected);
      return useSyncExternalStore(
        onStoreChange => api.subscribe(() => onStoreChange(), subtreeKeys),
        () => select(currentState),
        getServerSnapshot ?? (() => select(initialState)),
      );
    },
  };

  void subscription;
  return api;
}

export function destroySharedStore(store: SharedStoreApi<unknown, unknown>) {
  void store.clear();
}
