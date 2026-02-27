import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import { ConversationListScreen } from '../../features/chat/screens/ConversationListScreen';
import { ConversationDetailScreen } from '../../features/chat/screens/ConversationDetailScreen';
import { ArchivedConversationsScreen } from '../../features/chat/screens/ArchivedConversationsScreen';
import { VideoPlayerScreen } from '../../features/chat/screens/VideoPlayerScreen';
import type { RootStackParamList } from './RootNavigator';

export type ChatAppStackParamList = {
  ConversationList: { initialArea?: 'athens' | 'thessaloniki' } | undefined;
  ConversationDetail: {
    conversationId: string;
    area: 'athens' | 'thessaloniki';
    conversationName?: string;
    highlightMessageId?: string;
    highlightTimestamp?: number;
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
