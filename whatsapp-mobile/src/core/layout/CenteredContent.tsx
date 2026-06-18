import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MAX_CONTENT_WIDTH } from './contentWidth';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Centers content and caps width on wide screens (landscape / tablets)
 * so forms and cards stay readable after rotation.
 */
export function CenteredContent({ children, style }: Props) {
  return <View style={[styles.outer, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
});
