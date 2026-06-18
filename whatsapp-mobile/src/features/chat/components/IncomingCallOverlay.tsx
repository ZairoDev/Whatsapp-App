import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IncomingCallPhase } from '../hooks/useIncomingWhatsAppCall';

type Props = {
  visible: boolean;
  phase: IncomingCallPhase;
  callerNumber?: string;
  error?: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onEndCall: () => void;
};

function phaseLabel(phase: IncomingCallPhase): string {
  switch (phase) {
    case 'ringing':   return 'Incoming WhatsApp call…';
    case 'accepting': return 'Connecting…';
    case 'active':    return 'On call';
    case 'ending':    return 'Ending call…';
    default:          return '';
  }
}

export function IncomingCallOverlay({
  visible,
  phase,
  callerNumber,
  error,
  onAccept,
  onDecline,
  onEndCall,
}: Props) {
  const insets = useSafeAreaInsets();

  // Pulse animation for the ringing ring
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'ringing') {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [phase, pulse]);

  const label = error?.trim() || phaseLabel(phase);
  const isRinging = phase === 'ringing';
  const isAccepting = phase === 'accepting';
  const isActive = phase === 'active' || phase === 'ending';

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>

        {/* Avatar with pulse ring */}
        <View style={styles.avatarSection}>
          {isRinging && (
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulse }] }]} />
          )}
          <View style={styles.avatar}>
            <Ionicons name="person" size={44} color="rgba(255,255,255,0.85)" />
          </View>
        </View>

        {/* Caller info */}
        <Text style={styles.callerLabel}>WhatsApp</Text>
        <Text style={styles.callerNumber} numberOfLines={1}>
          {callerNumber || 'Unknown number'}
        </Text>

        {/* Status */}
        <View style={styles.statusRow}>
          {isAccepting && <ActivityIndicator size="small" color="#fff" style={styles.spinner} />}
          <Text style={styles.statusText}>{label}</Text>
        </View>

        {/* Buttons */}
        {isRinging && (
          <View style={styles.buttonRow}>
            <View style={styles.buttonGroup}>
              <Pressable
                onPress={onDecline}
                style={({ pressed }) => [styles.circleBtn, styles.declineBtn, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Decline call"
              >
                <Ionicons name="call" size={30} color="#fff" style={styles.declineIcon} />
              </Pressable>
              <Text style={styles.btnLabel}>Decline</Text>
            </View>

            <View style={styles.buttonGroup}>
              <Pressable
                onPress={onAccept}
                style={({ pressed }) => [styles.circleBtn, styles.acceptBtn, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Accept call"
              >
                <Ionicons name="call" size={30} color="#fff" />
              </Pressable>
              <Text style={styles.btnLabel}>Accept</Text>
            </View>
          </View>
        )}

        {isActive && (
          <View style={styles.endCallSection}>
            <Pressable
              onPress={onEndCall}
              style={({ pressed }) => [styles.circleBtn, styles.declineBtn, pressed && styles.btnPressed]}
              accessibilityRole="button"
              accessibilityLabel="End call"
            >
              <Ionicons name="call" size={30} color="#fff" style={styles.declineIcon} />
            </Pressable>
            <Text style={styles.btnLabel}>End call</Text>
          </View>
        )}

        {isAccepting && (
          <View style={styles.endCallSection}>
            <Pressable
              onPress={onDecline}
              style={({ pressed }) => [styles.circleBtn, styles.declineBtn, styles.btnDisabled, pressed && styles.btnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            <Text style={styles.btnLabel}>Cancel</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 24, 36, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSection: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(37,211,102,0.5)',
    backgroundColor: 'rgba(37,211,102,0.08)',
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callerLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  callerNumber: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    maxWidth: '82%',
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 56,
    minHeight: 24,
  },
  spinner: {
    marginRight: 8,
  },
  statusText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.72)',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGroup: {
    alignItems: 'center',
    gap: 10,
  },
  endCallSection: {
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    backgroundColor: '#25D366',
  },
  declineBtn: {
    backgroundColor: '#D93025',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnPressed: {
    opacity: 0.82,
  },
  declineIcon: {
    transform: [{ rotate: '135deg' }],
  },
  btnLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
});
