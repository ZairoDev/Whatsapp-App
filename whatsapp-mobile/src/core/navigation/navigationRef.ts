import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<Name extends keyof RootStackParamList>(
  ...args: undefined extends RootStackParamList[Name]
    ? [screen: Name] | [screen: Name, params: RootStackParamList[Name]]
    : [screen: Name, params: RootStackParamList[Name]]
) {
  if (navigationRef.isReady()) {
    // @ts-expect-error react-navigation typing inference is imperfect for unions
    navigationRef.navigate(...args);
  }
}

