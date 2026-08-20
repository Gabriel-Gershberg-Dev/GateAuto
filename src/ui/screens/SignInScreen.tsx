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
import { LanguageMenuButton } from '../components/LanguagePicker';
import { BusySheet, InfoSheet } from '../components/ConfirmSheet';
import { Group } from '../components/Group';
import { IconGoogleMark } from '../icons';
import { useTheme } from '../ThemeProvider';
import { radii, spacing, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

export function SignInScreen({}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
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
      setFormError(t('auth.enterEmailPassword'));
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
      setFormError(e instanceof Error ? e.message : t('auth.couldNotSignIn'));
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
      setFormError(e instanceof Error ? e.message : t('auth.guestFailed'));
    } finally {
      setBusy(null);
    }
  };

  const onGoogle = async () => {
    setFormError(null);
    if (!auth.googleClientConfigured) {
      setInfo({
        title: t('auth.googleTitle'),
        message: t('auth.googleSetup'),
      });
      return;
    }
    setBusy('google');
    try {
      const idToken = await promptGoogleIdToken();
      if (!idToken) return;
      await auth.signInGoogle(idToken);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('auth.googleFailed'));
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
        <View style={styles.langRow}>
          <LanguageMenuButton />
        </View>
        <View style={styles.hero}>
          <BarrierMark brand size={52} />
          <Text style={styles.kicker}>{t('brand')}</Text>
          <Text style={styles.title}>
            {mode === 'signup' ? t('auth.createTitle') : t('auth.welcomeBack')}
          </Text>
          <Text style={styles.lede}>{t('auth.lede')}</Text>
        </View>

        <Group>
          <View style={styles.cardInner}>
            {mode === 'signup' ? (
              <>
                <Text style={styles.label}>{t('common.name')}</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('auth.yourName')}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </>
            ) : null}
            <Text style={styles.label}>{t('common.email')}</Text>
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
            <Text style={styles.label}>{t('common.password')}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={
                mode === 'signup' ? t('auth.passwordMin') : t('auth.passwordPlaceholder')
              }
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
                {mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
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
                {mode === 'signup' ? t('auth.haveAccount') : t('auth.newHere')}
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
          <Text style={styles.googleText}>{t('auth.continueGoogle')}</Text>
        </Pressable>

        <Pressable
          onPress={() => void submitGuest()}
          disabled={Boolean(busy)}
          style={({ pressed }) => [styles.guestBtn, pressed && styles.pressed]}
        >
          <Text style={styles.guestText}>{t('auth.continueGuest')}</Text>
        </Pressable>
        <Text style={styles.footnote}>{t('auth.footnote')}</Text>
      </ScrollView>
      <BusySheet
        visible={busy != null}
        title={
          busy === 'google'
            ? t('auth.busyGoogle')
            : busy === 'guest'
              ? t('auth.busyGuest')
              : mode === 'signup'
                ? t('auth.busyCreate')
                : t('auth.busySignIn')
        }
        message={t('auth.busyKeep')}
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
    langRow: {
      alignItems: 'flex-end',
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
