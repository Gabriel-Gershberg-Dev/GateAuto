import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { promptGoogleIdToken } from '../../auth/googleNative';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { BarrierMark } from '../components/BarrierMark';
import { BusySheet, InfoSheet } from '../components/ConfirmSheet';
import { Group } from '../components/Group';
import { IconGoogleMark } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export function SignInScreen({}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );

  const submitEmail = async () => {
    setFormError(null);
    if (!email.trim() || !password) {
      setFormError('Enter email and password.');
      return;
    }
    setBusy('email');
    try {
      if (mode === 'signup') {
        await auth.signUpEmail(name, email, password);
      } else {
        await auth.signInEmail(email, password);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(null);
    }
  };

  const submitGuest = async () => {
    setFormError(null);
    setBusy('guest');
    try {
      await auth.signInGuest();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Guest sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  const onGoogle = async () => {
    setFormError(null);
    if (!auth.googleClientConfigured) {
      setInfo({
        title: 'Google sign-in',
        message:
          'Finish Google provider setup in Firebase Console (OAuth client), then reopen GateAuto.',
      });
      return;
    }
    setBusy('google');
    try {
      const idToken = await promptGoogleIdToken();
      if (!idToken) return;
      await auth.signInGoogle(idToken);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Google failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: Math.max(insets.top, 24) + 8 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <BarrierMark brand size={52} />
          <Text style={styles.kicker}>GateAuto</Text>
          <Text style={styles.title}>
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text style={styles.lede}>
            Gates and PalGate stay on this phone. Sign in so sharing and
            invites can find you — or continue as guest and upgrade later.
          </Text>
        </View>

        <Group>
          <View style={styles.cardInner}>
            {mode === 'signup' ? (
              <>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </>
            ) : null}
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'signup' ? 'At least 6 characters' : 'Password'}
              placeholderTextColor={colors.muted}
              secureTextEntry
            />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
              onPress={() => void submitEmail()}
              disabled={Boolean(busy)}
            >
              <Text style={styles.primaryText}>
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setFormError(null);
                setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
              }}
              hitSlop={8}
            >
              <Text style={styles.switchText}>
                {mode === 'signup'
                  ? 'Already have an account? Sign in'
                  : 'New here? Create an account'}
              </Text>
            </Pressable>
          </View>
        </Group>

        <Pressable
          style={({ pressed }) => [
            styles.googleBtn,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          onPress={() => void onGoogle()}
          disabled={Boolean(busy)}
        >
          <IconGoogleMark color={colors.primary} size={18} />
          <Text style={styles.googleText}>Continue with Google</Text>
        </Pressable>

        <Pressable
          onPress={() => void submitGuest()}
          disabled={Boolean(busy)}
          style={({ pressed }) => [styles.guestBtn, pressed && styles.pressed]}
        >
          <Text style={styles.guestText}>Continue as guest</Text>
        </Pressable>
        <Text style={styles.footnote}>
          Guest can scan PalGate and open gates on this phone. Sharing needs
          Google or email.
        </Text>
      </ScrollView>
      <BusySheet
        visible={busy != null}
        title={
          busy === 'google'
            ? 'Google'
            : busy === 'guest'
              ? 'Guest'
              : mode === 'signup'
                ? 'Creating account'
                : 'Signing in'
        }
        message="Keeping you on this phone…"
      />
      <InfoSheet
        visible={info != null}
        title={info?.title ?? ''}
        message={info?.message ?? ''}
        onDismiss={() => setInfo(null)}
      />
    </KeyboardAvoidingView>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    page: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.lg * 2,
      gap: 12,
    },
    hero: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: spacing.md,
    },
    kicker: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: c.primary,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.text,
      letterSpacing: -0.4,
      textAlign: 'center',
    },
    lede: {
      fontSize: 15,
      lineHeight: 22,
      color: c.muted,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    cardInner: {
      padding: spacing.md,
      gap: 10,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    input: {
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      color: c.text,
    },
    error: {
      fontSize: 13,
      color: c.danger,
    },
    primaryBtn: {
      backgroundColor: c.primary,
      height: 48,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryText: {
      color: c.primaryOn,
      fontWeight: '700',
      fontSize: 15,
    },
    switchText: {
      textAlign: 'center',
      color: c.primary,
      fontWeight: '700',
      fontSize: 14,
      paddingVertical: 4,
    },
    googleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 48,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.primary,
      backgroundColor: c.surface,
    },
    googleText: {
      color: c.primary,
      fontWeight: '700',
      fontSize: 15,
    },
    guestBtn: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    guestText: {
      color: c.text,
      fontWeight: '700',
      fontSize: 15,
    },
    footnote: {
      fontSize: 12,
      lineHeight: 18,
      color: c.muted,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    pressed: {
      opacity: 0.88,
    },
    disabled: {
      opacity: 0.55,
    },
  });
}
