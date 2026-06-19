import React, { useEffect, useMemo, useRef, useState } from 'react';
import {View,Text,TextInput,Pressable,StyleSheet,KeyboardAvoidingView,Platform,ActivityIndicator,ScrollView,Keyboard,Image,useWindowDimensions,
  type TextInput as TextInputType,type TextInputProps,} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { login, getLoginErrorMessage } from '../services/auth.api';
import { useAuthStore } from '../auth.store';
import { toTokenData } from '../types';
import { useTheme } from '../../../theme/ThemeContext';
import { ThemeToggleButton } from '../../../theme/ThemeToggleButton';
import { CenteredContent } from '../../../core/layout/CenteredContent';
import type { AuthStackParamList } from '../../../core/navigation/RootNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_REGEX = /^\d{4}$/;
const PIN_LENGTH = 4;
const ADMINSTRO_LOGO = require('../../../../assets/adminstro.png');

const GRAY_50 = '#FAFAFA';
const GRAY_100 = '#F4F4F5';
const GRAY_200 = '#E4E4E7';
const GRAY_400 = '#A1A1AA';
const GRAY_500 = '#71717A';
const GRAY_700 = '#3F3F46';
const GRAY_900 = '#18181B';
const BLACK = '#0A0A0A';

function loginColors(isDark: boolean) {
  return {
    isDark,
    bg: isDark ? '#09090B' : GRAY_50,
    card: isDark ? '#141416' : '#FFFFFF',
    cardBorder: isDark ? 'rgba(255,255,255,0.06)' : GRAY_200,
    field: isDark ? '#1C1C1F' : GRAY_100,
    fieldFocus: isDark ? '#232326' : '#FFFFFF',
    text: isDark ? '#FAFAFA' : GRAY_900,
    textSecondary: isDark ? 'rgba(250,250,250,0.58)' : GRAY_500,
    textMuted: isDark ? 'rgba(250,250,250,0.38)' : GRAY_400,
    labelFloat: isDark ? 'rgba(250,250,250,0.45)' : GRAY_500,
    divider: isDark ? 'rgba(255,255,255,0.06)' : GRAY_200,
    button: isDark ? '#FFFFFF' : BLACK,
    buttonPressed: isDark ? '#E4E4E7' : '#171717',
    buttonDisabledBg: isDark ? '#27272A' : GRAY_200,
    buttonDisabledText: isDark ? '#52525B' : GRAY_400,
    buttonText: isDark ? BLACK : '#FFFFFF',
    error: isDark ? '#FCA5A5' : '#DC2626',
    sessionBg: isDark ? 'rgba(255,255,255,0.06)' : GRAY_100,
  };
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  onFocusExtra?: () => void;
  error?: string;
  inputRef?: React.RefObject<TextInputType | null>;
  onLayoutY?: (y: number) => void;
  trailing?: React.ReactNode;
} & Pick<
  TextInputProps,
  | 'secureTextEntry'
  | 'keyboardType'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'blurOnSubmit'
  | 'autoCapitalize'
  | 'autoComplete'
  | 'autoCorrect'
  | 'maxLength'
  | 'textContentType'
  | 'editable'
  | 'accessibilityLabel'
>;

