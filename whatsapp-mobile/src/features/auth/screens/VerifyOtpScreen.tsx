import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../auth.store';
import { verifyOtp, resendOtp, getVerifyOtpErrorMessage } from '../services/auth.api';
import { toTokenData } from '../types';
import { colors } from '../../../theme/colors';
import type { AuthStackParamList } from '../../../core/navigation/RootNavigator';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SEC = 30;

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyOtp'>;

export function VerifyOtpScreen({ route, navigation }: Props) {
  const { email } = route.params;
  const setToken = useAuthStore((s) => s.setToken);
  const [otp, setOtp] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SEC);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let seconds = RESEND_COOLDOWN_SEC;
    timerRef.current = setInterval(() => {
      seconds -= 1;
      setResendCooldown(seconds);
      if (seconds <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleVerify = async () => {
    const trimmed = otp.replace(/\s/g, '');
    if (trimmed.length !== OTP_LENGTH) {
      setError('Please enter the 6-digit code');
      return;
    }
    setError(null);
    setVerifyLoading(true);
    try {
      const response = await verifyOtp(trimmed, email);
      const tokenData = toTokenData(response as Record<string, unknown>);
      if (tokenData) {
        await setToken(tokenData);
        return;
      }
      setError(response.error ?? 'Verification failed. Please try again.');
    } catch (err) {
      setError(getVerifyOtpErrorMessage(err));
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resendLoading) return;
    setError(null);
    setResendLoading(true);
    try {
      await resendOtp(email);
      setResendCooldown(RESEND_COOLDOWN_SEC);
      let seconds = RESEND_COOLDOWN_SEC;
      timerRef.current = setInterval(() => {
        seconds -= 1;
        setResendCooldown(seconds);
        if (seconds <= 0 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }, 1000);
    } catch {
      setError('Failed to resend OTP. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.replace('Login')}
        accessibilityLabel="Back to login"
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Verify OTP</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{'\n'}
          <Text style={styles.email}>{email}</Text>
        </Text>

        <TextInput
          style={styles.otpInput}
          value={otp}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, OTP_LENGTH);
            setOtp(digits);
            setError(null);
          }}
          placeholder="000000"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          editable={!verifyLoading}
          selectTextOnFocus
          accessibilityLabel="OTP input"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, verifyLoading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={verifyLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Submit OTP"
        >
          {verifyLoading ? (
            <View style={styles.buttonRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.buttonText}>Verifying...</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Submit</Text>
          )}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't receive the code? </Text>
          {resendCooldown > 0 ? (
            <Text style={styles.timer}>Resend in {resendCooldown}s</Text>
          ) : (
            <TouchableOpacity
              onPress={handleResend}
              disabled={resendLoading}
              accessibilityRole="button"
              accessibilityLabel="Resend OTP"
            >
              <Text style={[styles.resendLink, resendLoading && styles.resendDisabled]}>
                {resendLoading ? 'Sending...' : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginTop: 56,
    marginLeft: 24,
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  email: {
    fontWeight: '600',
    color: colors.text,
  },
  otpInput: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 24,
    letterSpacing: 8,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    color: colors.error,
    marginBottom: 12,
  },
  button: {
    height: 50,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    flexWrap: 'wrap',
    gap: 4,
  },
  resendLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  timer: {
    fontSize: 14,
    color: colors.textMuted,
  },
  resendLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  resendDisabled: {
    opacity: 0.6,
  },
});
