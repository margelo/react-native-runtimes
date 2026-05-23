import {
  ThreadedRuntime,
  registerThreadedHeadlessTask,
  runtimeFunction,
  usingRuntime,
} from '@react-native-runtimes/core';
import { createSharedStore } from '@react-native-runtimes/state';

export type TwoRuntimeBusinessStatus = {
  bootedAt: string | null;
  lastCommand: string;
  lastCommandAt: string | null;
  lastUpdatedAt: string | null;
  latencyMs: number;
  runtimeName: string;
  status: 'cold' | 'starting' | 'running';
  ticks: number;
  updatedBy: string;
};

export type TwoRuntimeMetric = {
  delta: number;
  id: string;
  label: string;
  updatedAt: string | null;
  value: number;
};

export type TwoRuntimeArchitectureState = {
  business: TwoRuntimeBusinessStatus;
  metrics: TwoRuntimeMetric[];
};

type TwoRuntimeBusinessTaskPayload = {
  command?: string;
  enqueuedAt?: number;
  startedBy?: string;
};

export const TWO_RUNTIMES_BUSINESS_RUNTIME_NAME =
  'two-runtimes-business-runtime';

const TWO_RUNTIMES_BUSINESS_TASK = 'twoRuntimes:startBusinessRuntime';
const TWO_RUNTIMES_SYNC_TASK = 'twoRuntimes:syncNow';

const initialBusinessStatus: TwoRuntimeBusinessStatus = {
  bootedAt: null,
  lastCommand: 'initial render',
  lastCommandAt: null,
  lastUpdatedAt: null,
  latencyMs: 0,
  runtimeName: TWO_RUNTIMES_BUSINESS_RUNTIME_NAME,
  status: 'cold',
  ticks: 0,
  updatedBy: 'main RN initial state',
};

const initialMetrics: TwoRuntimeMetric[] = [
  {
    delta: 0,
    id: 'inbox',
    label: 'Inbox freshness',
    updatedAt: null,
    value: 76,
  },
  {
    delta: 0,
    id: 'risk',
    label: 'Risk score',
    updatedAt: null,
    value: 42,
  },
  {
    delta: 0,
    id: 'cache',
    label: 'Local cache',
    updatedAt: null,
    value: 88,
  },
];

export const twoRuntimeArchitectureStore =
  createSharedStore<TwoRuntimeArchitectureState>({
    name: 'two-runtimes-architecture-demo',
    initialState: {
      business: initialBusinessStatus,
      metrics: initialMetrics,
    },
    subtrees: ['business', 'metrics'],
  });
export const twoRuntimeBusiness =
  twoRuntimeArchitectureStore.path<TwoRuntimeArchitectureState['business']>(
    'business',
  );
export const twoRuntimeMetrics =
  twoRuntimeArchitectureStore.path<TwoRuntimeArchitectureState['metrics']>(
    'metrics',
  );

function runtimeKind() {
  const globals = globalThis as {
    __COMPOSE_CHAT_LIST_ENV__?: { kind?: string };
    __THREADED_RUNTIME_ENV__?: { kind?: string };
  };
  return (
    globals.__THREADED_RUNTIME_ENV__?.kind ??
    globals.__COMPOSE_CHAT_LIST_ENV__?.kind ??
    'main'
  );
}

function nextMetrics(
  metrics: TwoRuntimeMetric[],
  tick: number,
  updatedAt: string,
): TwoRuntimeMetric[] {
  return metrics.map((metric, index) => {
    const wave = ((tick * (index + 3) * 11 + index * 17) % 31) - 15;
    const nextValue = Math.max(0, Math.min(100, metric.value + wave));
    return {
      ...metric,
      delta: nextValue - metric.value,
      updatedAt,
      value: nextValue,
    };
  });
}

async function publishBusinessSnapshot(
  command: string,
  payload: TwoRuntimeBusinessTaskPayload = {},
) {
  const now = new Date().toISOString();
  const currentBusiness = twoRuntimeBusiness.get();
  const nextTick = currentBusiness.ticks + 1;
  const latencyMs = payload.enqueuedAt
    ? Math.max(0, Date.now() - payload.enqueuedAt)
    : currentBusiness.latencyMs;

  await twoRuntimeMetrics.set(
    nextMetrics(twoRuntimeMetrics.get(), nextTick, now),
    true,
  );

  await twoRuntimeBusiness.set(
    {
      bootedAt: currentBusiness.bootedAt ?? now,
      lastCommand: command,
      lastCommandAt: now,
      lastUpdatedAt: now,
      latencyMs,
      runtimeName: TWO_RUNTIMES_BUSINESS_RUNTIME_NAME,
      status: 'running',
      ticks: nextTick,
      updatedBy: payload.startedBy ?? runtimeKind(),
    },
    true,
  );
}

let businessLoop: ReturnType<typeof setInterval> | null = null;

registerThreadedHeadlessTask<TwoRuntimeBusinessTaskPayload>(
  TWO_RUNTIMES_BUSINESS_TASK,
  async ({ payload }) => {
    await twoRuntimeArchitectureStore.hydrate();

    if (businessLoop) {
      return;
    }

    await publishBusinessSnapshot('business runtime started', payload);

    businessLoop = setInterval(() => {
      void publishBusinessSnapshot('scheduled background refresh', {
        startedBy: runtimeKind(),
      }).catch(error => {
        console.warn('[two-runtimes] background refresh failed', error);
      });
    }, 1250);
  },
);

registerThreadedHeadlessTask<TwoRuntimeBusinessTaskPayload>(
  TWO_RUNTIMES_SYNC_TASK,
  async ({ payload }) => {
    await twoRuntimeArchitectureStore.hydrate();
    await publishBusinessSnapshot(payload.command ?? 'manual sync', payload);
  },
);

export const syncTwoRuntimeBusinessSnapshot = runtimeFunction(
  async (payload: TwoRuntimeBusinessTaskPayload) => {
    await twoRuntimeArchitectureStore.hydrate();
    await publishBusinessSnapshot(payload.command ?? 'runtime function sync', {
      ...payload,
      startedBy: payload.startedBy ?? runtimeKind(),
    });
    return twoRuntimeBusiness.get();
  },
);

export async function startTwoRuntimeBusinessRuntime(startedBy: string) {
  const current = twoRuntimeBusiness.get();
  if (current.status === 'cold') {
    await twoRuntimeBusiness.set(
      {
        ...current,
        lastCommand: 'prewarming business runtime',
        lastCommandAt: new Date().toISOString(),
        status: 'starting',
        updatedBy: startedBy,
      },
      true,
    );
  }

  await ThreadedRuntime.prewarmBusinessRuntime(
    TWO_RUNTIMES_BUSINESS_RUNTIME_NAME,
  );
  await ThreadedRuntime.runHeadlessTask(TWO_RUNTIMES_BUSINESS_TASK, {
    runtimeName: TWO_RUNTIMES_BUSINESS_RUNTIME_NAME,
    payload: {
      enqueuedAt: Date.now(),
      startedBy,
    },
  });
}

export async function requestTwoRuntimeBusinessSync(command: string) {
  const current = twoRuntimeBusiness.get();
  await twoRuntimeBusiness.set(
    {
      ...current,
      lastCommand: command,
      lastCommandAt: new Date().toISOString(),
      updatedBy: 'main RN',
    },
    true,
  );
  await usingRuntime(TWO_RUNTIMES_BUSINESS_RUNTIME_NAME).run(() =>
    syncTwoRuntimeBusinessSnapshot({
      command,
      enqueuedAt: Date.now(),
      startedBy: 'main RN',
    }),
  );
}
