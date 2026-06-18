import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemePreference } from './ThemeContext';

type Props = {
  compact?: boolean;
};

function iconForPreference(preference: ThemePreference): keyof typeof Ionicons.glyphMap {
  switch (preference) {
    case 'light':
      return 'sunny-outline';
    case 'dark':
      return 'moon-outline';
    default:
      return 'phone-portrait-outline';
  }
}

export function ThemeToggleButton({ compact = false }: Props) {
  const { colors, preference, preferenceLabel, cycleTheme } = useTheme();

  return (
    <Pressable
      onPress={cycleTheme}
      accessibilityRole="button"
      accessibilityLabel={`Theme: ${preferenceLabel}. Tap to change.`}
      hitSlop={12}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons name={iconForPreference(preference)} size={compact ? 18 : 20} color={colors.textSecondary} />
      {!compact ? (
        <View style={styles.labelWrap}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{preferenceLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Placeholder while theme preference loads from storage (rare flash). */
export function ThemeToggleButtonPlaceholder() {
  return (
    <View style={[styles.button, styles.buttonCompact, { opacity: 0.5 }]}>
      <ActivityIndicator size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  buttonCompact: {
    width: 44,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  labelWrap: {
    paddingRight: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
