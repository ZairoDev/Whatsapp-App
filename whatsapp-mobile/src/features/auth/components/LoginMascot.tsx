import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  isDark: boolean;
};

const FLOAT_EASING = Easing.inOut(Easing.sin);

function useLoop(toValue: number, duration: number, easing = FLOAT_EASING) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue, duration, easing, useNativeDriver: true }),
        Animated.timing(value, { toValue: -toValue, duration, easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [duration, easing, toValue, value]);

  return value;
}

export function LoginMascot({ isDark }: Props) {
  const floatY = useLoop(8, 2400);
  const sparkle = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkle, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(sparkle, { toValue: 0.4, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sparkle]);

  const body = isDark ? '#4B5563' : '#6B7280';
  const bodyDeep = isDark ? '#374151' : '#4B5563';
  const face = isDark ? '#E5E7EB' : '#F3F4F6';
  const accent = isDark ? '#D1D5DB' : '#374151';
  const shadow = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(17,24,39,0.18)';

  return (
    <View style={styles.wrap}>
      <View style={[styles.groundShadow, { backgroundColor: shadow }]} />

      <Animated.View style={[styles.character, { transform: [{ translateY: floatY }] }]}>
        <View style={[styles.bubble, isDark ? styles.bubbleDark : styles.bubbleLight]}>
          <Ionicons name="chatbubbles" size={14} color={isDark ? '#D1D5DB' : '#374151'} />
        </View>

        <Animated.View style={[styles.sparkle, styles.sparkleLeft, { opacity: sparkle }]}>
          <Ionicons name="sparkles" size={14} color={accent} />
        </Animated.View>
        <Animated.View style={[styles.sparkle, styles.sparkleRight, { opacity: sparkle }]}>
          <Ionicons name="shield-checkmark" size={13} color={isDark ? '#9CA3AF' : '#4B5563'} />
        </Animated.View>

        <View style={styles.headWrap}>
          <View style={[styles.head, { backgroundColor: body }]}>
            <View style={[styles.headShine, { backgroundColor: bodyDeep }]} />
            <View style={[styles.facePlate, { backgroundColor: face }]}>
              <View style={styles.eyes}>
                <View style={[styles.eye, isDark && styles.eyeDark]} />
                <View style={[styles.eye, isDark && styles.eyeDark]} />
              </View>
              <View style={[styles.smile, isDark && styles.smileDark]} />
            </View>
            <View style={[styles.antenna, { backgroundColor: accent }]}>
              <View style={[styles.antennaTip, { backgroundColor: accent }]} />
            </View>
          </View>
        </View>

        <View style={[styles.body, { backgroundColor: body }]}>
          <View style={[styles.bodyShine, { backgroundColor: bodyDeep }]} />
          <View style={[styles.badge, isDark ? styles.badgeDark : styles.badgeLight]}>
            <Ionicons name="lock-closed" size={12} color={isDark ? '#F3F4F6' : '#374151'} />
          </View>
          <View style={styles.armLeft} />
          <View style={styles.armRight} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 168,
    marginBottom: 8,
  },
  groundShadow: {
    position: 'absolute',
    bottom: 8,
    width: 88,
    height: 14,
    borderRadius: 999,
    opacity: 0.55,
    transform: [{ scaleX: 1.2 }],
  },
  character: {
    alignItems: 'center',
    width: 120,
  },
  bubble: {
    position: 'absolute',
    top: 4,
    right: -6,
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    ...Platform.select({
      ios: {
        shadowColor: '#111827',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  bubbleLight: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(209,213,219,0.9)',
  },
  bubbleDark: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sparkle: {
    position: 'absolute',
    zIndex: 3,
  },
  sparkleLeft: {
    top: 28,
    left: -4,
  },
  sparkleRight: {
    top: 52,
    right: -2,
  },
  headWrap: {
    zIndex: 2,
    marginBottom: -6,
  },
  head: {
    width: 72,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#111827',
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 8 },
    }),
  },
  headShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    opacity: 0.35,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  facePlate: {
    width: 52,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  eyes: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
  },
  eye: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
  },
  eyeDark: {
    backgroundColor: '#111827',
  },
  smile: {
    width: 18,
    height: 8,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: '#374151',
  },
  smileDark: {
    borderColor: '#1F2937',
  },
  antenna: {
    position: 'absolute',
    top: -10,
    width: 4,
    height: 14,
    borderRadius: 2,
    alignItems: 'center',
  },
  antennaTip: {
    position: 'absolute',
    top: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  body: {
    width: 86,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#111827',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 6 },
    }),
  },
  bodyShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    opacity: 0.28,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLight: {
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  badgeDark: {
    backgroundColor: 'rgba(17,24,39,0.55)',
  },
  armLeft: {
    position: 'absolute',
    left: -14,
    top: 16,
    width: 18,
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '-18deg' }],
  },
  armRight: {
    position: 'absolute',
    right: -14,
    top: 16,
    width: 18,
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '18deg' }],
  },
});
