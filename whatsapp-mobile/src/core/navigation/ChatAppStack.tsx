import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import { ConversationListScreen } from '../../features/chat/screens/ConversationListScreen';
import { ConversationDetailScreen } from '../../features/chat/screens/ConversationDetailScreen';
import { ArchivedConversationsScreen } from '../../features/chat/screens/ArchivedConversationsScreen';
import { VideoPlayerScreen } from '../../features/chat/screens/VideoPlayerScreen';
import type { RootStackParamList } from './RootNavigator';
import { useWhatsAppRealtime } from '../../features/chat/hooks';

export type ChatAppStackParamList = {
  ConversationList: { initialArea?: 'athens' | 'thessaloniki' } | undefined;
  ConversationDetail: {
    conversationId: string;
    area: 'athens' | 'thessaloniki';
    conversationName?: string;
    participantPhone?: string;
    /** When true, this is a "draft" chat started by entering a phone number. */
    isDraft?: boolean;
    highlightMessageId?: string;
    highlightTimestamp?: number;
    /** Backend-provided flag: 24-hour window expired → only templates allowed */
    templateOnly?: boolean;
    /** True for the "You" self-chat — always sends directly, never template-only */
    isSelf?: boolean;
    /** Unix ms timestamp when the 24-hour messaging window closes. Used for live countdown. */
    windowExpiresAt?: number;
  };
  ArchiveList: undefined;
  VideoPlayer: {
    items: {
      id: string;
      type: 'image' | 'video';
      uri: string;
      thumbnailUri?: string;
      label?: string;
      timeLabel?: string;
    }[];
    initialIndex: number;
  };
};

const Stack = createNativeStackNavigator<ChatAppStackParamList>();

export function ChatAppStack() {
  const route = useRoute<RouteProp<RootStackParamList, 'ChatApp'>>();
  const initialArea = route.params?.initialArea;
  useWhatsAppRealtime();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="ConversationList"
        component={ConversationListScreen}
        initialParams={{ initialArea }}
      />
      <Stack.Screen name="ConversationDetail" component={ConversationDetailScreen} />
      <Stack.Screen name="ArchiveList" component={ArchivedConversationsScreen} />
      <Stack.Screen
        name="VideoPlayer"
        component={VideoPlayerScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
