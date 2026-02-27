import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useChatStore } from '../chat.store';
import { colors } from '../../../theme/colors';

export function ChatScreen() {
  const { activeConversationId, messages } = useChatStore();
  const list = activeConversationId ? messages[activeConversationId] ?? [] : [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.hint}>
        {activeConversationId
          ? `${list.length} message(s)`
          : 'Select a conversation from Chats'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
