import type {
  ChatListMessagePayload,
  ComposeChatListDataOp,
  ComposeChatListDataState,
  RenderedChatItem,
} from '../native/ComposeChatListNativeComponent';

export type ReactionMap = Record<string, number>;

export type ChatMessage = {
  id: string;
  author: string;
  body: string;
  isOwn: boolean;
  reactions: ReactionMap;
};

type NativeDataState = ComposeChatListDataState;

const AUTHORS = [
  'Ava',
  'Noah',
  'Mia',
  'Leo',
  'Sofia',
  'Theo',
  'Iris',
  'Maya',
  'Eli',
  'Nora',
];

const WORDS = [
  'native',
  'compose',
  'render',
  'bridge',
  'message',
  'thread',
  'reaction',
  'window',
  'async',
  'version',
  'payload',
  'scroll',
  'bubble',
  'benchmark',
  'visible',
  'request',
  'update',
  'insert',
  'stable',
  'layout',
  'cache',
  'surface',
  'item',
  'lazy',
  'react',
  'android',
  'text',
  'author',
  'queue',
  'batch',
];

const REACTIONS = ['like', 'love', 'laugh', 'wow', 'fire'];

type Random = () => number;

export class VersionedChatDataSource {
  private messages: ChatMessage[];
  private ops: ComposeChatListDataOp[] = [];
  private renderCache = new Map<string, RenderedChatItem>();
  private renderVersionOverrides = new Map<number, number>();
  private reactionTextCache = new WeakMap<
    ReactionMap,
    {summary: string; details: string}
  >();
  private seq = 0;
  private appliedExternalSeq = 0;

  version = 1;

  constructor(messages: ChatMessage[]) {
    this.messages = messages;
    this.ops.push({type: 'reset', seq: ++this.seq});
  }

  get count() {
    return this.messages.length;
  }

  toNativeState(reset = false): ComposeChatListDataState {
    return {
      version: this.version,
      count: this.messages.length,
      ops: this.ops.slice(-128),
      reset,
    };
  }

  renderItem(index: number): RenderedChatItem | null {
    const message = this.messages[index];
    if (!message) {
      return null;
    }

    const renderVersion = this.renderVersionOverrides.get(index) ?? this.version;
    const cacheKey = `${this.version}:${renderVersion}:${index}:${message.id}`;
    const cached = this.renderCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const reactions = this.formatReactionTexts(message.reactions);
    const rendered = {
      index,
      id: message.id,
      type: message.isOwn ? 'message-own' : 'message-other',
      author: message.author,
      body: message.body,
      isOwn: message.isOwn,
      reactionSummary: reactions.summary,
      reactionDetails: reactions.details,
      renderVersion,
    } satisfies RenderedChatItem;

    this.renderCache.set(cacheKey, rendered);
    return rendered;
  }

  renderItems(indices: number[]): RenderedChatItem[] {
    return indices
      .map(index => this.renderItem(index))
      .filter(item => item != null);
  }

  resetRenderedItems(indices: number[]) {
    let didReset = false;

    for (const index of indices) {
      if (index < 0 || index >= this.messages.length) {
        continue;
      }

      const currentRenderVersion =
        this.renderVersionOverrides.get(index) ?? this.version;
      this.renderVersionOverrides.set(index, currentRenderVersion + 1);
      didReset = true;
    }

    if (didReset) {
      this.renderCache.clear();
    }
  }

  addAtIndex(index: number, message: ChatMessage) {
    const safeIndex = clamp(index, 0, this.messages.length);
    this.messages.splice(safeIndex, 0, message);
    this.bump({
      type: 'insert',
      seq: 0,
      index: safeIndex,
      count: 1,
      item: toPayload(message),
    });
  }

  addManyAtIndex(index: number, messages: ChatMessage[]) {
    if (messages.length === 0) {
      return;
    }

    const safeIndex = clamp(index, 0, this.messages.length);
    this.messages.splice(safeIndex, 0, ...messages);
    this.bump({
      type: 'insert',
      seq: 0,
      index: safeIndex,
      count: messages.length,
      item: toPayload(messages[0]),
    });
  }

  updateItem(index: number, patch: Partial<Omit<ChatMessage, 'id'>>) {
    const current = this.messages[index];
    if (!current) {
      return;
    }

    this.messages[index] = {
      ...current,
      ...patch,
      reactions: patch.reactions ?? current.reactions,
    };
    this.bump({type: 'update', seq: 0, index, item: toPayload(this.messages[index])});
  }

  removeAtIndex(index: number) {
    if (index < 0 || index >= this.messages.length) {
      return;
    }

    this.messages.splice(index, 1);
    this.bump({type: 'remove', seq: 0, index, count: 1});
  }

  swapAdjacentPairs(index: number, count: number) {
    const safeIndex = clamp(index, 0, this.messages.length);
    const safeCount = Math.max(0, Math.min(count, this.messages.length - safeIndex));
    if (safeCount < 2) {
      return;
    }

    const pairCount = Math.floor(safeCount / 2);
    for (let pair = 0; pair < pairCount; pair += 1) {
      const firstIndex = safeIndex + pair * 2;
      const secondIndex = firstIndex + 1;
      const first = this.messages[firstIndex];
      this.messages[firstIndex] = this.messages[secondIndex];
      this.messages[secondIndex] = first;
    }

    this.bump({
      type: 'swapPairs',
      seq: 0,
      index: safeIndex,
      count: pairCount * 2,
    });
  }

