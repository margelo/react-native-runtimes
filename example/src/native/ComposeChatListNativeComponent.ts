import type { ComponentType } from 'react';
import type { HostComponent, ViewProps } from 'react-native';
import NativeComposeChatListItem from './NativeComposeChatListItem';

export type ComposeChatListDataOp =
  | {
      type: 'insert';
      seq: number;
      index: number;
      count: number;
      item?: ChatListMessagePayload;
    }
  | { type: 'remove'; seq: number; index: number; count: number }
  | {
      type: 'update';
      seq: number;
      index: number;
      item?: ChatListMessagePayload;
    }
  | { type: 'swapPairs'; seq: number; index: number; count: number }
  | { type: 'reset'; seq: number };

export type ChatListMessagePayload = {
  id: string;
  author: string;
  body: string;
  isOwn: boolean;
  reactions: Record<string, number>;
};

export type ComposeChatListDataState = {
  version: number;
  count: number;
  ops: ComposeChatListDataOp[];
  reset?: boolean;
};

export type RenderedChatItem = {
  index: number;
  id: string;
  type: 'message-own' | 'message-other';
  author: string;
  body: string;
  isOwn: boolean;
  reactionSummary: string;
  reactionDetails: string;
  renderVersion: number;
};

export type ComposeChatListRenderedItems = {
  version: number;
  requestId: number;
  nativeDispatchUptimeMs?: number;
  jsRenderDurationMs?: number;
  jsTotalDurationMs?: number;
  items: RenderedChatItem[];
  responseSeq?: number;
  responses?: ComposeChatListRenderedItemsResponse[];
};

export type ComposeChatListRenderedItemsResponse = {
  version: number;
  requestId: number;
  nativeDispatchUptimeMs?: number;
  jsRenderDurationMs?: number;
  jsTotalDurationMs?: number;
  items: RenderedChatItem[];
};

export const ComposeChatListItemNativeComponent =
  NativeComposeChatListItem as unknown as HostComponent<
    ViewProps & {
      itemIndex: number;
      itemId: string;
      renderVersion: number;
      contentType?: string;
      hostSlot?: string;
      messagePreview?: string;
      measuredHeight?: number;
    }
  > &
    ComponentType<
      ViewProps & {
        itemIndex: number;
        itemId: string;
        renderVersion: number;
        contentType?: string;
        hostSlot?: string;
        messagePreview?: string;
        measuredHeight?: number;
      }
    >;
