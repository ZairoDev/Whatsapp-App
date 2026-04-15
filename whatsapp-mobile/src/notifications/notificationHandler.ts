import * as Notifications from 'expo-notifications';

import { useChatStore } from '../features/chat/chat.store';
import { navigate } from '../core/navigation/navigationRef';

type NotificationData = {
  conversationId?: string;
  businessPhoneId?: string;
  messageType?: string;
  timestamp?: number;
  senderId?: string;
};

function resolveAreaFromBusinessPhoneId(
  businessPhoneId: string | undefined,
): 'athens' | 'thessaloniki' {
  const configs = useChatStore.getState().phoneConfigs ?? [];
  const cfg = businessPhoneId
    ? configs.find((c) => String(c.phoneNumberId) === String(businessPhoneId))
    : undefined;

  const areaRaw = cfg?.area;
  const area =
    typeof areaRaw === 'string'
      ? areaRaw
      : Array.isArray(areaRaw)
        ? areaRaw[0]
        : undefined;

  return area === 'thessaloniki' ? 'thessaloniki' : 'athens';
}

function getDataFromNotification(n: Notifications.Notification): NotificationData {
  const data = (n.request.content.data ?? {}) as any;
  return {
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : undefined,
    businessPhoneId: typeof data.businessPhoneId === 'string' ? data.businessPhoneId : undefined,
    messageType: typeof data.messageType === 'string' ? data.messageType : undefined,
    timestamp: typeof data.timestamp === 'number' ? data.timestamp : undefined,
    senderId: typeof data.senderId === 'string' ? data.senderId : undefined,
  };
}

export function initNotificationHandlers(opts: {
  onForegroundNotification?: (data: NotificationData & { title?: string; body?: string }) => void;
}) {
  // Foreground presentation: suppress system banner if user is already in that conversation.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = getDataFromNotification(notification);
      const activeId = useChatStore.getState().activeConversationId;
      const sameConversation = Boolean(data.conversationId && activeId === data.conversationId);
      return {
        shouldShowAlert: !sameConversation,
        shouldShowBanner: !sameConversation,
        shouldShowList: !sameConversation,
        shouldPlaySound: !sameConversation,
        shouldSetBadge: false,
      };
    },
  });

  const subReceived = Notifications.addNotificationReceivedListener((notification) => {
    const data = getDataFromNotification(notification);
    const activeId = useChatStore.getState().activeConversationId;
    if (data.conversationId && activeId === data.conversationId) return;
    opts.onForegroundNotification?.({
      ...data,
      title: notification.request.content.title ?? undefined,
      body: notification.request.content.body ?? undefined,
    });
  });

  const subResponse = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data ?? {}) as any;
    const conversationId =
      typeof data.conversationId === 'string' ? (data.conversationId as string) : null;
    if (!conversationId) return;

    const businessPhoneId =
      typeof data.businessPhoneId === 'string' ? (data.businessPhoneId as string) : undefined;
    const area = resolveAreaFromBusinessPhoneId(businessPhoneId);

    // Navigate into chat stack and open the conversation.
    navigate('ChatApp', {
      // Nested navigation params are supported at runtime.
      // Keep typing loose here because RootStackParamList currently doesn't model nested screens.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { screen: 'ConversationDetail', params: { conversationId, area } } as any ),
    } as any);
  });

  return () => {
    subReceived.remove();
    subResponse.remove();
  };
}

