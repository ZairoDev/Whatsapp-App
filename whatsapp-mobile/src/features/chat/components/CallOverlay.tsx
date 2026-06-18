import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../../theme/colors';
import type { OutgoingCallPhase } from '../hooks/useWhatsAppCall';

type Props = {
  visible: boolean;
  phase: OutgoingCallPhase;
  contactName?: string;
  error?: string | null;
  onEndCall: () => void;
};

function phaseLabel(phase: OutgoingCallPhase): string {
  switch (phase) {
    case 'checking':
      return 'Checking permissions…';
    case 'requesting_permission':
      return 'Sending permission request…';
    case 'connecting':
      return 'Connecting…';
    case 'ringing':
      return 'Ringing…';
    case 'active':
      return 'On call';
    case 'ending':
      return 'Ending call…';
    case 'error':
      return 'Call failed';
    default:
      return '';
  }
}

export function CallOverlay({ visible, phase, contactName, error, onEndCall }: Props) {
  const insets = useSafeAreaInsets();
  const label = error?.trim() || phaseLabel(phase);
  const showSpinner = phase !== 'active' && phase !== 'error' && phase !== 'idle';

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.textSecondary} />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {contactName || 'Contact'}
          </Text>
          <View style={styles.statusRow}>
            {showSpinner && <ActivityIndicator size="small" color="#fff" style={styles.spinner} />}
            <Text style={styles.status}>{label}</Text>
          </View>

          <Pressable
            onPress={onEndCall}
            style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <Ionicons name="call" size={28} color="#fff" style={styles.endIcon} />
          </Pressable>
          <Text style={styles.endHint}>End call</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 20, 28, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    maxWidth: '90%',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 48,
  },
  spinner: {
    marginRight: 8,
  },
  status: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.78)',
  },
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#D93025',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endBtnPressed: {
    opacity: 0.88,
  },
  endIcon: {
    transform: [{ rotate: '135deg' }],
  },
  endHint: {
    marginTop: 10,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
  },
});
