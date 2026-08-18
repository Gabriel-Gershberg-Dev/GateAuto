import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { promptGoogleIdToken } from '../../auth/googleNative';
import { appendEvent } from '../../data/eventLog';
import { clearCredentials } from '../../data/credentials';
import { tryStopGeofencing } from '../../integrations/optionalNative';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { SHOW_EXPORT_UI } from '../flags';
import { AppearancePicker } from '../components/AppearancePicker';
import { AutoOpenSettings } from '../components/AutoOpenSettings';
import { BusySheet, ConfirmSheet, InfoSheet } from '../components/ConfirmSheet';
import { FormSheet } from '../components/FormSheet';
import { Group, Hairline } from '../components/Group';
import {
  IconChevronRight,
  IconExport,
  IconGoogleMark,
  IconPerson,
  IconQr,
  IconShield,
  IconUnlink,
} from '../icons';
import { useTheme } from '../ThemeProvider';
import { spacing, type ThemeColors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuth();

  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [name, setName] = useState(auth.user?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; message: string } | null>(
    null,
  );

  const runUnlink = () => {
    setUnlinkOpen(false);
    void (async () => {
      await tryStopGeofencing();
      await clearCredentials();
      await appendEvent({ kind: 'info', message: 'Account unlinked' });
      navigation.reset({
        index: 0,
        routes: [{ name: 'GateSystems' }],
      });
    })();
  };

  const accountLabel = auth.user?.isAnonymous
    ? 'Guest'
    : auth.user?.displayName || auth.user?.email || 'Signed in';
  const accountDetail = auth.user?.isAnonymous
    ? 'Local gates only — upgrade to share'
    : auth.user?.email || 'Google or email account';

  return (
    <>
    <ScrollView contentContainerStyle={styles.page}>
      <Group>
        <SettingsRow
          icon={<IconPerson color={colors.primary} />}
          label={accountLabel}
          detail={accountDetail}
          onPress={() => {
            if (auth.user?.isAnonymous) setUpgradeOpen(true);
          }}
          colors={colors}
        />
        {auth.user?.isAnonymous ? (
          <>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconGoogleMark color={colors.primary} />}
              label="Upgrade account"
              detail="Google or email — keep local gates"
              onPress={() => setUpgradeOpen(true)}
              colors={colors}
            />
          </>
        ) : null}
        <Hairline inset={56} />
        <SettingsRow
          icon={<IconQr color={colors.primary} />}
          label="Gate systems"
          detail="Scan PalGate or enter an invite"
          onPress={() => navigation.navigate('GateSystems')}
          colors={colors}
        />
      </Group>

      <AutoOpenSettings />
      <AppearancePicker />

      <Group>
        <SettingsRow
          icon={<IconShield color={colors.primary} />}
          label="Permissions"
          detail="Location, Bluetooth, battery"
          onPress={() => navigation.navigate('Permissions')}
          colors={colors}
        />
        {SHOW_EXPORT_UI ? (
          <>
            <Hairline inset={56} />
            <SettingsRow
              icon={<IconExport color={colors.primary} />}
              label="Export"
              detail="QR for another phone"
              onPress={() => navigation.navigate('ExportAccount')}
              colors={colors}
            />
          </>
        ) : null}
      </Group>

      <Group>
        <SettingsRow
          icon={<IconUnlink color={colors.danger} />}
          label="Unlink PalGate"
          detail="Remove PalGate from this phone"
          onPress={() => setUnlinkOpen(true)}
          colors={colors}
          destructive
        />
        <Hairline inset={56} />
        <SettingsRow
          icon={<IconPerson color={colors.danger} />}
          label="Sign out"
          detail="Stay signed out until you return"
          onPress={() => setSignOutOpen(true)}
          colors={colors}
          destructive
        />
      </Group>
    </ScrollView>
    <ConfirmSheet
      visible={unlinkOpen}
      icon={<IconUnlink color={colors.danger} />}
      title="Unlink PalGate?"
      message="PalGate credentials leave this device and auto-open stops until you scan again. Shared gates on this phone are removed too."
      cancelLabel="Keep linked"
      confirmLabel="Unlink"
      destructive
      onCancel={() => setUnlinkOpen(false)}
      onConfirm={runUnlink}
    />
    <ConfirmSheet
      visible={signOutOpen}
      title="Sign out?"
      message="PalGate on this phone stays. You will need Google, email, or guest to open the app again."
      cancelLabel="Stay signed in"
      confirmLabel="Sign out"
      destructive
      onCancel={() => setSignOutOpen(false)}
      onConfirm={() => {
        setSignOutOpen(false);
        void auth.signOut();
      }}
    />
    <FormSheet
      visible={upgradeOpen}
      title="Upgrade guest"
      message="Keep the gates already on this phone. Sharing needs Google or email."
      fields={[
        {
          key: 'name',
          label: 'Name',
          value: name,
          onChange: setName,
          placeholder: 'Your name',
          autoCapitalize: 'words',
        },
        {
          key: 'email',
          label: 'Email',
          value: email,
          onChange: setEmail,
          placeholder: 'you@email.com',
          keyboardType: 'email-address',
        },
        {
          key: 'password',
          label: 'Password',
          value: password,
          onChange: setPassword,
          placeholder: 'At least 6 characters',
          secureTextEntry: true,
        },
      ]}
      extra={
        <Pressable
          onPress={() => {
            if (!auth.googleClientConfigured) {
              setInfo({
                title: 'Google',
                message:
                  'Finish Google provider setup in Firebase Console, then try again.',
              });
              return;
            }
            setUpgradeOpen(false);
            setBusy(true);
            void promptGoogleIdToken()
              .then((idToken) => {
                if (!idToken) return;
                return auth.upgradeWithGoogle(idToken).then(() =>
                  setInfo({
                    title: 'Account upgraded',
                    message: 'You can share gates now. Local PalGate stays.',
                  }),
                );
              })
              .catch((e) =>
                setInfo({
                  title: 'Google',
                  message: e instanceof Error ? e.message : 'Upgrade failed',
                }),
              )
              .finally(() => setBusy(false));
          }}
          style={{ paddingVertical: 8 }}
        >
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>
            Or continue with Google
          </Text>
        </Pressable>
      }
      cancelLabel="Not now"
      confirmLabel="Link email"
      error={upgradeError}
      busy={busy}
      onCancel={() => setUpgradeOpen(false)}
      onConfirm={() => {
        setUpgradeError(null);
        setBusy(true);
        void auth
          .upgradeWithEmail(name, email, password)
          .then(() => {
            setUpgradeOpen(false);
            setInfo({
              title: 'Account upgraded',
              message: 'You can share gates now. Local PalGate stays.',
            });
          })
          .catch((e) =>
            setUpgradeError(e instanceof Error ? e.message : 'Upgrade failed'),
          )
          .finally(() => setBusy(false));
      }}
    />
    <BusySheet visible={busy && !upgradeOpen} title="Account" message="Linking…" />
    <InfoSheet
      visible={info != null}
      title={info?.title ?? ''}
      message={info?.message ?? ''}
      onDismiss={() => setInfo(null)}
    />
    </>
  );
}

function SettingsRow({
  icon,
  label,
  detail,
  onPress,
  colors,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  onPress: () => void;
  colors: ThemeColors;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.surfacePressed }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 16,
          paddingHorizontal: 16,
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        },
      ]}
    >
      <View style={{ width: 28, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '600',
            color: destructive ? colors.danger : colors.text,
            letterSpacing: -0.2,
          }}
        >
          {label}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{detail}</Text>
      </View>
      <IconChevronRight color={destructive ? colors.danger : colors.muted} />
    </Pressable>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      padding: spacing.md,
      gap: spacing.md,
      paddingBottom: spacing.lg,
      backgroundColor: c.background,
    },
  });
}
