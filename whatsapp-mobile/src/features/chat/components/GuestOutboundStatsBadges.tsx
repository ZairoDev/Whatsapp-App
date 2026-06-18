import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Conversation } from '../types';

interface GuestOutboundStatsBadgesProps {
  conversation: Pick<
    Conversation,
    'conversationType' | 'listingLinkSentCount' | 'optionsSentCount'
  >;
  /** Inline beside name/phone in list row (no extra vertical spacing). */
  variant?: 'default' | 'inline';
}

/**
 * Sidebar badges for guest conversations (Adminstro ConversationSidebar parity).
 */
export function GuestOutboundStatsBadges({
  conversation,
  variant = 'default',
}: GuestOutboundStatsBadgesProps) {
  const role = conversation.conversationType;
  const listingLinkSentCount = conversation.listingLinkSentCount ?? 0;
  const optionsSentCount = conversation.optionsSentCount ?? 0;
  const showGuestStats =
    role === 'guest' && (listingLinkSentCount > 0 || optionsSentCount > 0);

  if (!showGuestStats) return null;

  return (
    <View style={[styles.row, variant === 'inline' && styles.rowInline]}>
      {listingLinkSentCount > 0 && (
        <View
          style={styles.listingBadge}
          accessibilityLabel={`Listing link${listingLinkSentCount === 1 ? '' : 's'} sent: ${listingLinkSentCount}`}
        >
          <Ionicons name="link" size={12} color="#008069" />
          <Text style={styles.listingCount}>{listingLinkSentCount}</Text>
        </View>
      )}
      {optionsSentCount > 0 && (
        <View
          style={styles.optionsBadge}
          accessibilityLabel={`Options sent message${optionsSentCount === 1 ? '' : 's'}: ${optionsSentCount}`}
        >
          <Ionicons name="list" size={12} color="#6b5b95" />
          <Text style={styles.optionsCount}>{optionsSentCount}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  rowInline: {
    flexWrap: 'nowrap',
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 6,
    flexShrink: 0,
    gap: 4,
  },
  listingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#e7f8f3',
  },
  listingCount: {
    fontSize: 11,
    fontWeight: '600',
    color: '#008069',
    fontVariant: ['tabular-nums'],
  },
  optionsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f3f0f8',
  },
  optionsCount: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b5b95',
    fontVariant: ['tabular-nums'],
  },
});
