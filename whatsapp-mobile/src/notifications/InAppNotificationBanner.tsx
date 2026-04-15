import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions,
  Platform,
} from 'react-native';

import { useInAppBannerStore } from './inAppBannerStore';
import { colors } from '../theme/colors';
import { navigate } from '../core/navigation/navigationRef';
import { useChatStore } from '../features/chat/chat.store';

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

export function InAppNotificationBanner() {
  const visible = useInAppBannerStore((s) => s.visible);
  const payload = useInAppBannerStore((s) => s.payload);
  const hide = useInAppBannerStore((s) => s.hide);

  const screenWidth = Dimensions.get('window').width;
  const topInset = Platform.OS === 'android' ? 10 : 18;
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const title = payload?.title ?? 'New message';
  const body = payload?.body ?? 'Tap to open';

  const autoDismissMs = 4000;

  useEffect(() => {
    if (!visible || !payload) return;

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(() => hide());
    }, autoDismissMs);

    return () => clearTimeout(t);
  }, [visible, payload, hide, translateY, opacity]);

  const containerStyle = useMemo(
    () => [
      styles.container,
      { width: Math.min(screenWidth - 24, 420), top: topInset },
      { transform: [{ translateY }], opacity },
    ],
    [screenWidth, topInset, translateY, opacity],
  );

  if (!visible || !payload) return null;

  return (
    <Animated.View pointerEvents="box-none" style={containerStyle}>
      <Pressable
        style={styles.card}
        onPress={() => {
          const area = resolveAreaFromBusinessPhoneId(payload.businessPhoneId);
          navigate(
            'ChatApp',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ({ screen: 'ConversationDetail', params: { conversationId: payload.conversationId, area } } as any),
          );
          hide();
        }}
      >
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 9999,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  textWrap: {
    gap: 4,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    lineHeight: 18,
  },
});

