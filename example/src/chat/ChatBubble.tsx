import {useEffect, useRef} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {RenderedChatItem} from '../native/ComposeChatListNativeComponent';

export function ChatBubble({
  item,
  onReaction,
  rowPrefix = 'chat-row',
  reactionPrefix = 'chat-reaction',
}: {
  item: RenderedChatItem;
  onReaction: (reaction: string) => void;
  rowPrefix?: string;
  reactionPrefix?: string;
}) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  logReactRender(
    `ChatBubble render#${renderCountRef.current} index=${item.index} itemId=${item.id} ` +
      `renderVersion=${item.renderVersion} type=${item.type} own=${item.isOwn}`,
  );

  useEffect(() => {
    logReactRender(
      `ChatBubble mount index=${item.index} itemId=${item.id} ` +
        `renderVersion=${item.renderVersion} type=${item.type}`,
    );
    return () => {
      logReactRender(
        `ChatBubble unmount index=${item.index} itemId=${item.id} ` +
          `renderVersion=${item.renderVersion} type=${item.type}`,
      );
    };
  }, [item.id, item.index, item.renderVersion, item.type]);

  return (
    <View
      accessibilityLabel={`${rowPrefix}-${item.index}-v${item.renderVersion} ${rowPrefix}-${item.index}-item-${item.id} ${rowPrefix}-${item.index}-fabric-item-${item.id}`}
      collapsable={false}
      testID={item.id}
      style={[styles.row, item.isOwn ? styles.rowOwn : styles.rowOther]}>
      <View
        style={[
          styles.bubble,
          item.isOwn ? styles.bubbleOwn : styles.bubbleOther,
        ]}>
        <View style={styles.header}>
          <Text style={[styles.author, item.isOwn && styles.authorOwn]}>
            {item.author}
          </Text>
          <Text style={[styles.index, item.isOwn && styles.indexOwn]}>
            #{item.index}
          </Text>
        </View>
        <Text style={[styles.body, item.isOwn && styles.bodyOwn]}>
          {item.body}
        </Text>
        <View style={styles.reactions}>
          {parseReactionDetails(item.reactionDetails).map(reaction => (
            <Pressable
              accessibilityLabel={`${reactionPrefix}-${item.index}-${reaction.name}-${reaction.count}`}
              key={reaction.name}
              onPress={() => onReaction(reaction.name)}
              style={[styles.reactionChip, item.isOwn && styles.reactionChipOwn]}>
              <Text
                style={[
                  styles.reactionText,
                  item.isOwn && styles.reactionTextOwn,
                ]}>
                {reaction.label} {reaction.count}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel={`${reactionPrefix}-add-${item.index}`}
            onPress={() => onReaction('like')}
            style={[styles.reactionChip, item.isOwn && styles.reactionChipOwn]}>
            <Text
              style={[
                styles.reactionText,
                item.isOwn && styles.reactionTextOwn,
              ]}>
              +
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function parseReactionDetails(reactionDetails: string) {
  return reactionDetails
    .split(',')
    .map(part => {
      const [name, countValue] = part.split(':');
      const count = Number(countValue);
      return {name, count, label: reactionLabel(name)};
    })
    .filter(reaction => reaction.name && Number.isFinite(reaction.count));
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

const styles = StyleSheet.create({
  row: {
    marginVertical: 5,
    paddingHorizontal: 12,
  },
  rowOther: {
    alignItems: 'flex-start',
  },
  rowOwn: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: 8,
    maxWidth: 328,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleOther: {
    backgroundColor: '#FFFFFF',
  },
  bubbleOwn: {
    backgroundColor: '#1D4ED8',
  },
  author: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  authorOwn: {
    color: '#DCEAFE',
  },
  body: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
  },
  bodyOwn: {
    color: '#FFFFFF',
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 7,
  },
  reactionChip: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reactionChipOwn: {
    backgroundColor: '#2563EB',
    borderColor: '#93C5FD',
  },
  reactionText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  reactionTextOwn: {
    color: '#FFFFFF',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 3,
  },
  index: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  indexOwn: {
    color: '#BFDBFE',
  },
});

function logReactRender(message: string) {
  if (__DEV__) {
    console.log(`[FabricReactRender] ${message}`);
  }
}
