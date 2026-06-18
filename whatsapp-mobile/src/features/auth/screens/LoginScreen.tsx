import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { login, getLoginErrorMessage } from '../services/auth.api';
import { useAuthStore } from '../auth.store';
import { toTokenData } from '../types';
import { colors } from '../../../theme/colors';
import type { AuthStackParamList } from '../../../core/navigation/RootNavigator';
import { CenteredContent } from '../../../core/layout/CenteredContent';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_REGEX = /^\d{4}$/;
const PIN_LENGTH = 4;

export function LoginScreen({ navigation }: Props) {
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

  // Dismiss the session-expired banner once the user starts interacting.
  useEffect(() => {
    return () => {
      clearSessionExpired();
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): boolean => {
    const next: { email?: string; password?: string; mobilePin?: string } = {};
    if (!email.trim()) {
      next.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      next.email = 'Please enter a valid email address';
    }
    if (!password) {
      next.password = 'Password is required';
    } else if (password.length < 6) {
      next.password = 'Password must be at least 6 characters';
    }
    if (!mobilePin) {
      next.mobilePin = 'Mobile PIN is required';
    } else if (!PIN_REGEX.test(mobilePin)) {
      next.mobilePin = 'Mobile PIN must be exactly 4 digits';
    }
    setFieldErrors(next);
    setError(null);
    return Object.keys(next).length === 0;
  };

  const isPinValid = PIN_REGEX.test(mobilePin);
  const canSubmit =
    !isLoggingIn &&
    email.trim().length > 0 &&
    password.length >= 6 &&
    isPinValid;


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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CenteredContent>
        {sessionExpired && (
          <View style={styles.sessionBanner}>
            <Ionicons name="warning-outline" size={18} color="#7A4100" />
            <Text style={styles.sessionBannerText}>
              Your session has expired. Please log in again.
            </Text>
          </View>
        )}

        <Text style={styles.title}>Employee Login</Text>
        <Text style={styles.subtitle}>
          Sign in with your email, password, and 4-digit mobile PIN
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email address</Text>
          <TextInput
            style={[styles.input, fieldErrors.email && styles.inputError]}
            placeholder="e.g. you@company.com"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
              setError(null);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!isLoggingIn}
            accessibilityLabel="Email input"
          />
          {fieldErrors.email ? (
            <Text style={styles.fieldError}>{fieldErrors.email}</Text>
          ) : null}

          <Text style={[styles.label, styles.labelMargin]}>Password</Text>
          <View style={[styles.passwordWrap, fieldErrors.password && styles.inputError]}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                setError(null);
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
              editable={!isLoggingIn}
              accessibilityLabel="Password input"
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          {fieldErrors.password ? (
            <Text style={styles.fieldError}>{fieldErrors.password}</Text>
          ) : null}

          <Text style={[styles.label, styles.labelMargin]}>Mobile PIN</Text>
          <View style={[styles.passwordWrap, fieldErrors.mobilePin && styles.inputError]}>
            <TextInput
              style={[styles.passwordInput, styles.pinInput]}
              placeholder="••••"
              placeholderTextColor={colors.textMuted}
              value={mobilePin}
              onChangeText={(t) => {
                const digitsOnly = t.replace(/\D/g, '').slice(0, PIN_LENGTH);
                setMobilePin(digitsOnly);
                if (fieldErrors.mobilePin) {
                  setFieldErrors((p) => ({ ...p, mobilePin: undefined }));
                }
                setError(null);
              }}
              secureTextEntry={!showPin}
              keyboardType="number-pad"
              maxLength={PIN_LENGTH}
              autoComplete="off"
              textContentType="oneTimeCode"
              editable={!isLoggingIn}
              accessibilityLabel="4-digit mobile PIN input"
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPin(!showPin)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
            >
              <Text style={styles.eyeText}>{showPin ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helperText}>
            Enter the 4-digit PIN assigned to your mobile account.
          </Text>
          {fieldErrors.mobilePin ? (
            <Text style={styles.fieldError}>{fieldErrors.mobilePin}</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Continue login"
            accessibilityState={{ disabled: !canSubmit }}
          >
            {isLoggingIn ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.buttonText}>Logging in...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
        </CenteredContent>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sessionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF3CD',
    borderLeftWidth: 4,
    borderLeftColor: '#FFAB00',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 24,
  },
  sessionBannerText: {
    flex: 1,
    fontSize: 14,
    color: '#7A4100',
    fontWeight: '500',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  form: {},
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 8,
  },
  labelMargin: {
    marginTop: 20,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.error,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    paddingRight: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  eyeButton: {
    padding: 8,
    justifyContent: 'center',
  },
  eyeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  pinInput: {
    letterSpacing: 8,
    fontSize: 18,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  fieldError: {
    fontSize: 13,
    color: colors.error,
    marginTop: 4,
  },
  error: {
    fontSize: 14,
    color: colors.error,
    marginTop: 16,
    marginBottom: 4,
  },
  button: {
    height: 50,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
});
