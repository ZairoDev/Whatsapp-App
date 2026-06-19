import React from 'react';

type RNProps = Record<string, unknown> & { children?: React.ReactNode };

const RN_ONLY_PROPS = new Set([
  'style',
  'placeholderTextColor',
  'keyboardType',
  'autoCorrect',
  'autoCapitalize',
  'hitSlop',
  'activeOpacity',
  'numberOfLines',
  'accessibilityRole',
  'accessibilityLabel',
  'testID',
  'onPress',
  'onLongPress',
  'disabled',
  'showsHorizontalScrollIndicator',
  'keyboardShouldPersistTaps',
  'nestedScrollEnabled',
  'bounces',
  'onChangeText',
  'value',
  'placeholder',
  'source',
  'resizeMode',
]);

function stripRnProps(props: Record<string, unknown>) {
  const domProps: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props)) {
    if (RN_ONLY_PROPS.has(key)) continue;
    domProps[key] = val;
  }
  return domProps;
}

function createHost(name: string, role?: string) {
  return ({ children, testID, ...rest }: RNProps & { testID?: string }) =>
    React.createElement(
      name,
      { 'data-testid': testID, role, ...stripRnProps(rest) },
      children,
    );
}

export const View = createHost('div');
export const Text = createHost('span');
export const Image = ({
  testID,
  source,
  accessibilityLabel,
  ...rest
}: RNProps & {
  testID?: string;
  source?: { uri?: string };
  accessibilityLabel?: string;
}) =>
  React.createElement('img', {
    'data-testid': testID,
    role: 'img',
    alt: accessibilityLabel ?? source?.uri ?? 'image',
    src: source?.uri,
    ...stripRnProps(rest),
  });
export const ScrollView = createHost('div');
export const Pressable = ({
  children,
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  testID,
  style,
}: RNProps & {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  testID?: string;
  style?: unknown | ((state: { pressed: boolean }) => unknown);
}) => {
  if (typeof style === 'function') {
    style({ pressed: true });
    style({ pressed: false });
  }
  return React.createElement(
    'button',
    {
      type: 'button',
      'data-testid': testID,
      'aria-label': accessibilityLabel,
      role: accessibilityRole,
      disabled,
      onClick: disabled ? undefined : onPress,
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      },
    },
    children,
  );
};

export const TouchableOpacity = ({
  children,
  onPress,
  onLongPress,
  disabled,
  testID,
  style,
  activeOpacity,
  accessibilityLabel,
  accessibilityRole,
}: RNProps & {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: unknown;
  activeOpacity?: number;
  accessibilityLabel?: string;
  accessibilityRole?: string;
}) =>
  React.createElement(
    'button',
    {
      type: 'button',
      'data-testid': testID,
      'aria-label': accessibilityLabel,
      role: accessibilityRole,
      disabled,
      onClick: disabled ? undefined : onPress,
      onContextMenu: (e: { preventDefault: () => void }) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      },
    },
    children,
  );

export const TouchableWithoutFeedback = ({
  children,
  onPress,
}: RNProps & { onPress?: () => void }) =>
  React.createElement('div', { onClick: onPress, role: 'presentation' }, children);

export const TextInput = ({
  value,
  onChangeText,
  placeholder,
  testID,
  ...rest
}: RNProps & {
  value?: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  testID?: string;
}) =>
  React.createElement('input', {
    'data-testid': testID,
    value: value ?? '',
    placeholder,
    onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
    ...stripRnProps(rest),
  });

export const ActivityIndicator = ({ testID }: { testID?: string }) =>
  React.createElement('div', { 'data-testid': testID ?? 'activity-indicator' }, 'Loading');

export const Modal = ({
  visible,
  children,
  onRequestClose,
  testID,
}: RNProps & {
  visible?: boolean;
  onRequestClose?: () => void;
  testID?: string;
}) =>
  visible
    ? React.createElement(
        'div',
        { 'data-testid': testID ?? 'modal', role: 'dialog', 'aria-modal': 'true' },
        children,
        onRequestClose
          ? React.createElement('button', {
              type: 'button',
              'data-testid': 'modal-request-close',
              onClick: onRequestClose,
            })
          : null,
      )
    : null;

export const KeyboardAvoidingView = ({ children }: RNProps) =>
  React.createElement('div', { 'data-testid': 'keyboard-avoiding' }, children);

export const FlatList = <T,>({
  data,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  onEndReached,
  testID,
}: {
  data?: T[];
  renderItem: (info: { item: T; index: number }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListHeaderComponent?: React.ReactNode | (() => React.ReactNode);
  ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
  ListFooterComponent?: React.ReactNode | (() => React.ReactNode);
  onEndReached?: () => void;
  testID?: string;
}) => {
  const header =
    typeof ListHeaderComponent === 'function' ? <ListHeaderComponent /> : ListHeaderComponent;
  const empty =
    typeof ListEmptyComponent === 'function' ? <ListEmptyComponent /> : ListEmptyComponent;
  const footer =
    typeof ListFooterComponent === 'function' ? <ListFooterComponent /> : ListFooterComponent;
  const items = data ?? [];

  return (
    <div data-testid={testID ?? 'flat-list'}>
      {header}
      {items.length === 0
        ? empty
        : items.map((item, index) => (
            <div
              key={keyExtractor ? keyExtractor(item, index) : String(index)}
              data-testid={`flat-list-item-${index}`}
            >
              {renderItem({ item, index })}
            </div>
          ))}
      {footer}
      {onEndReached ? (
        <button type="button" data-testid="flat-list-end-reached" onClick={() => onEndReached()}>
          end-reached
        </button>
      ) : null}
    </div>
  );
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T) => styles,
  absoluteFillObject: {},
  hairlineWidth: 1,
  flatten: (style: unknown) => style,
};

export const Platform = {
  OS: 'ios' as const,
  select: <T,>(spec: { ios?: T; android?: T; default?: T }) => spec.ios ?? spec.default,
};

export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 2, fontScale: 1 });
