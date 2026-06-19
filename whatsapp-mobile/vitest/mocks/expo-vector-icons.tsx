import React from 'react';
import { Text } from 'react-native';

function Icon({ name, testID }: { name: string; testID?: string }) {
  return <Text testID={testID ?? `icon-${name}`}>{name}</Text>;
}

export const Ionicons = Icon;
export const MaterialCommunityIcons = Icon;