function FloatingField({
  label,
  value,
  onChangeText,
  onFocusExtra,
  error,
  inputRef,
  onLayoutY,
  trailing,
  secureTextEntry,
  keyboardType,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  autoCapitalize,
  autoComplete,
  autoCorrect,
  maxLength,
  textContentType,
  editable,
  accessibilityLabel,
  palette,
}: FieldProps & { palette: ReturnType<typeof loginColors> }) {
  const [focused, setFocused] = useState(false);
  const floated = focused || value.length > 0;

  return (
    <View style={fieldStyles.wrap} onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}>
      <View
        style={[
          fieldStyles.surface,
          {
            backgroundColor: focused ? palette.fieldFocus : palette.field,
          },
          error ? fieldStyles.surfaceError : null,
        ]}
      >
        <Text
          style={[
            fieldStyles.label,
            { color: palette.labelFloat },
            floated && fieldStyles.labelUp,
          ]}
          pointerEvents="none"
        >
          {label}
        </Text>
        <View style={fieldStyles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[
              fieldStyles.input,
              { color: palette.text },
              floated && fieldStyles.inputFloated,
            ]}
            value={value}
            onChangeText={onChangeText}
            onFocus={() => {
              setFocused(true);
              onFocusExtra?.();
            }}
            onBlur={() => setFocused(false)}
            placeholder=""
            placeholderTextColor={palette.textMuted}
            secureTextEntry={secureTextEntry}
            keyboardType={keyboardType}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            blurOnSubmit={blurOnSubmit}
            autoCapitalize={autoCapitalize}
            autoComplete={autoComplete}
            autoCorrect={autoCorrect}
            maxLength={maxLength}
            textContentType={textContentType}
            editable={editable}
            accessibilityLabel={accessibilityLabel}
          />
          {trailing}
        </View>
      </View>
      {error ? <Text style={[fieldStyles.error, { color: palette.error }]}>{error}</Text> : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  surface: {
    minHeight: 56,
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  surfaceError: {
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
  },
  label: {
    position: 'absolute',
    left: 16,
    top: 18,
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  labelUp: {
    top: 9,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
    paddingVertical: 0,
    minHeight: 22,
  },
  inputFloated: {
    paddingTop: 16,
  },
  error: {
    marginTop: 6,
    marginLeft: 2,
    fontSize: 12,
    fontWeight: '500',
  },
});

export function LoginScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const palette = useMemo(() => loginColors(isDark), [isDark]);
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const setToken = useAuthStore((s) => s.setToken);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const clearSessionExpired = useAuthStore((s) => s.clearSessionExpired);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mobilePin, setMobilePin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    mobilePin?: string;
  }>({});

  const scrollRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInputType>(null);
  const passwordRef = useRef<TextInputType>(null);
  const pinRef = useRef<TextInputType>(null);
  const cardOffsetY = useRef(0);
  const fieldOffsets = useRef({ email: 0, password: 0, pin: 0 });
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    return () => clearSessionExpired();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToField = (field: 'email' | 'password' | 'pin') => {
    const y = Math.max(0, fieldOffsets.current[field] - 20);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: true }));
  };

  const registerOffset = (field: 'email' | 'password' | 'pin', y: number) => {
    fieldOffsets.current[field] = cardOffsetY.current + y;
  };

  const validate = (): boolean => {
    const next: { email?: string; password?: string; mobilePin?: string } = {};
    if (!email.trim()) next.email = 'Email is required';
    else if (!EMAIL_REGEX.test(email.trim())) next.email = 'Enter a valid email';
    if (!password) next.password = 'Password is required';
    else if (password.length < 6) next.password = 'At least 6 characters';
    if (!mobilePin) next.mobilePin = 'PIN is required';
    else if (!PIN_REGEX.test(mobilePin)) next.mobilePin = 'Must be 4 digits';
    setFieldErrors(next);
    setError(null);
    return Object.keys(next).length === 0;
  };

  const isPinValid = PIN_REGEX.test(mobilePin);
  const canSubmit =
    !isLoggingIn && email.trim().length > 0 && password.length >= 6 && isPinValid;

  const handleSubmit = async () => {
    if (!validate() || isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await login(email.trim(), password, mobilePin);
      if (response.otpRequired === true) {
        navigation.replace('VerifyOtp', { email: email.trim() });
        return;
      }
      const tokenData = toTokenData(response as Record<string, unknown>);
      if (tokenData) {
        await setToken(tokenData);
        return;
      }
      setError(response.error ?? response.message ?? 'Login failed.');
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const availableHeight = screenH - insets.top - insets.bottom;

  const scroll = (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[
        styles.scroll,
        {
          minHeight: availableHeight,
          paddingBottom: Math.max(insets.bottom, 24) + (keyboardVisible ? 200 : 0),
        },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      bounces
    >
      <CenteredContent style={styles.content}>
        <View style={styles.header}>
          <Image
            source={ADMINSTRO_LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Adminstro"
          />
          <ThemeToggleButton compact />
        </View>

        <View style={styles.heroCopy}>
          <Text style={[styles.heroTitle, { color: palette.text }]}>Welcome back</Text>
          <Text style={[styles.heroSubtitle, { color: palette.textSecondary }]}>
            Access your workspace securely.
          </Text>
        </View>

        <View
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}
          onLayout={(e) => {
            cardOffsetY.current = e.nativeEvent.layout.y;
          }}
        >
          {sessionExpired ? (
            <View style={[styles.sessionBanner, { backgroundColor: palette.sessionBg }]}>
              <Text style={[styles.sessionText, { color: palette.textSecondary }]}>
                Your session has expired. Please sign in again.
              </Text>
            </View>
          ) : null}

          <Text style={[styles.cardHeading, { color: palette.text }]}>Sign in</Text>
          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <FloatingField
            palette={palette}
            label="Work email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
              setError(null);
            }}
            onFocusExtra={() => scrollToField('email')}
            error={fieldErrors.email}
            inputRef={emailRef}
            onLayoutY={(y) => registerOffset('email', y)}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!isLoggingIn}
            accessibilityLabel="Work email"
          />

          <FloatingField
            palette={palette}
            label="Password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
              setError(null);
            }}
            onFocusExtra={() => scrollToField('password')}
            error={fieldErrors.password}
            inputRef={passwordRef}
            onLayoutY={(y) => registerOffset('password', y)}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => pinRef.current?.focus()}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
            editable={!isLoggingIn}
            accessibilityLabel="Password"
            trailing={
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={10}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                style={styles.revealBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={palette.textMuted}
                />
              </Pressable>
            }
          />

          <FloatingField
            palette={palette}
            label="Mobile PIN"
            value={mobilePin}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '').slice(0, PIN_LENGTH);
              setMobilePin(digits);
              if (fieldErrors.mobilePin) setFieldErrors((p) => ({ ...p, mobilePin: undefined }));
              setError(null);
            }}
            onFocusExtra={() => scrollToField('pin')}
            error={fieldErrors.mobilePin}
            inputRef={pinRef}
            onLayoutY={(y) => registerOffset('pin', y)}
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmit()}
            secureTextEntry={!showPin}
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            textContentType="oneTimeCode"
            editable={!isLoggingIn}
            accessibilityLabel="Mobile PIN"
            trailing={
              <Pressable
                onPress={() => setShowPin(!showPin)}
                hitSlop={10}
                accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
                style={styles.revealBtn}
              >
                <Ionicons
                  name={showPin ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={palette.textMuted}
                />
              </Pressable>
            }
          />

          <Text style={[styles.pinHint, { color: palette.textMuted }]}>
            4-digit PIN assigned to your mobile account.
          </Text>

          {error ? <Text style={[styles.formError, { color: palette.error }]}>{error}</Text> : null}

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit || isLoggingIn}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: !canSubmit || isLoggingIn }}
            style={({ pressed }) => [
              styles.cta,
              canSubmit && !isLoggingIn ? styles.ctaEnabled : styles.ctaDisabled,
              pressed && canSubmit && !isLoggingIn ? styles.ctaPressed : null,
            ]}
          >
            {isLoggingIn ? (
              <View style={styles.ctaInner}>
                <ActivityIndicator size="small" color={palette.buttonText} />
                <Text style={[styles.ctaText, { color: palette.buttonText }]}>Signing in…</Text>
              </View>
            ) : (
              <View style={styles.ctaInner}>
                <Text
                  style={[
                    styles.ctaText,
                    { color: canSubmit ? palette.buttonText : palette.buttonDisabledText },
                  ]}
                >
                  Continue
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={canSubmit ? palette.buttonText : palette.buttonDisabledText}
                  style={styles.ctaIcon}
                />
              </View>
            )}
          </Pressable>
        </View>
      </CenteredContent>
    </ScrollView>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        {Platform.OS === 'ios' ? (
          <KeyboardAvoidingView style={styles.flex} behavior="padding">
            {scroll}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.flex}>{scroll}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

function createStyles(p: ReturnType<typeof loginColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    safe: { flex: 1 },
    flex: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingTop: 4,
    },
    content: {
      width: '100%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    logo: {
      width: 140,
      height: 38,
    },
    heroCopy: {
      marginTop: 28,
      marginBottom: 24,
      width: '100%',
    },
    heroTitle: {
      fontSize: 30,
      fontWeight: '600',
      letterSpacing: -0.7,
      lineHeight: 36,
      marginBottom: 8,
    },
    heroSubtitle: {
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: -0.2,
    },
    card: {
      width: '100%',
      borderRadius: 20,
      borderWidth: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 28,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: p.isDark ? 0.35 : 0.06,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        },
        android: { elevation: p.isDark ? 10 : 4 },
      }),
    },
    sessionBanner: {
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      marginBottom: 18,
    },
    sessionText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
    cardHeading: {
      fontSize: 18,
      fontWeight: '600',
      letterSpacing: -0.3,
      marginBottom: 16,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginBottom: 20,
    },
    revealBtn: {
      padding: 6,
      marginLeft: 4,
    },
    pinHint: {
      fontSize: 12,
      lineHeight: 17,
      marginTop: -4,
      marginBottom: 4,
    },
    formError: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
      marginBottom: 4,
      fontWeight: '500',
    },
    cta: {
      marginTop: 24,
      width: '100%',
      minHeight: 54,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    ctaEnabled: {
      backgroundColor: p.button,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 3 },
      }),
    },
    ctaDisabled: {
      backgroundColor: p.buttonDisabledBg,
      ...Platform.select({
        ios: {
          shadowOpacity: 0,
          shadowRadius: 0,
        },
        android: { elevation: 0 },
      }),
    },
    ctaPressed: {
      backgroundColor: p.buttonPressed,
      opacity: 0.96,
      transform: [{ scale: 0.992 }],
    },
    ctaInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 15,
    },
    ctaText: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    ctaIcon: {
      marginTop: 1,
    },
  });
}