  toggleReaction(index: number, reaction = REACTIONS[index % REACTIONS.length]) {
    const message = this.messages[index];
    if (!message) {
      return;
    }

    const nextCount = (message.reactions[reaction] ?? 0) + 1;
    this.updateItem(index, {
      reactions: {
        ...message.reactions,
        [reaction]: nextCount,
      },
    });
  }

  applyNativeState(state: NativeDataState) {
    for (const op of state.ops) {
      if (op.seq <= this.appliedExternalSeq) {
        continue;
      }

      switch (op.type) {
        case 'insert':
          if (op.item) {
            const safeIndex = clamp(op.index, 0, this.messages.length);
            const count = Math.max(1, op.count ?? 1);
            const first = fromPayload(op.item);
            const inserted = Array.from({length: count}, (_, offset) =>
              offset === 0
                ? first
                : createRandomMessage(`${first.id}-${offset}`, safeIndex + offset),
            );
            this.messages.splice(safeIndex, 0, ...inserted);
          }
          break;
        case 'remove':
          this.messages.splice(op.index, op.count);
          break;
        case 'update':
          if (op.item && this.messages[op.index]) {
            this.messages[op.index] = fromPayload(op.item);
          }
          break;
        case 'swapPairs':
          this.applySwapPairs(op.index, op.count);
          break;
        case 'reset':
          break;
      }

      this.appliedExternalSeq = op.seq;
    }

    this.version = state.version;
    this.renderCache.clear();
    this.renderVersionOverrides.clear();
  }

  private formatReactionTexts(reactions: ReactionMap) {
    const cached = this.reactionTextCache.get(reactions);
    if (cached) {
      return cached;
    }

    const formatted = {
      summary: formatReactions(reactions),
      details: formatReactionDetails(reactions),
    };
    this.reactionTextCache.set(reactions, formatted);
    return formatted;
  }

  private bump(op: ComposeChatListDataOp) {
    this.version += 1;
    this.renderCache.clear();
    this.renderVersionOverrides.clear();
    this.ops.push({...op, seq: ++this.seq} as ComposeChatListDataOp);
  }

  private applySwapPairs(index: number, count: number) {
    const safeIndex = clamp(index, 0, this.messages.length);
    const safeCount = Math.max(0, Math.min(count, this.messages.length - safeIndex));
    const pairCount = Math.floor(safeCount / 2);

    for (let pair = 0; pair < pairCount; pair += 1) {
      const firstIndex = safeIndex + pair * 2;
      const secondIndex = firstIndex + 1;
      const first = this.messages[firstIndex];
      this.messages[firstIndex] = this.messages[secondIndex];
      this.messages[secondIndex] = first;
    }
  }
}

export function createRandomMessages(count: number): ChatMessage[] {
  const random = seededRandom(824_931);

  return Array.from({length: count}, (_, index) =>
    createRandomMessage(`msg-${index}`, index, random),
  );
}

export function createRandomMessage(
  id: string,
  index: number,
  random: Random = Math.random,
): ChatMessage {
  const wordCount = 2 + Math.floor(random() * 49);
  const body = Array.from({length: wordCount}, (_, wordIndex) => {
    const word = WORDS[Math.floor(random() * WORDS.length)];
    return wordIndex === 0 ? capitalize(word) : word;
  }).join(' ');

  const reactions: ReactionMap = {};
  if (random() > 0.55) {
    const reactionCount = 1 + Math.floor(random() * 3);
    for (let i = 0; i < reactionCount; i += 1) {
      reactions[REACTIONS[Math.floor(random() * REACTIONS.length)]] =
        1 + Math.floor(random() * 8);
    }
  }

  return {
    id,
    author: AUTHORS[index % AUTHORS.length],
    body,
    isOwn: index % 4 === 0 || index % 7 === 0,
    reactions,
  };
}

function formatReactions(reactions: ReactionMap) {
  return Object.entries(reactions)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${reactionLabel(name)} ${count}`)
    .join('   ');
}

function formatReactionDetails(reactions: ReactionMap) {
  return Object.entries(reactions)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name}:${count}`)
    .join(',');
}

function toPayload(message: ChatMessage): ChatListMessagePayload {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    isOwn: message.isOwn,
    reactions: message.reactions,
  };
}

function fromPayload(payload: ChatListMessagePayload): ChatMessage {
  return {
    id: payload.id,
    author: payload.author,
    body: payload.body,
    isOwn: payload.isOwn,
    reactions: payload.reactions,
  };
}

function reactionLabel(name: string) {
  switch (name) {
    case 'love':
      return '<3';
    case 'laugh':
      return ':D';
    case 'wow':
      return '!';
    case 'fire':
      return '*';
    default:
      return '+';
  }
}

function seededRandom(seed: number): Random {
  let state = seed % 4_294_967_296;
  return () => {
    state = (1664525 * state + 1013904223) % 4_294_967_296;
    return state / 4_294_967_295;
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
